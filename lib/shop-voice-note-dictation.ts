/**
 * Browser speech-to-text for repair notes. Recognition is local to the active note editor:
 * pausing for 2 seconds ends dictation, but a brief pause does not.
 * A browser may end continuous recognition early; resume it only within that window.
 */
export const NOTE_SILENCE_MS=2000;
const RESTART_DELAY_MS=100;
const MAX_NOTE_LENGTH=2000;

export type SpeechResultLike={length:number;isFinal:boolean;[index:number]:{transcript:string}|undefined};
export type SpeechEventLike={results:ArrayLike<SpeechResultLike>};
export type RecognitionLike={
  lang:string;continuous:boolean;interimResults:boolean;
  start:()=>void;stop:()=>void;
  onresult:((event:SpeechEventLike)=>void)|null;
  onerror:((event:{error?:string})=>void)|null;
  onend:(()=>void)|null;
  onspeechstart:(()=>void)|null;
  onspeechend:(()=>void)|null;
};
type RecognitionCtor=new()=>RecognitionLike;
export type NoteDictation={
  stop:()=>void;
  dispose:()=>void;
};

export function startNoteDictation({
  initialText,onText,onMessage,onListening,
}:{
  initialText:string;
  onText:(value:string)=>void;
  onMessage:(message:string)=>void;
  onListening:(active:boolean)=>void;
}):NoteDictation|null{
  const browser=window as typeof window&{SpeechRecognition?:RecognitionCtor;webkitSpeechRecognition?:RecognitionCtor};
  const Recognition=browser.SpeechRecognition??browser.webkitSpeechRecognition;
  if(!Recognition){
    onMessage('Voice input is not supported in this browser. Use the keyboard microphone or type the note.');
    return null;
  }

  const prefix=initialText.trim();
  const finalWords:string[]=[];
  let pendingWords='';
  let running=true;
  let disposed=false;
  let speechActive=false;
  let lastActivity=Date.now();
  let activeEngine:RecognitionLike|null=null;
  let finalizedIndexes=new Set<number>();
  let silenceTimeout:ReturnType<typeof setTimeout>|null=null;
  let restartTimeout:ReturnType<typeof setTimeout>|null=null;

  function clearSilence(){
    if(silenceTimeout!==null){clearTimeout(silenceTimeout);silenceTimeout=null}
  }
  function clearRestart(){
    if(restartTimeout!==null){clearTimeout(restartTimeout);restartTimeout=null}
  }
  function render(){
    if(disposed)return;
    onText([prefix,...finalWords,pendingWords].filter(Boolean).join(' ').slice(0,MAX_NOTE_LENGTH));
  }
  function commitPending(){
    if(pendingWords.trim())finalWords.push(pendingWords.trim());
    pendingWords='';
    render();
  }
  function finish(message:string){
    if(!running)return;
    running=false;
    clearSilence();
    clearRestart();
    // Let a late final result replace any interim words before committing them.
    // Calling stop() may produce one more onresult before onend.
    if(!activeEngine)commitPending();
    if(!disposed){
      onListening(false);
      onMessage(message);
    }
    try{activeEngine?.stop()}catch{commitPending()}
  }
  function armSilence(){
    if(!running||disposed||speechActive)return;
    clearSilence();
    const remaining=Math.max(0,NOTE_SILENCE_MS-(Date.now()-lastActivity));
    silenceTimeout=setTimeout(()=>{
      silenceTimeout=null;
      if(running&&!speechActive)finish('Dictation finished after 2 seconds of silence. Review and SAVE NOTE.');
    },remaining);
  }

  function startEngine(){
    if(!running||disposed)return;
    let recognition:RecognitionLike;
    try{
      recognition=new Recognition();
      recognition.lang='en-US';
      recognition.continuous=true;
      recognition.interimResults=true;
    }catch{
      finish('Voice input could not start. You can still type the note.');
      return;
    }
    activeEngine=recognition;
    finalizedIndexes=new Set<number>();
    speechActive=false;
    recognition.onspeechstart=()=>{
      if(!running||disposed||activeEngine!==recognition)return;
      speechActive=true;
      lastActivity=Date.now();
      clearSilence();
    };
    recognition.onspeechend=()=>{
      if(!running||disposed||activeEngine!==recognition)return;
      speechActive=false;
      lastActivity=Date.now();
      armSilence();
    };
    recognition.onresult=event=>{
      if(disposed||activeEngine!==recognition)return;
      const interim:string[]=[];
      for(let i=0;i<event.results.length;i++){
        const result=event.results[i];
        const words=result?.[0]?.transcript?.trim()??'';
        if(!words)continue;
        if(result.isFinal){
          if(!finalizedIndexes.has(i)){
            finalizedIndexes.add(i);
            finalWords.push(words);
          }
        }else if(!finalizedIndexes.has(i)){
          interim.push(words);
        }
      }
      pendingWords=interim.join(' ');
      render();
      if(running){
        lastActivity=Date.now();
        if(!speechActive)armSilence();
      }
    };
    recognition.onerror=event=>{
      if(disposed||activeEngine!==recognition||!running)return;
      finish(event.error?'Voice input stopped: '+event.error+'. Your recognized words are still in the note.':'Voice input stopped. Your recognized words are still in the note.');
    };
    recognition.onend=()=>{
      if(activeEngine!==recognition)return;
      commitPending();
      activeEngine=null;
      speechActive=false;
      if(!running||disposed)return;
      // Chrome/Android can end a continuous recognition session early.
      // Resume only within the existing 2-second silence grace period.
      if(Date.now()-lastActivity>=NOTE_SILENCE_MS){
        finish('Dictation finished after 2 seconds of silence. Review and SAVE NOTE.');
        return;
      }
      armSilence();
      clearRestart();
      restartTimeout=setTimeout(()=>{
        restartTimeout=null;
        if(running&&!disposed)startEngine();
      },RESTART_DELAY_MS);
    };
    try{
      recognition.start();
      if(!disposed&&running)onListening(true);
    }catch{
      activeEngine=null;
      finish('Voice input could not restart. The words already recognized are preserved.');
    }
  }

  startEngine();
  return {
    stop:()=>finish('Dictation stopped. Review and SAVE NOTE.'),
    dispose:()=>{
      disposed=true;
      running=false;
      clearSilence();
      clearRestart();
      try{activeEngine?.stop()}catch{}
      activeEngine=null;
    },
  };
}
