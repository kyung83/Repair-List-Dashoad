/** Team membership is additive; repairs.technician_id remains the single primary owner. */
export async function isRepairTeamMember(db:D1Database,repairId:number,technicianId:number) {
  if (!Number.isInteger(repairId)||repairId<=0||!Number.isInteger(technicianId)||technicianId<=0) return false;
  const row=await db.prepare(`
    SELECT 1 AS permitted FROM repairs r WHERE r.id=?
      AND (r.technician_id=? OR EXISTS (
        SELECT 1 FROM repair_team_members team
        WHERE team.repair_id=r.id AND team.technician_id=?
      )) LIMIT 1
  `).bind(repairId,technicianId,technicianId).first<{permitted:number}>();
  return Boolean(row);
}

export async function activeRepairTeammates(db:D1Database,repairId:number,exceptUserId:number) {
  const row=await db.prepare(`
    SELECT COUNT(*) AS count FROM repair_labor_timers
    WHERE repair_id=? AND user_id<>?
  `).bind(repairId,exceptUserId).first<{count:number}>();
  return Number(row?.count||0);
}

export async function listRepairTeam(db:D1Database,repairId:number) {
  const result=await db.prepare(`
    SELECT t.id AS technicianId,t.name AS name,
           CASE WHEN r.technician_id=t.id THEN 'primary' ELSE 'helper' END AS role,
           EXISTS(SELECT 1 FROM repair_labor_timers rt WHERE rt.repair_id=r.id AND rt.technician_id=t.id) AS working
    FROM repairs r JOIN technicians t
      ON (t.id=r.technician_id OR EXISTS(
        SELECT 1 FROM repair_team_members tm WHERE tm.repair_id=r.id AND tm.technician_id=t.id))
    WHERE r.id=?
    ORDER BY CASE WHEN t.id=r.technician_id THEN 0 ELSE 1 END,t.name
  `).bind(repairId).all<{technicianId:number;name:string;role:string;working:number}>();
  return result.results.map(row=>({...row,working:Boolean(row.working)}));
}
