import { sendTwilioRuntimeSms, twilioRuntimeReady } from '@/lib/twilio-runtime';
import type { GeotabRuntimeSecretEnv } from '@/lib/geotab-runtime-credentials';

type PullThruRepairRow = {
  id:number;
  title:string;
  pull_thru:number;
  unit:string;
};

type PullThruTechnicianRow = {
  id:number;
  name:string;
  phone:string;
};

export type PullThruAlertResult = {
  needed:boolean;
  sent:boolean;
  technicianId:number;
  technicianName:string;
  warning?:string;
};

async function logPullThruEvent(
  db:D1Database,
  repairId:number,
  userId:number|null,
  technicianId:number,
  action:string,
  detail:string,
) {
  await db.prepare(`
    INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
    VALUES(?,?,?,?,?)
  `).bind(repairId,userId,technicianId,action,detail.slice(0,2000)).run();
}

export async function notifyPullThruAssignment(
  db:D1Database,
  runtimeEnv:GeotabRuntimeSecretEnv,
  input:{repairId:number;technicianId:number;assignedByUserId?:number|null;assignedByName?:string},
):Promise<PullThruAlertResult> {
  const repairId=Number(input.repairId);
  const technicianId=Number(input.technicianId);
  const [repair,technician]=await Promise.all([
    db.prepare(`
      SELECT r.id,COALESCE(r.title,'') AS title,COALESCE(r.pull_thru,0) AS pull_thru,
             COALESCE(e.unit,'') AS unit
      FROM repairs r
      LEFT JOIN equipment e ON e.id=r.equipment_id
      WHERE r.id=?
    `).bind(repairId).first<PullThruRepairRow>(),
    db.prepare(`
      SELECT id,name,COALESCE(phone,'') AS phone
      FROM technicians
      WHERE id=? AND active=1
    `).bind(technicianId).first<PullThruTechnicianRow>(),
  ]);

  if(!repair||!technician||!Boolean(repair.pull_thru)){
    return {needed:false,sent:false,technicianId,technicianName:technician?.name??''};
  }

  const assignedBy=String(input.assignedByName??'').trim()||'Repair Board';
  const unit=repair.unit||'the assigned unit';
  const message=`PULL THRU HEADS UP: Unit ${unit} is being assigned to you for a pull thru. Repair: ${repair.title||'Open repair'}. Please be ready for the unit to come through.`;

  if(!technician.phone.trim()){
    const warning=`${technician.name} has no phone number saved, so the Pull Thru text was not sent.`;
    await logPullThruEvent(db,repairId,input.assignedByUserId??null,technicianId,'pull_thru_notification_failed',warning);
    return {needed:true,sent:false,technicianId,technicianName:technician.name,warning};
  }

  const ready=await twilioRuntimeReady(db);
  if(!ready){
    const warning='The repair was assigned, but Twilio texting is not enabled so the Pull Thru text was not sent.';
    await logPullThruEvent(db,repairId,input.assignedByUserId??null,technicianId,'pull_thru_notification_failed',warning);
    return {needed:true,sent:false,technicianId,technicianName:technician.name,warning};
  }

  try{
    await sendTwilioRuntimeSms(db,runtimeEnv,technician.phone,message);
    await logPullThruEvent(
      db,
      repairId,
      input.assignedByUserId??null,
      technicianId,
      'pull_thru_notification_sent',
      `${assignedBy} assigned Pull Thru Unit ${unit} to ${technician.name}; SMS alert sent to technician phone.`,
    );
    return {needed:true,sent:true,technicianId,technicianName:technician.name};
  }catch(error){
    const detail=error instanceof Error?error.message:'SMS send failed.';
    const warning=`The repair was assigned to ${technician.name}, but the Pull Thru text could not be sent: ${detail}`;
    await logPullThruEvent(db,repairId,input.assignedByUserId??null,technicianId,'pull_thru_notification_failed',warning);
    return {needed:true,sent:false,technicianId,technicianName:technician.name,warning};
  }
}
