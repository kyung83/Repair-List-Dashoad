import { validateLaborReportRange } from './technician-productivity-metrics.js';
import { technicianJobWorkSql } from './technician-job-comparison-sql.js';
import { buildTechnicianJobComparisons } from './technician-job-comparison-core.js';

type JobWorkRow = {
  technician_id:number; technician_name:string; repair_id:number;
  title:string; status:string; source:string; opened_at:string; completed_at:string;
  unit:string; repair_type_id:number; repair_type_name:string;
  maintenance_event_type:string; maintenance_template_key:string;
  maintenance_template_name:string; maintenance_template_id:number;
  maintenance_template_version:number;
  hours:number; entries:number; untimed_hours:number;
  first_labor_date:string; last_labor_date:string;
};

export async function getTechnicianJobComparisons(db:D1Database,start:string,end:string) {
  const range=validateLaborReportRange(start,end);
  const result=await db.prepare(technicianJobWorkSql())
    .bind(range.startDate,range.endDate).all<JobWorkRow>();
  const comparison=buildTechnicianJobComparisons(result.results,range);
  return {
    range,
    ...comparison,
    metric:'completed-job logged-hours comparison',
    explanation:'Peer averages use single-technician, completed work orders of the same saved repair type or PM/Annual checklist version, opened and completed in the selected period, with timer timestamps on every included labor entry. An average is not a manufacturer labor standard or a quality rating.',
    updatedAt:new Date().toISOString(),
  };
}
