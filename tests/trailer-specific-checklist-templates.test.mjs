import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('migrations/0173_trailer_specific_pm_and_annual.sql');
const activeRoute=read('app/api/maintenance-checklist/route.ts');
const templates=read('lib/maintenance-checklist-templates.ts');

function fixture(custom=false){
  const db=new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE maintenance_checklist_templates(
      id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,
      template_key TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,active INTEGER NOT NULL,
      UNIQUE(event_type,template_key,version)
    );
    CREATE UNIQUE INDEX idx_maintenance_checklist_templates_active
    ON maintenance_checklist_templates(event_type,template_key) WHERE active=1;
    CREATE TABLE maintenance_checklist_template_items(
      id INTEGER PRIMARY KEY AUTOINCREMENT,template_id INTEGER NOT NULL REFERENCES maintenance_checklist_templates(id),
      position INTEGER NOT NULL,section TEXT NOT NULL,item_text TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
      allow_pass INTEGER NOT NULL DEFAULT 1,allow_fail INTEGER NOT NULL DEFAULT 1,allow_na INTEGER NOT NULL DEFAULT 1,
      require_notes INTEGER NOT NULL DEFAULT 0,require_photo INTEGER NOT NULL DEFAULT 0,
      require_measurement INTEGER NOT NULL DEFAULT 0,measurement_label TEXT,measurement_unit TEXT,
      UNIQUE(template_id,position)
    );
    CREATE TABLE maintenance_checklist_template_assignments(
      event_type TEXT NOT NULL,applies_to TEXT NOT NULL,template_key TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(event_type,applies_to)
    );
    CREATE TABLE maintenance_checklist_runs(id INTEGER PRIMARY KEY,template_id INTEGER,template_version INTEGER,status TEXT);
    CREATE TABLE maintenance_checklist_items(id INTEGER PRIMARY KEY,checklist_run_id INTEGER,item_text TEXT,result TEXT);
    INSERT INTO maintenance_checklist_templates(event_type,template_key,name,version,active)
      VALUES('pm','default','Performance PM Checklist',1,1),
      ('annual','default','Annual Inspection Checklist',1,1);
    INSERT INTO maintenance_checklist_template_assignments(event_type,applies_to,template_key) VALUES
      ('pm','truck','default'),('annual','truck','default'),
      ('pm','trailer','default'),('annual','trailer','default');
    INSERT INTO maintenance_checklist_runs VALUES(100,1,1,'in_progress');
    INSERT INTO maintenance_checklist_items VALUES(200,100,'Existing inspection item','pass');
  `);
  if(custom){
    db.exec(`
      INSERT INTO maintenance_checklist_templates(event_type,template_key,name,version,active)
        VALUES('annual','custom-existing','Custom Annual',1,1);
      UPDATE maintenance_checklist_template_assignments
        SET template_key='custom-existing' WHERE event_type='annual' AND applies_to='trailer';
    `);
  }
  return db;
}
function countItems(db,kind,key){
  return db.prepare(`
    SELECT COUNT(*) AS n FROM maintenance_checklist_template_items i
    JOIN maintenance_checklist_templates t ON t.id=i.template_id
    WHERE t.event_type=? AND t.template_key=? AND t.version=1 AND i.enabled=1
  `).get(kind,key).n;
}
function assigned(db,kind,target){
  return db.prepare('SELECT template_key FROM maintenance_checklist_template_assignments WHERE event_type=? AND applies_to=?').get(kind,target).template_key;
}

test('trailer PM and Annual get distinct active templates; truck defaults are unchanged',()=>{
  const db=fixture();
  db.exec(migration);
  assert.equal(countItems(db,'pm','trailer-service'),39);
  assert.equal(countItems(db,'annual','trailer-annual-dot'),40);
  assert.equal(assigned(db,'pm','trailer'),'trailer-service');
  assert.equal(assigned(db,'annual','trailer'),'trailer-annual-dot');
  assert.equal(assigned(db,'pm','truck'),'default');
  assert.equal(assigned(db,'annual','truck'),'default');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM maintenance_checklist_templates WHERE template_key='default' AND active=1").get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM maintenance_checklist_runs WHERE id=100 AND template_id=1 AND template_version=1 AND status='in_progress'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM maintenance_checklist_items WHERE checklist_run_id=100 AND item_text='Existing inspection item' AND result='pass'").get().n,1);
  db.exec(migration);
  assert.equal(countItems(db,'pm','trailer-service'),39);
  assert.equal(countItems(db,'annual','trailer-annual-dot'),40);
  db.close();
});
test('a manager custom trailer template assignment is not silently overwritten',()=>{
  const db=fixture(true);
  db.exec(migration);
  assert.equal(assigned(db,'pm','trailer'),'trailer-service');
  assert.equal(assigned(db,'annual','trailer'),'custom-existing');
  assert.equal(assigned(db,'annual','truck'),'default');
  db.close();
});
test('Annual includes essential trailer safety categories, rear impact guard and ABS; PM excludes truck maintenance',()=>{
  const db=fixture();
  db.exec(migration);
  const annual=db.prepare(`SELECT section,item_text,allow_na FROM maintenance_checklist_template_items i JOIN maintenance_checklist_templates t ON t.id=i.template_id WHERE t.template_key='trailer-annual-dot' ORDER BY i.position`).all();
  const pm=db.prepare(`SELECT section,item_text FROM maintenance_checklist_template_items i JOIN maintenance_checklist_templates t ON t.id=i.template_id WHERE t.template_key='trailer-service' ORDER BY i.position`).all();
  for(const area of ['Brake','Coupling','Lighting','Safe Loading','Suspension','Frame','Tires','Wheels','Rear Impact Guard']){
    assert.ok(annual.some(q=>q.section.includes(area)),area+' missing from Annual');
  }
  for(const term of ['ABS','pushrod','rear impact guard','tread','fasteners','brake','coupler']){
    assert.ok(annual.some(q=>q.item_text.toLowerCase().includes(term.toLowerCase())),term+' missing');
  }
  for(const term of ['kingpin','landing gear','glad hands','air','tire','lamps','Conestoga','flatbed','DOT']){
    assert.ok(pm.some(q=>q.item_text.toLowerCase().includes(term.toLowerCase())),term+' missing from PM');
  }
  assert.equal(annual.some(q=>/windshield wipers|clutch pedal|engine oil|cab air filter|power steering/i.test(q.item_text)),false);
  assert.equal(pm.some(q=>/engine oil|clutch|cab hvac|fuel filter|start truck/i.test(q.item_text)),false);
  assert.ok(annual.some(q=>q.section==='Rear Impact Guard'&&q.allow_na===1),'exemption-aware rear guard N/A');
  assert.ok(annual.some(q=>q.section==='Tires'&&q.allow_na===0),'required tires cannot be marked N/A');
  db.close();
});
test('runs are snapshotted before template lookup, protecting started inspections',()=>{
  assert.match(activeRoute,/const existing = await loadRun\(repair\.id\);[\s\S]*if \(existing\) return existing/);
  assert.match(activeRoute,/getAssignedChecklistTemplate\(env\.DB, kind, appliesTo\)/);
  assert.match(activeRoute,/JOIN maintenance_checklist_template_items i ON i\.template_id = \?/);
  assert.match(templates,/ON CONFLICT\(event_type, applies_to\) DO UPDATE/);
  assert.doesNotMatch(migration,/\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bALTER\s+TABLE\b|UPDATE\s+maintenance_checklist_runs|UPDATE\s+maintenance_checklist_items/i);
});
