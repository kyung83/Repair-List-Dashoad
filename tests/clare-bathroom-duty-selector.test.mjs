import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('bathroom assignment selector lists Clare technicians exclusively',()=>{
 const lib=read('lib/shop-duties.ts');
 const page=read('app/shop-duties/page.tsx');
 assert.match(lib,/COALESCE\(yard/);
 assert.match(lib,/yard:row\.yard/);
 assert.match(page,/type Mechanic=\{[^}]*yard:string/);
 assert.match(page,/kind!=="bathroom"\|\|person\.yard\?\.trim\(\)\.toLowerCase\(\)==="clare"/);
 assert.match(page,/Rotates through Clare technicians only/);
});
