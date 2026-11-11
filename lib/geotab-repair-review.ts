import { markGeotabDefectRepaired } from '@/lib/geotab';

type GeotabEnv={DB:D1Database;GEOTAB_DATABASE?:string;GEOTAB_USER?:string;GEOTAB_PASSWORD?:string;GEOTAB_BASE_URL?:string};

const clean=(value:unknown,max=1000)=>String(value??'').trim().slice(0,max);

export type GeotabRepairReviewItem={
  id:number;repairId:string;repairNumericId:number;unit:string;issue:string;technician:string;
  defectId:string;logId:string;status:'open'|'resolved'|'reopened';failureReason:string;
  attemptCount:number;createdAt:string;lastAttemptAt:string;resolvedAt:string;
  resolutionType:string;resolutionNote:string;
};

export async function listOpenGeotabRepairReviews(db:D1Database){
  const rows=await db.prepare(`
    SELECT q.id,q.repair_id,q.geotab_defect_id,q.geotab_log_id,q.status,q.failure_reason,
           q.attempt_count,q.created_at,q.last_attempt_at,COALESCE(q.resolved_at,'') AS resolved_at,
           COALESCE(q.resolution_type,'') AS resolution_type,COALESCE(q.resolution_note,'') AS resolution_note,
           COALESCE(e.unit,d.asset_unit,'') AS unit,COALESCE(r.title,d.defect,'DVIR repair') AS issue,
           COALESCE(t.name,'') AS technician
    FROM geotab_repair_review q
    JOIN repairs r ON r.id=q.repair_id
    LEFT JOIN equipment e ON e.id=r.equipment_id
    LEFT JOIN dvir_defects d ON d.geotab_defect_id=q.geotab_defect_id
    LEFT JOIN technicians t ON t.id=r.technician_id
    WHERE q.status='open'
    ORDER BY q.created_at,q.id
  `).all<any>();
  return rows.results.map((row:any)=>({
    id:Number(row.id),
    repairId:`repair-${row.repair_id}`,
    repairNumericId:Number(row.repair_id),
    unit:row.unit??'',
    issue:row.issue??'DVIR repair',
    technician:row.technician??'',
    defectId:row.geotab_defect_id??'',
    logId:row.geotab_log_id??'',
    status:row.status,
    failureReason:row.failure_reason??'',
    attemptCount:Number(row.attempt_count??0),
    createdAt:row.created_at??'',
    lastAttemptAt:row.last_attempt_at??'',
    resolvedAt:row.resolved_at??'',
    resolutionType:row.resolution_type??'',
    resolutionNote:row.resolution_note??'',
  })) as GeotabRepairReviewItem[];
}

export async function queueGeotabRepairReview(db:D1Database,input:{
  repairId:number;defectId:string;logId?:string|null;failureReason?:unknown;userId?:number|null;
}){
  const failureReason=clean(input.failureReason,1000)||'Geotab writeback did not complete.';
  await db.prepare(`
    INSERT INTO geotab_repair_review(
      repair_id,geotab_defect_id,geotab_log_id,status,failure_reason,attempt_count,last_attempt_at,created_by_user_id
    ) VALUES(?,?,?,'open',?,1,CURRENT_TIMESTAMP,?)
    ON CONFLICT(repair_id) DO UPDATE SET
      geotab_defect_id=excluded.geotab_defect_id,
      geotab_log_id=excluded.geotab_log_id,
      status='open',
      failure_reason=excluded.failure_reason,
      attempt_count=geotab_repair_review.attempt_count+1,
      last_attempt_at=CURRENT_TIMESTAMP,
      resolved_at=NULL,resolved_by_user_id=NULL,resolution_type=NULL,resolution_note=''
  `).bind(input.repairId,input.defectId,clean(input.logId,120)||null,failureReason,input.userId??null).run();
}

async function requireOpenReview(db:D1Database,reviewId:number){
  const row=await db.prepare(`
    SELECT q.id,q.repair_id,q.geotab_defect_id,COALESCE(q.geotab_log_id,'') AS geotab_log_id,
           COALESCE(r.status,'') AS repair_status,r.technician_id
    FROM geotab_repair_review q
    JOIN repairs r ON r.id=q.repair_id
    WHERE q.id=? AND q.status='open'
  `).bind(reviewId).first<{id:number;repair_id:number;geotab_defect_id:string;geotab_log_id:string;repair_status:string;technician_id:number|null}>();
  if(!row)throw new Error('That Geotab review item is no longer open.');
  return row;
}

