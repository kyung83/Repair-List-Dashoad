import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function sources(){
  return Promise.all([
    readFile(new URL('../app/outside-work/ai-reading-bridge.tsx',import.meta.url),'utf8'),
    readFile(new URL('../app/api/outside-work/ai-read/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../wrangler.template.jsonc',import.meta.url),'utf8'),
    readFile(new URL('../scripts/build-verified.sh',import.meta.url),'utf8'),
    readFile(new URL('../app/outside-work/intake-v3.tsx',import.meta.url),'utf8'),
  ]);
}

test('Outside Work automatically sends a selected invoice to the AI handwriting reader',async()=>{
  const [bridge]=await sources();
  assert.match(bridge,/outside-work-camera-input/);
  assert.match(bridge,/outside-work-file-input/);
  assert.match(bridge,/document\.addEventListener\("change",handler\)/);
  assert.doesNotMatch(bridge,/document\.addEventListener\("change",handler,true\)/);
  assert.match(bridge,/window\.setTimeout\(\(\)=>void readInvoice\(file\),0\)/);
  assert.match(bridge,/fetch\("\/api\/outside-work\/ai-read"/);
  assert.match(bridge,/Reading printed text and handwriting automatically/);
  assert.match(bridge,/applyReading\(result\.reading\)/);
  assert.match(bridge,/FILLED STEP 2/);
});

test('automatic reader never mutates React-owned Outside Work DOM',async()=>{
  const [bridge,,,,wrapper]=await sources();
  assert.match(wrapper,/AiReadingBridge/);
  assert.match(wrapper,/OutsideWorkIntakeV2/);
  assert.doesNotMatch(wrapper,/MutationObserver/);
  assert.doesNotMatch(wrapper,/textContent\s*=/);
  assert.doesNotMatch(wrapper,/querySelector/);
  assert.doesNotMatch(bridge,/createPortal/);
  assert.doesNotMatch(bridge,/insertBefore\(/);
  assert.doesNotMatch(bridge,/outside-work-ai-inline-host/);
  assert.doesNotMatch(bridge,/parentElement/);
  assert.match(bridge,/return <section/);
});

test('normal use has no copy-prompt or paste-back workflow',async()=>{
  const [bridge]=await sources();
  assert.doesNotMatch(bridge,/COPY READING PROMPT/);
  assert.doesNotMatch(bridge,/APPLY TO REVIEW FIELDS/);
  assert.doesNotMatch(bridge,/ChatGPT or Claude/);
  assert.doesNotMatch(bridge,/navigator\.clipboard/);
  assert.match(bridge,/Handwriting is read automatically/);
  assert.match(bridge,/TRY AI AGAIN/);
});

test('PDF scans are rendered into page images before AI reading',async()=>{
  const [bridge]=await sources();
  assert.match(bridge,/MAX_AI_PAGES=3/);
  assert.match(bridge,/pdf\.getPage\(pageNumber\)/);
  assert.match(bridge,/page\.render\(\{canvasContext:context,viewport\}\)/);
  assert.match(bridge,/body\.append\("image",page/);
});

test('server uses Cloudflare vision AI with fail-closed invoice extraction rules',async()=>{
  const [,route]=await sources();
  assert.match(route,/@cf\/google\/gemma-4-26b-a4b-it/);
  assert.match(route,/getSessionUser\(env\.DB,request\)/);
  assert.match(route,/manager.*admin/s);
  assert.match(route,/type:'image_url'/);
  assert.match(route,/Northern Logistics\/Norlow is the customer, not the outside repair vendor/);
  assert.match(route,/serviceDate must be YYYY-MM-DD only when month, day, AND year are clearly present/);
  assert.match(route,/Do not guess from context/);
  assert.match(route,/Cost breakdown:/);
});

test('production Worker config requires the AI binding',async()=>{
  const [,,wrangler,build]=await sources();
  assert.match(wrangler,/"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"/s);
  assert.match(build,/config\.ai\?\.binding !== "AI"/);
  assert.match(build,/AI handwriting binding/);
  assert.doesNotMatch(build,/intentionally no-AI/);
});
