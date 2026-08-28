import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function sources(){
  const [bridge,route,wrangler,build,wrapper,reader]=await Promise.all([
    readFile(new URL('../app/outside-work/ai-reading-bridge.tsx',import.meta.url),'utf8'),
    readFile(new URL('../app/api/outside-work/ai-read/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../wrangler.template.jsonc',import.meta.url),'utf8'),
    readFile(new URL('../scripts/build-verified.sh',import.meta.url),'utf8'),
    readFile(new URL('../app/outside-work/intake-v3.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/outside-work-ai-reader.ts',import.meta.url),'utf8'),
  ]);
  return[bridge,`${route}\n${reader}`,wrangler,build,wrapper];
}

test('Outside Work captures the selected file before native input clearing, then defers AI work',async()=>{
  const [bridge]=await sources();
  assert.match(bridge,/outside-work-camera-input/);
  assert.match(bridge,/outside-work-file-input/);
  assert.match(bridge,/const file=input\.files\?\.\[0\]/);
  assert.match(bridge,/window\.setTimeout\(\(\)=>void readInvoice\(file\),0\)/);
  assert.match(bridge,/document\.addEventListener\("change",handler,true\)/);
  assert.match(bridge,/fetch\("\/api\/outside-work\/ai-read"/);
  assert.match(bridge,/Handwriting is read automatically/);
  assert.match(bridge,/applyReading\(result\.reading\)/);
});

test('AI result is applied only after native OCR is finished so OCR cannot overwrite handwriting fields',async()=>{
  const [bridge]=await sources();
  assert.match(bridge,/function nativeReaderBusy\(/);
  assert.match(bridge,/READING DOCUMENT/);
  assert.match(bridge,/await waitForNativeReader/);
  const waitIndex=bridge.indexOf('await waitForNativeReader');
  const applyIndex=bridge.indexOf('applyReading(result.reading)');
  assert.ok(waitIndex>=0&&applyIndex>waitIndex,'AI reading must be applied after waiting for native OCR');
  assert.match(bridge,/after OCR/);
});

test('automatic reader never mutates React-owned Outside Work DOM structure',async()=>{
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

test('GPT-5.6 Sol uses its required Responses-format multimodal request',async()=>{
  const [,route]=await sources();
  assert.match(route,/OUTSIDE_WORK_PRIMARY_MODEL='openai\/gpt-5\.6-sol'/);
  assert.match(route,/function primaryInput\(imageUrls:string\[\]\)/);
  assert.match(route,/instructions:SYSTEM_PROMPT/);
  assert.match(route,/type:'input_text',text:USER_PROMPT/);
  assert.match(route,/type:'input_image',image_url,detail:'high'/);
  assert.match(route,/max_output_tokens:1800/);
  assert.match(route,/tryModel\(ai,db,OUTSIDE_WORK_PRIMARY_MODEL,primaryInput\(imageUrls\),\{gateway:\{id:'default'\}\}\)/);
});

test('Qwen vision remains a separate chat-format fallback',async()=>{
  const [,route]=await sources();
  assert.match(route,/OUTSIDE_WORK_FALLBACK_MODEL='@cf\/qwen\/qwen3\.8-27b'/);
  assert.match(route,/function fallbackInput\(imageUrls:string\[\]\)/);
  assert.match(route,/type:'image_url',image_url:\{url\}/);
  assert.match(route,/response_format:\{type:'json_object'\}/);
  assert.match(route,/tryModel\(ai,db,OUTSIDE_WORK_FALLBACK_MODEL,fallbackInput\(imageUrls\)\)/);
});

test('server accepts Responses and chat-completion output shapes',async()=>{
  const [,route]=await sources();
  assert.match(route,/row\.output_text/);
  assert.match(route,/contentText\(row\.output\)/);
  assert.match(route,/row\.choices\?\.\[0\]\?\.message\?\.content/);
  assert.match(route,/contentText\(row\.result\?\.output\)/);
});

test('server validates AI-read units against active Master Equipment',async()=>{
  const [,route]=await sources();
  assert.match(route,/SELECT unit,vin FROM equipment/);
  assert.match(route,/active=1 AND archived_at IS NULL AND merged_into_equipment_id IS NULL/);
  assert.match(route,/AI read a VIN as the unit/);
  assert.match(route,/does not match one active Master Equipment unit/);
  assert.match(route,/reading\.unit=''/);
});

test('server keeps fail-closed invoice extraction rules',async()=>{
  const [,route]=await sources();
  assert.match(route,/getSessionUser\(env\.DB,request\)/);
  assert.match(route,/manager.*admin/s);
  assert.match(route,/Northern Logistics\/Norlow is the customer, not the outside repair vendor/);
  assert.match(route,/Keep invoiceNumber and unit distinct/);
  assert.match(route,/serviceDate must be YYYY-MM-DD only when month, day, AND year are clearly present/);
  assert.match(route,/Do not guess from context/);
  assert.match(route,/Cost breakdown:/);
});

test('reader status visibly names the model that handled the invoice',async()=>{
  const [bridge]=await sources();
  assert.match(bridge,/GPT-5\.6 Sol/);
  assert.match(bridge,/Qwen 3\.8 27B fallback/);
  assert.match(bridge,/modelLabel\(result\.model/);
  assert.match(bridge,/position:"sticky"/);
  assert.match(bridge,/GPT-5\.6 SOL · READING/);
});

test('production Worker config requires the AI binding',async()=>{
  const [,,wrangler,build]=await sources();
  assert.match(wrangler,/"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"/s);
  assert.match(build,/config\.ai\?\.binding !== "AI"/);
  assert.match(build,/AI handwriting binding/);
  assert.doesNotMatch(build,/intentionally no-AI/);
});