export async function retryGeotabRepairReview(env:GeotabEnv,input:{reviewId:number;userId:number;userName:string}){
  const review=await requireOpenReview(env.DB,input.reviewId);
  if(!review.geotab_log_id)throw new Error('This review item is missing its Geotab DVIR log ID.');
  try{
    const result=await markGeotabDefectRepaired(env as any,review.geotab_log_id,review.geotab_defect_id);
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE geotab_repair_review
        SET status='resolved',attempt_count=attempt_count+1,last_attempt_at=CURRENT_TIMESTAMP,
            resolved_at=CURRENT_TIMESTAMP,resolved_by_user_id=?,resolution_type='retry_success',
            resolution_note='Geotab writeback succeeded on manager retry.'
        WHERE id=? AND status='open'
      `).bind(input.userId,input.reviewId),
      env.DB.prepare(`
        UPDATE dvir_defects SET local_repaired=0,repaired=1,updated_at=CURRENT_TIMESTAMP
        WHERE geotab_defect_id=?
      `).bind(review.geotab_defect_id),
      env.DB.prepare(`
        INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
        VALUES (?,?,?,'geotab_review_resolved',?)
      `).bind(review.repair_id,input.userId,review.technician_id,
        `${input.userName} resolved Geotab review by retrying the writeback${(result as any)?.alreadyRepaired?' (Geotab already showed repaired)':''}.`),
    ]);
    return {ok:true,resolved:true,resolutionType:'retry_success',alreadyRepaired:Boolean((result as any)?.alreadyRepaired)};
  }catch(error){
    const reason=clean(error instanceof Error?error.message:String(error),1000);
    await env.DB.prepare(`
      UPDATE geotab_repair_review
      SET attempt_count=attempt_count+1,last_attempt_at=CURRENT_TIMESTAMP,failure_reason=?
      WHERE id=? AND status='open'
    `).bind(reason,input.reviewId).run();
    throw new Error(`Geotab retry failed: ${reason}`);
  }
}

export async function confirmGeotabAlreadyResolved(db:D1Database,input:{reviewId:number;userId:number;userName:string;note?:unknown}){
  const review=await requireOpenReview(db,input.reviewId);
  const note=clean(input.note,500)||'Manager confirmed the DVIR was already resolved in Geotab.';
  await db.batch([
    db.prepare(`
      UPDATE geotab_repair_review
      SET status='resolved',resolved_at=CURRENT_TIMESTAMP,resolved_by_user_id=?,
          resolution_type='already_resolved',resolution_note=?,last_attempt_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='open'
    `).bind(input.userId,note,input.reviewId),
    db.prepare(`
      UPDATE dvir_defects
      SET repaired=1,local_repaired=0,repair_date=COALESCE(repair_date,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE geotab_defect_id=?
    `).bind(review.geotab_defect_id),
    db.prepare(`
      INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'geotab_review_resolved',?)
    `).bind(review.repair_id,input.userId,review.technician_id,`${input.userName} confirmed the linked DVIR was already resolved in Geotab. ${note}`.slice(0,500)),
  ]);
  return {ok:true,resolved:true,resolutionType:'already_resolved'};
}

export async function reopenRepairFromGeotabReview(db:D1Database,input:{reviewId:number;userId:number;userName:string;note?:unknown}){
  const review=await requireOpenReview(db,input.reviewId);
  const note=clean(input.note,500)||'Manager reopened the repair after Geotab reconciliation review.';
  await db.batch([
    db.prepare(`
      UPDATE repairs
      SET status='Open',completed_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lower(COALESCE(status,'')) LIKE '%complete%'
    `).bind(review.repair_id),
    db.prepare(`
      UPDATE geotab_repair_review
      SET status='reopened',resolved_at=CURRENT_TIMESTAMP,resolved_by_user_id=?,
          resolution_type='reopened',resolution_note=?,last_attempt_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='open'
    `).bind(input.userId,note,input.reviewId),
    db.prepare(`
      INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'geotab_review_reopened',?)
    `).bind(review.repair_id,input.userId,review.technician_id,`${input.userName} reopened this repair from Geotab Review. ${note}`.slice(0,500)),
  ]);
  return {ok:true,reopened:true,repairId:`repair-${review.repair_id}`};
}

export async function geotabReviewStatusByRepair(db:D1Database,repairIds:number[]){
  const ids=[...new Set(repairIds.filter(id=>Number.isInteger(id)&&id>0))];
  if(!ids.length)return new Map<number,{status:string;resolutionType:string;resolutionNote:string;failureReason:string}>();
  const placeholders=ids.map(()=>'?').join(',');
  const rows=await db.prepare(`
    SELECT repair_id,status,COALESCE(resolution_type,'') AS resolution_type,
           COALESCE(resolution_note,'') AS resolution_note,COALESCE(failure_reason,'') AS failure_reason
    FROM geotab_repair_review
    WHERE repair_id IN (${placeholders})
  `).bind(...ids).all<any>();
  return new Map(rows.results.map((row:any)=>[Number(row.repair_id),{
    status:String(row.status??''),
    resolutionType:String(row.resolution_type??''),
    resolutionNote:String(row.resolution_note??''),
    failureReason:String(row.failure_reason??''),
  }]));
}
