import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { trackedProductivity, validateLaborReportRange } from "../lib/technician-productivity-metrics.js";
import { technicianSummarySql, technicianDailySql } from "../lib/technician-productivity-sql.js";

function dbFixture(){
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE technicians(id INTEGER PRIMARY KEY,name TEXT,active INTEGER);"+
    "CREATE TABLE repair_types(id INTEGER PRIMARY KEY,name TEXT);"+
    "CREATE TABLE repairs(id INTEGER PRIMARY KEY,source TEXT,repair_type_id INTEGER);"+
    "CREATE TABLE repair_labor_entries(id INTEGER PRIMARY KEY,repair_id INTEGER,technician_id INTEGER,labor_date TEXT,hours REAL,started_at TEXT,ended_at TEXT);"+
    "CREATE TABLE repair_labor_timers(user_id INTEGER PRIMARY KEY,repair_id INTEGER,technician_id INTEGER,started_at TEXT);"+
    "CREATE INDEX idx_repair_labor_technician_date ON repair_labor_entries(technician_id,labor_date);"+
    "INSERT INTO technicians VALUES(10,'Alex Mechanic',1),(20,'Pat Mechanic',1),(30,'Former Mechanic',0);"+
    "INSERT INTO repair_types VALUES(1,'INDIRECT LABOR-OTHER'),(2,'ENGINE');"+
    "INSERT INTO repairs VALUES(101,'shop',2),(102,'indirect-labor',1),(103,'shop',1),(104,'shop',2),(105,'shop',2);"+
    "INSERT INTO repair_labor_entries VALUES"+
    "(1,101,10,'2026-10-12',2,'2026-10-12 10:00:00','2026-10-12 12:00:00'),"+
    "(2,101,10,'2026-10-12',1,'2026-10-12 12:00:00','2026-10-12 13:00:00'),"+
    "(3,102,10,'2026-10-12',1,'2026-10-12 13:00:00','2026-10-12 14:00:00'),"+
    "(4,103,10,'2026-10-12',1,NULL,NULL),"+
    "(5,105,30,'2026-10-12',1,'2026-10-12 10:00:00','2026-10-12 11:00:00'),"+
    "(6,104,10,'2026-10-09',4,'2026-10-09 10:00:00','2026-10-09 14:00:00'),"+
    "(7,101,NULL,'2026-10-12',2,NULL,NULL);"+
    "INSERT INTO repair_labor_timers VALUES(999,101,10,'2026-10-12 14:00:00');");
  return db;
}

test("percentage uses actual logged direct / (direct + indirect), not paid shift hours",()=>{
  assert.deepEqual(trackedProductivity(3,2),{
    directHours:3,indirectHours:2,totalHours:5,productivityPercent:60,indirectPercent:40,
  });
  assert.deepEqual(trackedProductivity(0,0),{
    directHours:0,indirectHours:0,totalHours:0,productivityPercent:null,indirectPercent:null,
  });
  assert.equal(trackedProductivity(1,3).productivityPercent,25);
  assert.equal(trackedProductivity(1,2).productivityPercent,33.3);
  assert.throws(()=>trackedProductivity(-1,3),RangeError);
});

test("report dates are real calendar dates, bounded to one year and sorted ascending",()=>{
  assert.deepEqual(validateLaborReportRange("2026-10-01","2026-10-13"),{
    startDate:"2026-10-01",endDate:"2026-10-13",days:13,
  });
  assert.equal(validateLaborReportRange("2024-02-29","2024-02-29").days,1);
  assert.throws(()=>validateLaborReportRange("2026-02-30","2026-03-01"),RangeError);
  assert.throws(()=>validateLaborReportRange("2026-10-13","2026-10-12"),RangeError);
  assert.throws(()=>validateLaborReportRange("2025-01-01","2026-10-13"),RangeError);
});

test("summary aggregates actual direct and INDIRECT LABOR-OTHER sessions by technician and indexed date",()=>{
  const db=dbFixture();
  const summary=db.prepare(technicianSummarySql()).all("2026-10-11","2026-10-13");
  assert.equal(summary.length,3);
  const alex=summary.find(x=>x.technician_id===10);
  assert.equal(alex.direct_hours,3);
  assert.equal(alex.indirect_hours,2);
  assert.equal(alex.direct_repair_count,1);
  assert.equal(alex.indirect_activity_count,2);
  assert.equal(alex.labor_entries,4);
  assert.equal(alex.logged_days,1);
  assert.equal(alex.no_timer_hours,1);
  assert.equal(trackedProductivity(alex.direct_hours,alex.indirect_hours).productivityPercent,60);
  const noHours=summary.find(x=>x.technician_id===20);
  assert.equal(noHours.direct_hours,0);
  assert.equal(noHours.indirect_hours,0);
  assert.equal(trackedProductivity(noHours.direct_hours,noHours.indirect_hours).productivityPercent,null);
  const former=summary.find(x=>x.technician_id===30);
  assert.equal(former.active,0);
  assert.equal(former.direct_hours,1);
  const totalDirect=summary.reduce((value,row)=>value+row.direct_hours,0);
  const totalIndirect=summary.reduce((value,row)=>value+row.indirect_hours,0);
  assert.equal(trackedProductivity(totalDirect,totalIndirect).productivityPercent,66.7);
  assert.match(technicianSummarySql(),/l.technician_id=t.id AND l.labor_date>=\? AND l.labor_date<=\?/);
  db.close();
});

test("daily drilldown counts distinct repairs and excludes active unclosed timers",()=>{
  const db=dbFixture();
  const days=db.prepare(technicianDailySql()).all(10,"2026-10-11","2026-10-13");
  assert.equal(days.length,1);
  assert.equal(days[0].labor_date,"2026-10-12");
  assert.equal(days[0].direct_hours,3);
  assert.equal(days[0].indirect_hours,2);
  assert.equal(days[0].direct_repair_count,1);
  assert.equal(days[0].indirect_activity_count,2);
  assert.equal(days[0].no_timer_hours,1);
  assert.doesNotMatch(technicianSummarySql(),/JOIN repair_labor_timers/);
  db.close();
});

test("productivity API protects employee percentages and the report is visible only to managers",()=>{
  const root=new URL("../",import.meta.url);
  const api=readFileSync(new URL("app/api/reports/technician-productivity/route.ts",root),"utf8");
  const nav=readFileSync(new URL("app/navigation-config.ts",root),"utf8");
  const page=readFileSync(new URL("app/reports/technician-productivity/page.tsx",root),"utf8");
  assert.match(api,/getSessionUser\(env.DB, request\)/);
  assert.match(api,/user.role !== 'manager' && user.role !== 'admin'/);
  assert.match(api,/status: 401/);
  assert.match(api,/status: 403/);
  assert.match(api,/status: 400/);
  assert.match(api,/cache-control': 'private, no-store'/);
  assert.match(nav,/href: "\/reports\/technician-productivity", label: "Technician Productivity", exact: true, roles: managerRoles/);
  assert.match(page,/Technician Productivity/);
  assert.match(page,/Tracked Productivity %/);
  assert.match(page,/View days/);
  assert.match(page,/Export CSV/);
  assert.match(page,/Export daily CSV/);
  assert.match(page,/Print/);
  assert.match(page,/aria-sort=/);
  assert.match(page,/maxHeight:610,overflow:"auto"/);
  assert.match(page,/Zero logged hours|Technicians with no saved labor/);
});
