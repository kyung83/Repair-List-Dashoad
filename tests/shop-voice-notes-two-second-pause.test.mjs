import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('lib/shop-voice-note-dictation.ts');
const compiled=ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,
});
assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);

function simulator({supported=true}={}){
  let now=0,nextId=1;
  const timers=new Map();
  const instances=[];
  const listening=[],messages=[],texts=[];
  function setTimeoutFake(fn,delay){const id=nextId++;timers.set(id,{at:now+delay,fn});return id}
  function clearTimeoutFake(id){timers.delete(id)}
  function advance(delta){
    const goal=now+delta;
    for(let n=0;n<200;n++){
      const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next||next[1].at>goal)break;
      timers.delete(next[0]);
      now=next[1].at;
      next[1].fn();
    }
    now=goal;
  }
  class FakeRecognition{
    constructor(){this.continuous=false;this.interimResults=false;this.startCount=0;this.stopCount=0;this.onresult=null;this.onerror=null;this.onend=null;this.onspeechstart=null;this.onspeechend=null;instances.push(this)}
    start(){this.startCount++}
    stop(){this.stopCount++}
    result(...items){this.onresult?.({results:items.map(([t,isFinal])=>Object.assign([{transcript:t}],{isFinal}))})}
    speechStart(){this.onspeechstart?.()}
    speechEnd(){this.onspeechend?.()}
    end(){this.onend?.()}
  }
  const browser=supported?{SpeechRecognition:FakeRecognition}:{};
  const exports={};
  new Function('exports','window','setTimeout','clearTimeout','Date',compiled.outputText)(
    exports,browser,setTimeoutFake,clearTimeoutFake,{now:()=>now}
  );
  const start=(initialText='')=>exports.startNoteDictation({
    initialText,onText:value=>texts.push(value),
    onMessage:value=>messages.push(value),
    onListening:value=>listening.push(value),
  });
  const last=()=>texts.at(-1)||'';
  return {start,advance,instances,last,texts,messages,listening,timers,exports};
}

test('2-second silence window tolerates short pauses and stops 2 seconds after final pause',()=>{
  const s=simulator();
  s.start('Inspected brakes');
  const mic=s.instances[0];
  assert.equal(mic.continuous,true);
  assert.equal(mic.interimResults,true);
  mic.speechStart();
  mic.result(['replaced air',false]);
  mic.result(['replaced air valve',true]);
  mic.speechEnd();
  s.advance(700);
  assert.deepEqual(s.listening,[true]);
  mic.speechStart(); // technician continues after a short pause
  s.advance(3500);
  assert.deepEqual(s.listening,[true],'speaking again cancels previous idle timeout');
  mic.result(['replaced air valve',true],['tested brakes',false]);
  mic.result(['replaced air valve',true],['tested brake pressure',true]);
  mic.speechEnd();
  s.advance(1999);
  assert.deepEqual(s.listening,[true]);
  s.advance(1);
  assert.deepEqual(s.listening,[true,false]);
  assert.equal(mic.stopCount,1);
  assert.equal(s.last(),'Inspected brakes replaced air valve tested brake pressure');
  assert.match(s.messages.at(-1),/2 seconds of silence/);
});

test('interim transcript updates rather than getting appended repeatedly when final results arrive',()=>{
  const s=simulator();
  s.start('Found leak.');
  const mic=s.instances[0];
  mic.result(['remove',false]);
  assert.equal(s.last(),'Found leak. remove');
  mic.result(['removed hose',false]);
  assert.equal(s.last(),'Found leak. removed hose');
  mic.result(['removed hose',true]);
  mic.result(['removed hose',true],['installed clamp',false]);
  assert.equal(s.last(),'Found leak. removed hose installed clamp');
  mic.result(['removed hose',true],['installed clamp',true]);
  mic.result(['removed hose',true],['installed clamp',true]);
  assert.equal(s.last(),'Found leak. removed hose installed clamp');
});

test('if browser ends recognition early, the microphone restarts within the grace window and keeps the note',()=>{
  const s=simulator();
  s.start();
  const mic1=s.instances[0];
  mic1.result(['cleaned contacts',false]);
  s.advance(350);
  mic1.end();
  assert.equal(s.last(),'cleaned contacts');
  s.advance(100);
  assert.equal(s.instances.length,2,'recognition restarts while silence grace remains');
  assert.deepEqual(s.listening,[true,true]);
  const mic2=s.instances[1];
  mic2.speechStart();
  mic2.result(['replaced sensor',true]);
  mic2.speechEnd();
  s.advance(2000);
  assert.equal(s.last(),'cleaned contacts replaced sensor');
  assert.equal(s.listening.at(-1),false);
  assert.equal(s.instances.length,2,'no more restarts once silence expires');
});

test('STOP cancels silence timer and does not restart or duplicate recognized words',()=>{
  const s=simulator();
  const recorder=s.start('Unit 45');
  const mic=s.instances[0];
  mic.result(['replaced tire',false]);
  recorder.stop();
  assert.equal(s.last(),'Unit 45 replaced tire');
  assert.equal(s.listening.at(-1),false);
  assert.equal(mic.stopCount,1);
  mic.end();
  s.advance(9000);
  assert.equal(s.instances.length,1);
  assert.equal(s.timers.size,0);
});

test('permission errors stop recording; repair-switch disposal drops late callbacks',()=>{
  const s=simulator();
  const recorder=s.start();
  s.instances[0].result(['completed pressure test',false]);
  s.instances[0].onerror({error:'not-allowed'});
  assert.equal(s.listening.at(-1),false);
  assert.match(s.messages.at(-1),/not-allowed/);
  assert.equal(s.last(),'completed pressure test');
  s.advance(9000);
  assert.equal(s.instances.length,1);
  const recorder2=s.start('A new repair');
  const mic2=s.instances[1];
  const textBefore=s.last();
  recorder2.dispose();
  mic2.result(['leak',true]);
  mic2.end();
  s.advance(3000);
  assert.equal(s.last(),textBefore,'old microphone cannot edit a new repair note');
  recorder.dispose();
});

test('unsupported browsers are told to type instead of entering a broken listening state',()=>{
  const s=simulator({supported:false});
  assert.equal(s.start(),null);
  assert.equal(s.listening.length,0);
  assert.match(s.messages.at(-1),/not supported in this browser/);
});

test('all technician and working-manager note views use one dictation controller',()=>{
  for(const path of ['app/shop/technician-repair-tools-v2.tsx','app/shop/technician-repair-tools.tsx']){
    const ui=read(path);
    assert.match(ui,/import \{startNoteDictation,type NoteDictation\} from "@\/lib\/shop-voice-note-dictation"/);
    assert.match(ui,/startNoteDictation\(\{/);
    assert.match(ui,/initialText:note,onText:setNote,onMessage:setNoteMessage,onListening:setListening/);
    assert.match(ui,/recognitionRef\.current\?\.dispose\(\)/);
    assert.match(ui,/disabled=\{noteBusy\|\|listening\}/);
    assert.doesNotMatch(ui,/continuous=false/);
  }
});
