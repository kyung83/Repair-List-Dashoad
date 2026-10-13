// Report the actual stopped labor entries; use the timer's persisted labor_date.
// LEFT JOIN starts at technician so the indexed (technician_id,labor_date) lookup
// avoids scanning every historical repair across the fleet.
export const INDIRECT_WORK = "(lower(trim(COALESCE(r.source,'')))='indirect-labor' OR upper(trim(COALESCE(rt.name,'')))='INDIRECT LABOR-OTHER')";

export function technicianSummarySql() {
  return `
    SELECT t.id AS technician_id,t.name AS technician_name,t.active AS active,
      COALESCE(SUM(CASE WHEN l.id IS NOT NULL AND NOT ${INDIRECT_WORK} THEN l.hours ELSE 0 END),0) AS direct_hours,
      COALESCE(SUM(CASE WHEN l.id IS NOT NULL AND ${INDIRECT_WORK} THEN l.hours ELSE 0 END),0) AS indirect_hours,
      COALESCE(SUM(CASE WHEN l.id IS NOT NULL AND (l.started_at IS NULL OR l.ended_at IS NULL) THEN l.hours ELSE 0 END),0) AS no_timer_hours,
      COUNT(l.id) AS labor_entries,
      COUNT(DISTINCT l.labor_date) AS logged_days,
      COUNT(DISTINCT CASE WHEN l.id IS NOT NULL AND NOT ${INDIRECT_WORK} THEN l.repair_id END) AS direct_repair_count,
      COUNT(DISTINCT CASE WHEN l.id IS NOT NULL AND ${INDIRECT_WORK} THEN l.repair_id END) AS indirect_activity_count
    FROM technicians t
    LEFT JOIN repair_labor_entries l
      ON l.technician_id=t.id AND l.labor_date>=? AND l.labor_date<=?
    LEFT JOIN repairs r ON r.id=l.repair_id
    LEFT JOIN repair_types rt ON rt.id=r.repair_type_id
    WHERE t.active=1 OR l.id IS NOT NULL
    GROUP BY t.id,t.name,t.active
    ORDER BY t.name COLLATE NOCASE,t.id
  `;
}

export function technicianDailySql() {
  return `
    SELECT l.labor_date AS labor_date,
      COALESCE(SUM(CASE WHEN NOT ${INDIRECT_WORK} THEN l.hours ELSE 0 END),0) AS direct_hours,
      COALESCE(SUM(CASE WHEN ${INDIRECT_WORK} THEN l.hours ELSE 0 END),0) AS indirect_hours,
      COUNT(DISTINCT CASE WHEN NOT ${INDIRECT_WORK} THEN l.repair_id END) AS direct_repair_count,
      COUNT(DISTINCT CASE WHEN ${INDIRECT_WORK} THEN l.repair_id END) AS indirect_activity_count,
      COALESCE(SUM(CASE WHEN l.started_at IS NULL OR l.ended_at IS NULL THEN l.hours ELSE 0 END),0) AS no_timer_hours
    FROM repair_labor_entries l
    JOIN repairs r ON r.id=l.repair_id
    LEFT JOIN repair_types rt ON rt.id=r.repair_type_id
    WHERE l.technician_id=? AND l.labor_date>=? AND l.labor_date<=?
    GROUP BY l.labor_date ORDER BY l.labor_date DESC LIMIT 366
  `;
}
