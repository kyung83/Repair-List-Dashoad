export async function queuePullThruTabletAlert(
  db:D1Database,
  input:{repairId:number;technicianId:number;assignedByUserId?:number|null;assignedByName?:string},
) {
  const repairId=Number(input.repairId);
  const technicianId=Number(input.technicianId);
  if(!Number.isInteger(repairId)||repairId<=0||!Number.isInteger(technicianId)||technicianId<=0)return {queued:false};

  const repair=await db.prepare(`
    SELECT r.id,COALESCE(r.title,'') AS title,COALESCE(r.pull_thru,0) AS pull_thru,
           COALESCE(e.unit,'') AS unit
    FROM repairs r
    LEFT JOIN equipment e ON e.id=r.equipment_id
    WHERE r.id=? AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
  `).bind(repairId).first<{id:number;title:string;pull_thru:number;unit:string}>();
  if(!repair||!Boolean(repair.pull_thru))return {queued:false};

  const technician=await db.prepare('SELECT id,name FROM technicians WHERE id=? AND active=1')
    .bind(technicianId).first<{id:number;name:string}>();
  if(!technician)return {queued:false};

  const title=`PULL THRU · Unit ${repair.unit||'—'}`;
  const body=`${repair.title||'Open repair'} — this unit is being sent through to you.`;
  const inserted=await db.prepare(`
    INSERT INTO technician_alerts(technician_id,repair_id,alert_type,title,body)
    VALUES(?,?,'pull_thru',?,?)
  `).bind(technician.id,repairId,title,body).run();

  await db.prepare(`
    INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
    VALUES(?,?,?,'pull_thru_alert_queued',?)
  `).bind(
    repairId,
    input.assignedByUserId??null,
    technician.id,
    `${String(input.assignedByName??'Repair Board').trim()||'Repair Board'} assigned this Pull Thru repair to ${technician.name}; tablet alert queued.`,
  ).run();

  return {queued:Boolean(inserted.meta.changes),technicianId:technician.id,technicianName:technician.name};
}
