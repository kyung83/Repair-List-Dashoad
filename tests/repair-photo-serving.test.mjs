import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const photoRoute=readFileSync(new URL('../app/api/photos/[...key]/route.ts',import.meta.url),'utf8');
const repairPhotos=readFileSync(new URL('../app/api/shop/repair-photos/route.ts',import.meta.url),'utf8');

test('saved repair-work photo URLs are accepted by the shared photo-serving route',()=>{
  assert.match(repairPhotos,/repair-work\/\$\{id\}\//);
  assert.match(photoRoute,/objectKey\.startsWith\('repair-work\/'\)/);
  assert.match(photoRoute,/!maintenancePhoto && !roadsidePhoto && !repairWorkPhoto/);
});

test('repair-work photo serving preserves repair ownership security',()=>{
  assert.match(photoRoute,/FROM repair_work_photos p/);
  assert.match(photoRoute,/JOIN repairs r ON r\.id=p\.repair_id/);
  assert.match(photoRoute,/user\.role === 'manager' \|\| user\.role === 'admin'/);
  assert.match(photoRoute,/user\.role === 'mechanic'/);
  assert.match(photoRoute,/Number\(row\.technician_id \?\? 0\) === Number\(user\.technicianId\)/);
});

test('authorized repair-work photos still stream from R2 with stored metadata',()=>{
  assert.match(photoRoute,/const object = await env\.FILES\.get\(objectKey\)/);
  assert.match(photoRoute,/object\.writeHttpMetadata\(headers\)/);
  assert.match(photoRoute,/return new Response\(object\.body, \{ headers \}\)/);
});
