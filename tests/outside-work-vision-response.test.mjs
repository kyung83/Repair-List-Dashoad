import test from 'node:test';
import assert from 'node:assert/strict';
import {extractResultObject,responseDiagnostic} from '../app/outside-work/vision-response.js';

const fields={
  vendorName:{value:'The Original On-Site Repair Service, Inc.',confidence:.96},
  vendorPhone:{value:'(810) 653-2709',confidence:.99},
  invoiceNumber:{value:'26747',confidence:.99},
  serviceDate:{value:'2026-08-18',confidence:.82},
  unitNumber:{value:'431',confidence:.78},
  mileage:{value:'',confidence:.1},
  totalAmount:{value:'707.81',confidence:.92},
  charges:[
    {label:'SERVICE CALL',amount:'139.00',confidence:.9},
    {label:'LABOR',amount:'333.50',confidence:.86},
    {label:'PARTS',amount:'235.31',confidence:.85},
  ],
  workPerformed:{value:['Road service repair'],confidence:.7},
};

test('unwraps Moondream env.AI.run result.answer envelope',()=>{
  const response={result:{answer:JSON.stringify(fields),finish_reason:'stop'},usage:{input_tokens:10,output_tokens:20}};
  assert.deepEqual(extractResultObject(response),fields);
  assert.match(responseDiagnostic(response),/Nested result keys: answer,finish_reason/);
  assert.match(responseDiagnostic(response),/vendorName/);
});

test('unwraps Qwen chat completion message content',()=>{
  const response={choices:[{message:{role:'assistant',content:`\`\`\`json\n${JSON.stringify(fields)}\n\`\`\``}}],model:'qwen'};
  assert.deepEqual(extractResultObject(response),fields);
});

test('unwraps Qwen multipart message content',()=>{
  const response={choices:[{message:{role:'assistant',content:[{type:'text',text:JSON.stringify(fields)}]}}]};
  assert.deepEqual(extractResultObject(response),fields);
});
