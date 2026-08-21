import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisionInput } from '../app/outside-work/vision-request.js';

test('Workers AI vision input uses top-level image with text messages',()=>{
  const request=buildVisionInput({
    system:'Read the invoice.',
    user:'Return JSON.',
    imageDataUri:'data:image/jpeg;base64,abc123',
  });
  assert.equal(request.image,'data:image/jpeg;base64,abc123');
  assert.deepEqual(request.messages,[
    {role:'system',content:'Read the invoice.'},
    {role:'user',content:'Return JSON.'},
  ]);
  assert.equal(Array.isArray(request.messages[1].content),false);
  assert.equal('image_url' in request,false);
});
