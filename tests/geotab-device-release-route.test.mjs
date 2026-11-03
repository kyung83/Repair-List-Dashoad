import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { GeotabReleaseError, requireReleaseAdmin } from '../lib/geotab-device-release.js';

const source=readFileSync(new URL('../app/api/admin/geotab-release/route.ts',import.meta.url),'utf8');
function harness(user={id:7,role:'admin'}) {
  const calls=[];
  const built=ts.transpileModule(source,{fileName:'route.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal((built.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  const scope={exports:{},Response,URL,console,require(name){
    if(name==='cloudflare:workers')return{env:{DB:{}}};
    if(name==='@/lib/auth')return{getSessionUser:async()=>user};
    if(name==='@/lib/geotab-device-release.js')return{
      GeotabReleaseError,requireReleaseAdmin,
      searchGeotabReleaseLinks:async()=>{requireReleaseAdmin(user);return[];},
      releaseGeotabDevice:async(db,actor,body)=>{calls.push(body);return{ok:true};},
    };
    throw new Error('Unexpected import '+name);
  }};
  runInNewContext(built.outputText,scope);
  const request=(origin='https://fleet.example',body={action:'release'})=>new Request('https://fleet.example/api/admin/geotab-release',{
    method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body),
  });
  return{route:scope.exports,calls,request};
}

test('GPS release route requires an admin session and blocks other roles',async()=>{
  for(const [user,status] of [[null,401],[{id:8,role:'mechanic'},403],[{id:8,role:'manager'},403],[{id:7,role:'admin',dispatchAccess:true},403]]){
    const h=harness(user);assert.equal((await h.route.POST(h.request())).status,status);assert.equal(h.calls.length,0);
  }
});
test('GPS release route rejects cross-site, missing origin and invalid actions',async()=>{
  const h=harness();
  for(const origin of ['https://other.example',''])assert.equal((await h.route.POST(h.request(origin))).status,403);
  assert.equal((await h.route.POST(h.request('https://fleet.example',{action:'archive'}))).status,400);
  assert.equal(h.calls.length,0);
});
test('same-origin JSON admin request reaches the guarded release function',async()=>{
  const h=harness(),response=await h.route.POST(h.request());
  assert.equal(response.status,200);assert.equal(h.calls.length,1);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('release UI and assignment page parse as TypeScript JSX',()=>{
  for(const path of ['app/admin/geotab-review/device-release-panel.tsx','app/admin/geotab-review/assignments/page.tsx']){
    const text=readFileSync(new URL('../'+path,import.meta.url),'utf8');
    const built=ts.transpileModule(text,{fileName:path,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
    const errors=(built.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
    assert.equal(errors.length,0,errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('\n'));
  }
});
