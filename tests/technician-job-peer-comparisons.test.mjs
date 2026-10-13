import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { technicianJobWorkSql } from "../lib/technician-job-comparison-sql.js";
import { buildTechnicianJobComparisons, classifyTechnicianJob } from "../lib/technician-job-comparison-core.js";

const reportRange={startDate:"2026-10-01",endDate:"2026-10-13"};
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE technicians(id INTEGER PRIMARY KEY,name TEXT,active INTEGER);"+
    "CREATE TABLE equipment(id INTEGER PRIMARY KEY,unit TEXT);"+
    "CREATE TABLE repair_types(id INTEGER PRIMARY KEY,name TEXT);"+
    "CREATE TABLE maintenance_checklist_templates(id INTEGER PRIMARY KEY,template_key TEXT,name TEXT,version INTEGER);"+
    "CREATE TABLE maintenance_checklist_runs(id INTEGER PRIMARY KEY,repair_id INTEGER UNIQUE,template_id INTEGER,event_type TEXT);"+
    "CREATE TABLE repairs(id INTEGER PRIMARY KEY,title TEXT,status TEXT,source TEXT,opened_at TEXT,completed_at TEXT,equipment_id INTEGER,repair_type_id INTEGER);"+
    "CREATE TABLE repair_labor_entries(id INTEGER PRIMARY KEY AUTOINCREMENT,repair_id INTEGER,technician_id INTEGER,labor_date TEXT,hours REAL,started_at TEXT,ended_at TEXT);"+
    "CREATE INDEX idx_labor_tech_date ON repair_labor_entries(technician_id,labor_date);"+
    "INSERT INTO technicians VALUES(1,'Alice',1),(2,'Bob',1),(3,'Carlos',1);"+
    "INSERT INTO equipment VALUES(1,'571(DC)'),(2,'575(SC)');"+
    "INSERT INTO repair_types VALUES(1,'ENGINE'),(2,'BRAKES-ABS'),(3,'INDIRECT LABOR-OTHER');"+
    "INSERT INTO maintenance_checklist_templates VALUES(7,'shop-pm','PM checklist',1),(8,'shop-pm','PM checklist',2);");
  const repair=db.prepare("INSERT INTO repairs(id,title,status,source,opened_at,completed_at,equipment_id,repair_type_id) VALUES (?,?,?,?,?,?,?,?)");
  function addRepair(id,title,personType="repair",status="Completed",opened="2026-10-03",closed="2026-10-05",repairType=1){
    repair.run(id,title,status,personType,opened,closed,1,repairType);
  }
  addRepair(100,"Air leak repair");
  addRepair(101,"Air leak repair");
  addRepair(102,"Air leak repair");
  addRepair(103,"Air leak repair");
  addRepair(104,"Air leak repair");
  addRepair(105,"Engine repair (shared)");
  addRepair(107,"Routine PM","scheduled-pm","Completed","2026-10-04","2026-10-04",null);
  addRepair(108,"Routine PM","scheduled-pm","Completed","2026-10-04","2026-10-04",null);
  addRepair(109,"Routine PM","scheduled-pm","Completed","2026-10-04","2026-10-04",null);
  addRepair(110,"Manual time","repair","Completed","2026-10-04","2026-10-04",1);
  addRepair(111,"Not done","repair","In Progress","2026-10-04","",1);
  addRepair(112,"No repair type","repair","Completed","2026-10-04","2026-10-04",null);
  addRepair(113,"Annual checklist unknown","scheduled-annual","Completed","2026-10-04","2026-10-04",null);
  addRepair(114,"Old job","repair","Completed","2026-09-15","2026-10-04",1);
  addRepair(115,"Shop cleanup","indirect-labor","Completed","2026-10-04","2026-10-04",3);
  addRepair(116,"Other year","repair","Completed","2026-09-04","2026-09-05",1);
  db.exec("INSERT INTO maintenance_checklist_runs VALUES(1,107,7,'pm'),(2,108,7,'pm'),(3,109,8,'pm'),(4,113,NULL,'annual');");
  const labor=db.prepare("INSERT INTO repair_labor_entries(repair_id,technician_id,labor_date,hours,started_at,ended_at) VALUES (?,?,?,?,?,?)");
  function addLabor(repairId,tech,hours,date="2026-10-05",timed=true){
    labor.run(repairId,tech,date,hours,timed?date+" 08:00:00":null,timed?date+" 12:00:00":null);
  }
  addLabor(100,1,2);addLabor(100,1,1); // Two sessions, one WO.
  addLabor(101,1,4);
  addLabor(102,2,6);addLabor(103,2,7);
  addLabor(104,3,5);
  addLabor(105,1,2);addLabor(105,2,4); // Shared WO never in solo benchmark.
  addLabor(107,1,2);addLabor(108,2,2.5);addLabor(109,3,8);
  addLabor(110,2,9,"2026-10-05",false);
  addLabor(111,1,5);
  addLabor(112,2,2);
  addLabor(113,2,2);
  addLabor(114,1,7);
  addLabor(115,1,10); // Indirect omitted from job comparison, stays in base report.
  addLabor(116,1,5,"2026-09-05");
  return db;
}

function report(){
  const db=fixture();
  const sourceRows=db.prepare(technicianJobWorkSql()).all(reportRange.startDate,reportRange.endDate);
  const result=buildTechnicianJobComparisons(sourceRows,reportRange);
  db.close();
  return {sourceRows,result};
}

