import { env } from 'cloudflare:workers';
import { secureTokenEqual } from '@/lib/auth';

const KEY_ROW='truck-masterlist-rsa-key-v1';

function toBase64(bytes:ArrayBuffer){
  let binary='';
  for(const byte of new Uint8Array(bytes))binary+=String.fromCharCode(byte);
  return btoa(binary);
}

async function authorized(request:Request){
  const expected=String(env.AUTH_BOOTSTRAP_TOKEN??'').trim();
  const header=String(request.headers.get('authorization')??'').trim();
  const provided=header.startsWith('Bearer ')?header.slice(7).trim():'';
  return Boolean(expected&&provided)&&await secureTokenEqual(provided,expected);
}

export async function GET(request:Request){
  if(!await authorized(request)){
    return Response.json({error:'Import key initialization is not authorized.'},{status:403,headers:{'cache-control':'no-store'}});
  }

  const existing=await env.DB.prepare('SELECT version_token FROM sync_state WHERE feed_name=?').bind(KEY_ROW).first<{version_token:string|null}>();
  if(existing?.version_token){
    try{
      const saved=JSON.parse(existing.version_token) as {publicKey?:string};
      if(saved.publicKey)return Response.json({ok:true,publicKey:saved.publicKey,reused:true},{headers:{'cache-control':'no-store'}});
    }catch{}
  }

  const pair=await crypto.subtle.generateKey({
    name:'RSA-OAEP',
    modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),
    hash:'SHA-256',
  },true,['encrypt','decrypt']) as CryptoKeyPair;

  const [publicKey,privateKey]=await Promise.all([
    crypto.subtle.exportKey('spki',pair.publicKey),
    crypto.subtle.exportKey('pkcs8',pair.privateKey),
  ]);
  const publicKeyB64=toBase64(publicKey);
  const privateKeyB64=toBase64(privateKey);

  await env.DB.prepare(`
    INSERT INTO sync_state(feed_name,version_token,last_success_at,last_error)
    VALUES(?,?,CURRENT_TIMESTAMP,NULL)
    ON CONFLICT(feed_name) DO UPDATE SET
      version_token=excluded.version_token,
      last_success_at=CURRENT_TIMESTAMP,
      last_error=NULL
  `).bind(KEY_ROW,JSON.stringify({alg:'RSA-OAEP-2048-SHA256',publicKey:publicKeyB64,privateKey:privateKeyB64})).run();

  return Response.json({ok:true,publicKey:publicKeyB64,reused:false},{headers:{'cache-control':'no-store'}});
}
