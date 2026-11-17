import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('mechanic form shows prominent default-on Assign to Me control',()=>{
 const ui=read('app/repair-board/add-repair-form.tsx');
 assert.match(ui,/allowSelfAssignment=false/);
 assert.match(ui,/const\[assignToMe,setAssignToMe\]=useState\(true\)/);
 assert.match(ui,/aria-label="Assign to Me"/);
 assert.match(ui,/ASSIGN TO ME/);
 assert.match(ui,/\{assignToMe\}/);
 assert.match(ui,/\.\.\.\(allowSelfAssignment\?\{assignToMe\}:\{\}\)/);
});
test('both repair form placements enable self-assignment only for technicians',()=>{
 const p=read('app/repair-board/planning-center.tsx');
 assert.equal(p.split("allowSelfAssignment={data.user.role==='mechanic'}").length-1,2);
});
test('server accepts opt-out and defaults to secure mechanic self assignment',()=>{
 const api=read('app/api/repair-types/create-repair/route.ts');
 assert.match(api,/if\(mechanic&&body\.assignToMe===false\)technician=null/);
 assert.match(api,/const status=technician\?'Assigned':'New'/);
 assert.match(api,/if\(!mechanic\)\{/);
});
