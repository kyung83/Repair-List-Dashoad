import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertDedicatedGeotabUsername, isRetiredPersonalGeotabUsername } from '../lib/geotab-account-policy.js';

const require=createRequire(import.meta.url);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const clientSource=read('lib/geotab-client.ts');
const dvirSource=read('lib/geotab.ts');
const mediaSource=read('lib/geotab-media.ts');
const diagnosticSource=read('lib/geotab-diagnostic.ts');
const yardSource=read('lib/geotab-yard.ts');
const fleetSource=read('lib/geotab-fleet.ts');
const runtimeSource=read('lib/geotab-runtime-credentials.ts');
const apiSource=read('app/api/admin/geotab-connection/route.ts');
const pageSource=read('app/admin/geotab-review/connection-panel.tsx');
const bootstrap=read('scripts/cloudflare-bootstrap.sh');

function compile(source,file){
 const built=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 const errors=(built.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,'\n')).join('\n'));
 return built.outputText;
}

function harness({saved={database:'fleet',username:'fleet-api-service@example.invalid',password:'service-pass'},legacyUsername='jtomaski@norloworld.com',expireFirstPhoto=false}={}){
 const calls=[];
 let logins=0,photos=0;
 const env={
  DB:{prepare(sql){
    calls.push({kind:'db',sql});
    return{
      first:async()=>null,
      bind(...values){return{run:async()=>({meta:{changes:1}})};}
    };
  }},
  GEOTAB_DATABASE:'fleet-old',
  GEOTAB_USERNAME:legacyUsername,
  GEOTAB_PASSWORD:'old-personal-password',
  GEOTAB_CONFIG_PRIVATE_KEY:'old-rsa-private-key',
 };
 async function remoteFetch(url,options){
  const {method,params}=JSON.parse(options.body);
  calls.push({kind:'fetch',url,method,params});
  if(method==='Authenticate'){
    logins+=1;
    return new Response(JSON.stringify({result:{
      credentials:{database:params.database,userName:params.userName,sessionId:'session-'+logins},
      path:'ThisServer',
    }}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(method==='DownloadMediaFile'){
    photos++;
    if(expireFirstPhoto&&photos===1)return new Response('',{status:401});
    return new Response(Uint8Array.from([0xff,0xd8,0xff,0xd9]),{
      status:200,headers:{'content-type':'image/jpeg'},
    });
  }
  return new Response(JSON.stringify({result:[{id:'a'}]}),{status:200,headers:{'content-type':'application/json'}});
 }
 const runtime={
   async loadGeotabRuntimeCredentials(){calls.push({kind:'runtime'});return saved;},
   async encryptGeotabRuntimeSecret(){return{ciphertext:'encrypted',iv:'iv'};},
   async decryptGeotabRuntimeSecret(){return 'session';},
 };
 const js=compile(clientSource,'lib/geotab-client.ts');
 const scope={
   exports:{},require(name){
     if(name==='./geotab-account-policy.js')return{assertDedicatedGeotabUsername,
       GEOTAB_SERVICE_ACCOUNT_REQUIRED:'Save dedicated Geotab service account in Diagnostics.'};
     if(name==='./geotab-runtime-credentials')return runtime;
     throw new Error('Unexpected import '+name);
   },
   crypto:webcrypto,fetch:remoteFetch,URL,Date,Response,
   setTimeout,Math,console,
 };
 runInNewContext(js,scope,{filename:'lib/geotab-client.ts'});
 return {env,calls,client:scope.exports};
}

test('retired personal Geotab username is rejected for test, save and runtime access',async()=>{
 for(const username of ['jtomaski','JTomaski@norloworld.com','j.tomaski@norloworld.com','jerry.tomaski']){
   assert.equal(isRetiredPersonalGeotabUsername(username),true);
   assert.throws(()=>assertDedicatedGeotabUsername(username),/personal jtomaski.*not permitted/);
   const f=harness({saved:{database:'fleet',username,password:'xyz'}});
   await assert.rejects(f.client.createGeotabClient(f.env),/personal jtomaski.*not permitted/);
   await assert.rejects(f.client.testGeotabCredentials({database:'fleet',username,password:'xyz'}),/personal jtomaski.*not permitted/);
   assert.equal(f.calls.filter(c=>c.kind==='fetch').length,0,'do not authenticate as retired account');
 }
});

test('every Geotab operation uses saved dedicated credentials despite old Cloudflare env secrets',async()=>{
 const f=harness();
 const client=await f.client.createGeotabClient(f.env);
 assert.equal(client.userName,'fleet-api-service@example.invalid');
 const results=await client.call('Get',{typeName:'DVIRLog'});
 assert.equal(results.length,1);
 const media=await client.downloadMedia('photo-123');
 assert.equal(media.contentType,'image/jpeg');
 assert.deepEqual(Array.from(new Uint8Array(media.bytes)),[255,216,255,217]);
 const requests=f.calls.filter(x=>x.kind==='fetch');
 assert.deepEqual(requests.map(x=>x.method),['Authenticate','Get','DownloadMediaFile']);
 assert.equal(requests[0].params.userName,'fleet-api-service@example.invalid');
 for(const req of requests){
   assert.doesNotMatch(JSON.stringify(req),/jtomaski|old-personal-password|old-rsa-private-key/);
   if(req.method!=='Authenticate')assert.equal(req.params.credentials.userName,'fleet-api-service@example.invalid');
 }
});

test('missing saved account stops BEFORE accessing old deployment or encrypted fallback credentials',async()=>{
 const f=harness({saved:null});
 await assert.rejects(f.client.createGeotabClient(f.env),/Save dedicated Geotab service account/);
 assert.equal(f.calls.filter(x=>x.kind==='fetch').length,0,'must not use old account');
 assert.equal(f.calls.filter(x=>x.kind==='runtime').length,1);
});

test('binary Geotab photo uses shared session and safely refreshes once after 401',async()=>{
 const f=harness({expireFirstPhoto:true});
 const client=await f.client.createGeotabClient(f.env);
 const photo=await client.downloadMedia('photo-123');
 assert.equal(photo.contentType,'image/jpeg');
 assert.equal(f.calls.filter(x=>x.method==='Authenticate').length,2);
 const downloads=f.calls.filter(x=>x.method==='DownloadMediaFile');
 assert.equal(downloads.length,2);
 assert.deepEqual(downloads.map(x=>x.params.credentials.sessionId),['session-1','session-2']);
});

test('manual credential test blocks personal account before any outbound Geotab request',async()=>{
 const f=harness();
 const user='jtomaski@norloworld.com';
 await assert.rejects(f.client.testGeotabCredentials({database:'fleet',username:user,password:'pass'}),/not permitted/);
 assert.equal(f.calls.filter(x=>x.kind==='fetch').length,0);
});

test('DVIR import, repair certification, images, diagnostics and optional yard sync share one client',()=>{
 for(const [name,source] of [
   ['DVIR import / certification',dvirSource],
   ['DVIR photos',mediaSource],
   ['connection diagnostics',diagnosticSource],
   ['yard sync',yardSource],
   ['fleet sync',fleetSource],
 ]){
   assert.match(source,/createGeotabClient/,name);
   assert.doesNotMatch(source,/geotabProtectedConfig|GEOTAB_USERNAME|GEOTAB_PASSWORD|protectedLogin|decryptProtectedLogin/,name);
   assert.doesNotMatch(source,/method:\s*['"]Authenticate['"]/,name);
 }
 assert.match(dvirSource,/await client\.call\('Set',\s*\{\s*typeName: 'DVIRLog'/);
 assert.match(dvirSource,/name: client\.userName/);
 assert.match(dvirSource,/await client\.call<JsonRecord\[\]>\('Get',/);
 assert.match(mediaSource,/client\.downloadMedia\(mediaId\)/);
 assert.match(diagnosticSource,/client\.call<unknown\[\]>\('Get'/);
 assert.match(clientSource,/async downloadMedia\(mediaId: string\)/);
 assert.match(clientSource,/await loadGeotabRuntimeCredentials\(env\.DB, env\)/);
 assert.doesNotMatch(clientSource,/protectedFallbackLogin|geotabProtectedConfig|env\.GEOTAB_USERNAME|env\.GEOTAB_PASSWORD/);
 assert.equal(existsSync(new URL('../lib/geotab-protected-config.ts',import.meta.url)),false);
});

test('all admin and manual sync pathways use dedicated runtime source, no credential override or deployment fallback',()=>{
 const maintenance=read('app/api/maintenance-setup/route.ts');
 const repairs=read('app/api/repairs/route.ts');
 const worker=read('worker/index.ts');
 assert.doesNotMatch(maintenance,/geotabEnvForSync|GEOTAB_USERNAME|GEOTAB_PASSWORD/);
 assert.match(maintenance,/syncGeotabDvir\(env\)/);
 assert.match(repairs,/getGeotabRuntimeCredentialMetadata\(env\.DB\)/);
 assert.doesNotMatch(repairs,/isGeotabConfigured/);
 assert.match(worker,/dvir = await syncGeotabDvir\(env\)/);
 assert.match(runtimeSource,/assertDedicatedGeotabUsername\(username\)/);
 assert.match(apiSource,/credentialSource: runtimeOverride\.active \? 'dedicated_service_account' : 'not_configured'/);
 assert.match(pageSource,/no old-login fallback/i);
 assert.match(bootstrap,/dedicated_geotab_account_ready/);
 assert.match(bootstrap,/findFlag\(payload\) !== 1/);
 assert.match(bootstrap,/npx wrangler deploy/);
 assert.ok(bootstrap.indexOf('findFlag(payload) !== 1')<bootstrap.lastIndexOf('npx wrangler deploy'));
});