test("job comparison uses per-technician and per-WO aggregation, not labor-entry count",()=>{
  const {sourceRows,result}=report();
  const alice=sourceRows.find(r=>r.repair_id===100&&r.technician_id===1);
  assert.equal(alice.hours,3);
  assert.equal(alice.entries,2);
  assert.equal(result.summary.uniqueWorkOrders,14);
  assert.equal(sourceRows.filter(r=>r.repair_id===115).length,0);
  assert.equal(sourceRows.filter(r=>r.repair_id===116).length,0);
});

test("same repair type compares SOLO completed timer-confirmed full-period jobs to other techs, excluding self",()=>{
  const {result}=report();
  const engine=result.comparisons.filter(c=>c.categoryKey==="repair-type:1");
  assert.equal(engine.length,3);
  const alice=engine.find(t=>t.technician==="Alice");
  const bob=engine.find(t=>t.technician==="Bob");
  const carlos=engine.find(t=>t.technician==="Carlos");
  assert.deepEqual([alice.jobCount,alice.averageHours,alice.peerJobs,alice.peerAverageHours,alice.timeVsPeersPercent],
    [2,3.5,3,6,-41.7]);
  assert.deepEqual([bob.jobCount,bob.averageHours,bob.peerAverageHours,bob.timeVsPeersPercent],[2,6.5,4,62.5]);
  assert.deepEqual([carlos.jobCount,carlos.averageHours,carlos.peerAverageHours,carlos.timeVsPeersPercent],[1,5,5,0]);
  assert.equal(alice.sample,"Small comparison sample"); // One peer has only one job.
  assert.ok(result.jobTypes.some(c=>c.key==="repair-type:1"&&c.eligibleJobs===5));
});

test("PM comparison uses exact checklist version, not every PM style as one class",()=>{
  const {result}=report();
  assert.equal(result.comparisons.filter(c=>c.categoryKey==="pm:7").length,2);
  assert.equal(result.comparisons.filter(c=>c.categoryKey==="pm:8").length,0);
  const pmV1=result.jobTypes.find(type=>type.key==="pm:7");
  const pmV2=result.jobTypes.find(type=>type.key==="pm:8");
  assert.equal(pmV1.name,"PM – PM checklist (v1)");
  assert.equal(pmV1.eligibleJobs,2);
  assert.equal(pmV2.name,"PM – PM checklist (v2)");
  assert.equal(pmV2.eligibleJobs,1);
  const annual=result.workOrders.find(w=>w.repairId===113);
  assert.match(annual.excludedReason,/No versioned PM\/Annual checklist/);
});

test("an identical shared WO shows each technician's labor share, not false head-to-head job speed",()=>{
  const {result}=report();
  assert.equal(result.sharedRepairs.length,1);
  const shared=result.sharedRepairs[0];
  assert.equal(shared.repairId,105);
  assert.equal(shared.totalHours,6);
  assert.deepEqual(shared.members.map(x=>[x.technician,x.hours,x.sharePercent]),
    [["Bob",4,66.7],["Alice",2,33.3]]);
  assert.equal(result.workOrders.filter(x=>x.repairId===105&&x.comparable).length,0);
  assert.ok(result.workOrders.every(x=>x.repairId!==105||x.excludedReason.includes("Multiple technicians")));
});

test("unfinished, manual, unclassified, and boundary-crossing WOs are explained rather than ranked",()=>{
  const {result}=report();
  const reason=id=>result.workOrders.find(j=>j.repairId===id)?.excludedReason;
  assert.match(reason(110),/Manual\/legacy/);
  assert.match(reason(111),/not completed/);
  assert.match(reason(112),/No repair type/);
  assert.match(reason(114),/opened or completed outside/);
  assert.equal(result.workOrders.filter(x=>x.comparable).length,8);
  assert.throws(()=>buildTechnicianJobComparisons(new Array(10001).fill({}),reportRange),RangeError);
  assert.equal(classifyTechnicianJob({source:"scheduled-annual",maintenance_template_id:0}).comparable,false);
});

test("peer job reporting has manager access, separate browsing, CSV and transparency about what percent means",()=>{
  const api=read("app/api/reports/technician-productivity/comparisons/route.ts");
  const backend=read("lib/technician-job-comparisons.ts");
  const page=read("app/reports/technician-productivity/comparisons/page.tsx");
  const original=read("app/reports/technician-productivity/page.tsx");
  const nav=read("app/navigation-config.ts");
  assert.match(api,/getSessionUser\(env.DB,request\)/);
  assert.match(api,/user.role!=='manager'&&user.role!=='admin'/);
  assert.match(api,/status:401/);
  assert.match(api,/status:403/);
  assert.match(api,/private, no-store/);
  assert.match(backend,/validateLaborReportRange/);
  assert.match(page,/Same Job Types/);
  assert.match(page,/Same Exact Work Order/);
  assert.match(page,/All Work Order Labor/);
  assert.match(page,/Compare with/);
  assert.match(page,/Export This View/);
  assert.match(page,/window.print/);
  assert.match(page,/Small comparison sample/);
  assert.match(page,/not a quality score/);
  assert.match(page,/maxHeight:575,overflow:"auto"/);
  assert.match(original,/Compare Same Jobs/);
  assert.match(nav,/href: "\/reports\/technician-productivity\/comparisons".*roles: managerRoles/);
  assert.match(technicianJobWorkSql(),/GROUP BY t.id,l.repair_id/);
  assert.match(technicianJobWorkSql(),/JOIN repair_labor_entries l ON l.technician_id=t.id AND l.labor_date>=\? AND l.labor_date<=\?/);
});
