/**
 * Each row is one technician's saved direct labor on one work order.
 * Multiple stops on the same WO are summed before comparing job times.
 * The date restriction is the existing labor_date (timer stop UTC date).
 */
export function technicianJobWorkSql() {
  return [
    "SELECT t.id AS technician_id,t.name AS technician_name,",
    "r.id AS repair_id,COALESCE(r.title,'') AS title,",
    "COALESCE(r.status,'') AS status,COALESCE(r.source,'') AS source,",
    "COALESCE(r.opened_at,'') AS opened_at,COALESCE(r.completed_at,'') AS completed_at,",
    "COALESCE(e.unit,'') AS unit,",
    "COALESCE(rt.id,0) AS repair_type_id,COALESCE(rt.name,'') AS repair_type_name,",
    "COALESCE(c.event_type,'') AS maintenance_event_type,",
    "COALESCE(mct.template_key,'') AS maintenance_template_key,",
    "COALESCE(mct.name,'') AS maintenance_template_name,",
    "COALESCE(c.template_id,0) AS maintenance_template_id,",
    "SUM(l.hours) AS hours,COUNT(l.id) AS entries,",
    "SUM(CASE WHEN l.started_at IS NULL OR l.ended_at IS NULL THEN l.hours ELSE 0 END) AS untimed_hours,",
    "MIN(l.labor_date) AS first_labor_date,MAX(l.labor_date) AS last_labor_date",
    "FROM technicians t",
    "JOIN repair_labor_entries l ON l.technician_id=t.id AND l.labor_date>=? AND l.labor_date<=?",
    "JOIN repairs r ON r.id=l.repair_id",
    "LEFT JOIN equipment e ON e.id=r.equipment_id",
    "LEFT JOIN repair_types rt ON rt.id=r.repair_type_id",
    "LEFT JOIN maintenance_checklist_runs c ON c.repair_id=r.id",
    "LEFT JOIN maintenance_checklist_templates mct ON mct.id=c.template_id",
    "WHERE lower(trim(COALESCE(r.source,''))) <> 'indirect-labor'",
    "AND upper(trim(COALESCE(rt.name,''))) <> 'INDIRECT LABOR-OTHER'",
    "GROUP BY t.id,l.repair_id",
    "ORDER BY r.id DESC,t.id",
    "LIMIT 10001",
  ].join(' ');
}
