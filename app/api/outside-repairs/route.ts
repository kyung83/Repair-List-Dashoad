import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type AssignmentRow = {
  id:number;
  repair_id:number;
  equipment_id:number|null;
  unit:string;
  repair_title:string;
  repair_status:string;
  outside_vendor_id:number;
  vendor_name:string;
  vendor_phone:string|null;
  status:string;
  notes:string;
  assigned_at:string;
  vendor_finished_at:string|null;
  invoice_received_at:string|null;
  completed_at:string|null;
  updated_at:string;
  invoice_number:string|null;
  total_amount:number|null;
};

type VendorRow = { id:number; name:string; phone:string|null };

async function requireManager(request:Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required.');
  return user;
}

function repairId(value:unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function assignmentPayload() {
  const [assignments, vendors] = await Promise.all([
    env.DB.prepare(`
      SELECT a.id,a.repair_id,r.equipment_id,COALESCE(e.unit,'') AS unit,
             COALESCE(r.title,'') AS repair_title,COALESCE(r.status,'') AS repair_status,
             a.outside_vendor_id,v.name AS vendor_name,v.phone AS vendor_phone,
             a.status,a.notes,a.assigned_at,a.vendor_finished_at,a.invoice_received_at,
             a.completed_at,a.updated_at,
             (
               SELECT d.invoice_number FROM outside_work_documents d
               WHERE d.repair_id=a.repair_id ORDER BY d.id DESC LIMIT 1
             ) AS invoice_number,
             (
               SELECT d.total_amount FROM outside_work_documents d
               WHERE d.repair_id=a.repair_id ORDER BY d.id DESC LIMIT 1
             ) AS total_amount
      FROM outside_repair_assignments a
      JOIN repairs r ON r.id=a.repair_id
      LEFT JOIN equipment e ON e.id=r.equipment_id
      JOIN outside_work_vendors v ON v.id=a.outside_vendor_id
      WHERE a.status IN ('waiting_vendor','waiting_invoice')
      ORDER BY CASE a.status WHEN 'waiting_vendor' THEN 0 ELSE 1 END,a.updated_at DESC,a.id DESC
    `).all<AssignmentRow>(),
    env.DB.prepare(`
      SELECT id,name,phone
      FROM outside_work_vendors
      WHERE COALESCE(active,1)=1
      ORDER BY name COLLATE NOCASE,id
    `).all<VendorRow>(),
  ]);

  return {
    assignments: assignments.results.map(row => ({
      id:row.id,
      repairId:`repair-${row.repair_id}`,
      repairNumericId:row.repair_id,
      equipmentId:row.equipment_id,
      unit:row.unit,
      repairTitle:row.repair_title,
      repairStatus:row.repair_status,
      vendorId:row.outside_vendor_id,
      vendorName:row.vendor_name,
      vendorPhone:row.vendor_phone ?? '',
      status:row.status,
      notes:row.notes ?? '',
      assignedAt:row.assigned_at,
      vendorFinishedAt:row.vendor_finished_at ?? '',
      invoiceReceivedAt:row.invoice_received_at ?? '',
      completedAt:row.completed_at ?? '',
      updatedAt:row.updated_at,
      invoiceNumber:row.invoice_number ?? '',
      totalAmount:row.total_amount == null ? null : Number(row.total_amount),
    })),
    vendors: vendors.results.map(row => ({ id:row.id,name:row.name,phone:row.phone ?? '' })),
  };
}

async function assignOutside(request:Request, body:Record<string,unknown>) {
  const user = await requireManager(request);
  const id = repairId(body.repairId);
  const vendorId = Number(body.vendorId ?? 0);
  const notes = String(body.notes ?? '').trim().slice(0,1000);
  if (!id) throw new Error('Choose a repair from the Repair Board.');
  if (!Number.isInteger(vendorId) || vendorId <= 0) throw new Error('Choose an outside vendor.');

  const [repair, vendor, existing, timer] = await Promise.all([
    env.DB.prepare(`
      SELECT r.id,r.equipment_id,COALESCE(r.title,'') AS title,COALESCE(r.status,'New') AS status,r.technician_id,
             COALESCE(e.unit,'') AS unit
      FROM repairs r LEFT JOIN equipment e ON e.id=r.equipment_id
      WHERE r.id=?
    `).bind(id).first<{id:number;equipment_id:number|null;title:string;status:string;technician_id:number|null;unit:string}>(),
    env.DB.prepare(`SELECT id,name,phone FROM outside_work_vendors WHERE id=? AND COALESCE(active,1)=1`)
      .bind(vendorId).first<VendorRow>(),
    env.DB.prepare(`SELECT id,status FROM outside_repair_assignments WHERE repair_id=?`)
      .bind(id).first<{id:number;status:string}>(),
    env.DB.prepare(`SELECT 1 AS found FROM repair_labor_timers WHERE repair_id=? LIMIT 1`)
      .bind(id).first<{found:number}>(),
  ]);

  if (!repair) throw new Error('That repair no longer exists.');
  if (/complete/i.test(repair.status)) throw new Error('Completed repairs cannot be sent to an outside vendor.');
  if (/^deferred to next/i.test(repair.status)) throw new Error('A repair deferred to the next PM/Annual cannot be sent outside from the active Repair Board.');
  if (!vendor) throw new Error('That outside vendor is inactive or no longer exists.');
  if (timer) throw new Error('Stop active labor on this repair before sending it to an outside vendor.');
  if (existing && (existing.status === 'waiting_vendor' || existing.status === 'waiting_invoice')) {
    throw new Error('This repair is already in Outside Repairs.');
  }

  const detail = `${user.displayName} sent ${repair.unit || `repair #${id}`} to ${vendor.name}.`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO outside_repair_assignments (
        repair_id,outside_vendor_id,status,previous_repair_status,previous_technician_id,notes,
        assigned_at,vendor_finished_at,invoice_received_at,returned_to_shop_at,completed_at,
        assigned_by_user_id,updated_by_user_id,updated_at
      ) VALUES (?,?,'waiting_vendor',?,?,?,CURRENT_TIMESTAMP,NULL,NULL,NULL,NULL,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(repair_id) DO UPDATE SET
        outside_vendor_id=excluded.outside_vendor_id,
        status='waiting_vendor',
        previous_repair_status=excluded.previous_repair_status,
        previous_technician_id=excluded.previous_technician_id,
        notes=excluded.notes,
        assigned_at=CURRENT_TIMESTAMP,
        vendor_finished_at=NULL,
        invoice_received_at=NULL,
        returned_to_shop_at=NULL,
        completed_at=NULL,
        assigned_by_user_id=excluded.assigned_by_user_id,
        updated_by_user_id=excluded.updated_by_user_id,
        updated_at=CURRENT_TIMESTAMP
    `).bind(id,vendorId,repair.status,repair.technician_id,notes,user.id,user.id),
    env.DB.prepare(`
      UPDATE repairs
      SET status='Outside - Waiting on Vendor',technician_id=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(id),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'outside_vendor_assigned',?)
    `).bind(id,user.id,user.technicianId,detail.slice(0,500)),
  ]);

  return { ok:true,message:`${repair.unit || `Repair #${id}`} moved to Outside Repairs with ${vendor.name}.` };
}

async function vendorFinished(request:Request, body:Record<string,unknown>) {
  const user = await requireManager(request);
  const id = repairId(body.repairId);
  if (!id) throw new Error('Outside repair was not found.');
  const row = await env.DB.prepare(`
    SELECT a.repair_id,a.status,v.name AS vendor_name,COALESCE(e.unit,'') AS unit
    FROM outside_repair_assignments a
    JOIN outside_work_vendors v ON v.id=a.outside_vendor_id
    JOIN repairs r ON r.id=a.repair_id
    LEFT JOIN equipment e ON e.id=r.equipment_id
    WHERE a.repair_id=?
  `).bind(id).first<{repair_id:number;status:string;vendor_name:string;unit:string}>();
  if (!row || row.status !== 'waiting_vendor') throw new Error('This repair is not currently waiting on the vendor.');

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE outside_repair_assignments
      SET status='waiting_invoice',vendor_finished_at=CURRENT_TIMESTAMP,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE repair_id=? AND status='waiting_vendor'
    `).bind(user.id,id),
    env.DB.prepare(`UPDATE repairs SET status='Outside - Waiting on Invoice',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'outside_vendor_finished',?)
    `).bind(id,user.id,user.technicianId,`${row.vendor_name} reported ${row.unit || `repair #${id}`} fixed; invoice is still pending.`.slice(0,500)),
  ]);
  return { ok:true,message:`${row.unit || `Repair #${id}`} is now Waiting on Invoice.` };
}

