import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const repairPhotos=readFileSync(new URL('../app/api/shop/repair-photos/route.ts',import.meta.url),'utf8');
const maintenance=readFileSync(new URL('../app/api/maintenance-checklist/route.ts',import.meta.url),'utf8');
const repairType=readFileSync(new URL('../app/api/repair-type-checklist/route.ts',import.meta.url),'utf8');
const breakdowns=readFileSync(new URL('../app/api/breakdowns/route.ts',import.meta.url),'utf8');

test('repair photo upload uses the same buffered R2 pattern as working breakdown photos',()=>{
  assert.match(breakdowns,/const bytes = await file\.arrayBuffer\(\)/);
  assert.match(repairPhotos,/const bytes = await file\.arrayBuffer\(\)/);
  assert.match(repairPhotos,/env\.FILES\.put\(uploadedKey, bytes,/);
  assert.doesNotMatch(repairPhotos,/file\.stream\(\)/);
});

test('mobile checklist photo uploads also avoid direct Safari file streams',()=>{
  assert.match(maintenance,/const bytes = await file\.arrayBuffer\(\)/);
  assert.match(maintenance,/env\.FILES\.put\(key, bytes,/);
  assert.doesNotMatch(maintenance,/file\.stream\(\)/);

  assert.match(repairType,/bytes=await file\.arrayBuffer\(\)/);
  assert.match(repairType,/env\.FILES\.put\(key,bytes,/);
  assert.doesNotMatch(repairType,/file\.stream\(\)/);
});

test('buffered photo uploads preserve validated image content type metadata',()=>{
  assert.match(repairPhotos,/const contentType = String\(file\.type \|\| ''\)\.trim\(\)\.toLowerCase\(\) \|\| 'application\/octet-stream'/);
  assert.match(repairPhotos,/httpMetadata:\{ contentType \}/);
  assert.match(maintenance,/httpMetadata: \{ contentType \}/);
  assert.match(repairType,/httpMetadata:\{contentType\}/);
});
