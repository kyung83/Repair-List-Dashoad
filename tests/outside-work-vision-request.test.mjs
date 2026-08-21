import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisionInput, normalizeVisionBase64 } from '../app/outside-work/vision-request.js';

test('Workers AI vision input sends raw base64 and structured output schema',()=>{
  const request=buildVisionInput({
    system:'Read the invoice.',
    user:'Return JSON.',
    imageBase64:'abc123',
  });
  assert.equal(request.image,'abc123');
  assert.deepEqual(request.messages,[
    {role:'system',content:'Read the invoice.'},
    {role:'user',content:'Return JSON.'},
  ]);
  assert.equal(request.response_format.type,'json_schema');
  assert.equal(request.response_format.json_schema.type,'object');
  assert.equal(Array.isArray(request.messages[1].content),false);
  assert.equal('image_url' in request,false);
});

test('vision input strips a data URI prefix defensively',()=>{
  assert.equal(normalizeVisionBase64('data:image/jpeg;base64,abc123'),'abc123');
});