async function returnToShop(request:Request, body:Record<string,unknown>) {
  const user = await requireManager(request);
  const id = repairId(body.repairId);
  if (!id) throw new Error('Outside repair was not found.');
  const row = await env.DB.prepare(`
    SELECT a.repair_id,a.status,a.previous_repair_status,a.previous_technician_id,
           v.name AS vendor_name,COALESCE(e.unit,'') AS unit
    FROM outside_repair_assignments a
    JOIN outside_work_vendors v ON v.id=a.outside_vendor_id
    JOIN repairs r ON r.id=a.repair_id
    LEFT JOIN equipment e ON e.id=r.equipment_id
    WHERE a.repair_id=?
  `).bind(id).first<{repair_id:number;status:string;previous_repair_status:string;previous_technician_id:number|null;vendor_name:string;unit:string}>();
  if (!row || !['waiting_vendor','waiting_invoice'].includes(row.status)) throw new Error('This repair is not currently active in Outside Repairs.');

  const restoreStatus = row.previous_repair_status && !/^outside\s*-/i.test(row.previous_repair_status) ? row.previous_repair_status : 'New';
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE outside_repair_assignments
      SET status='returned_shop',returned_to_shop_at=CURRENT_TIMESTAMP,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE repair_id=?
    `).bind(user.id,id),
    env.DB.prepare(`UPDATE repairs SET status=?,technician_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(restoreStatus,row.previous_technician_id,id),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'outside_repair_returned_to_shop',?)
    `).bind(id,user.id,user.technicianId,`${user.displayName} returned ${row.unit || `repair #${id}`} from ${row.vendor_name} to the Repair Board.`.slice(0,500)),
  ]);
  return { ok:true,message:`${row.unit || `Repair #${id}`} moved back to the Repair Board.` };
}

export async function GET(request:Request) {
  try {
    await requireManager(request);
    return Response.json(await assignmentPayload(),{headers:{'cache-control':'no-store'}});
  } catch (error) {
    const message=error instanceof Error?error.message:'Outside Repairs could not be loaded.';
    return Response.json({error:message},{status:message==='Authentication required.'?401:message.includes('Manager or administrator')?403:500,headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request:Request) {
  try {
    const body=await request.json().catch(()=>({})) as Record<string,unknown>;
    const action=String(body.action ?? '');
    let result;
    if(action==='assign') result=await assignOutside(request,body);
    else if(action==='vendor-finished') result=await vendorFinished(request,body);
    else if(action==='return-shop') result=await returnToShop(request,body);
    else throw new Error('Unknown Outside Repairs action.');
    return Response.json({...result,...await assignmentPayload()},{headers:{'cache-control':'no-store'}});
  } catch (error) {
    const message=error instanceof Error?error.message:'Outside Repairs change failed.';
    const status=message==='Authentication required.'?401:message.includes('Manager or administrator')?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
