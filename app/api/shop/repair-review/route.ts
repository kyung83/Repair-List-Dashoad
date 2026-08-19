import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    if (!['mechanic', 'manager', 'admin'].includes(user.role)) {
      throw new Error('This account cannot review repair work.');
    }

    const id = numericRepairId(new URL(request.url).searchParams.get('repairId'));
    if (!id) throw new Error('Repair was not found.');

    const repair = await env.DB.prepare(`
      SELECT r.id, r.technician_id, COALESCE(r.title, '') AS title,
             COALESCE(r.status, '') AS status, COALESCE(e.unit, '') AS unit
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      WHERE r.id = ?
    `).bind(id).first<{
      id:number;
      technician_id:number|null;
      title:string;
      status:string;
      unit:string;
    }>();
    if (!repair) throw new Error('Repair was not found.');

    if (user.role === 'mechanic') {
      if (!user.technicianId || Number(repair.technician_id ?? 0) !== Number(user.technicianId)) {
        throw new Error('This repair is not assigned to you.');
      }
    }

    const [notes, parts, labor, requests] = await Promise.all([
      env.DB.prepare(`
        SELECT e.id, COALESCE(e.detail, '') AS detail, e.created_at,
               COALESCE(t.name, 'Technician') AS technician_name
        FROM repair_job_events e
        LEFT JOIN technicians t ON t.id = e.technician_id
        WHERE e.repair_id = ? AND e.action = 'technician_note'
        ORDER BY e.created_at ASC, e.id ASC
      `).bind(id).all<{
        id:number;
        detail:string;
        created_at:string;
        technician_name:string;
      }>(),
      env.DB.prepare(`
        SELECT rp.part_id, p.part_number, p.description,
               SUM(rp.quantity) AS quantity,
               MAX(rp.created_at) AS last_applied_at
        FROM repair_parts rp
        JOIN parts p ON p.id = rp.part_id
        WHERE rp.repair_id = ?
        GROUP BY rp.part_id, p.part_number, p.description
        ORDER BY p.part_number
      `).bind(id).all<{
        part_id:number;
        part_number:string;
        description:string;
        quantity:number;
        last_applied_at:string;
      }>(),
      env.DB.prepare(`
        SELECT l.id, l.labor_date, l.hours, l.rate, COALESCE(l.notes, '') AS notes,
               l.started_at, l.ended_at,
               COALESCE(t.name, 'Shop labor') AS technician_name
        FROM repair_labor_entries l
        LEFT JOIN technicians t ON t.id = l.technician_id
        WHERE l.repair_id = ?
        ORDER BY COALESCE(l.started_at, l.labor_date) ASC, l.id ASC
      `).bind(id).all<{
        id:number;
        labor_date:string;
        hours:number;
        rate:number;
        notes:string;
        started_at:string|null;
        ended_at:string|null;
        technician_name:string;
      }>(),
      env.DB.prepare(`
        SELECT q.id, q.part_id, p.part_number, p.description,
               q.requested_quantity, q.reserved_quantity, q.used_quantity,
               q.status, q.created_at, q.updated_at
        FROM repair_part_requests q
        JOIN parts p ON p.id = q.part_id
        WHERE q.repair_id = ?
        ORDER BY q.created_at ASC, q.id ASC
      `).bind(id).all<{
        id:number;
        part_id:number;
        part_number:string;
        description:string;
        requested_quantity:number;
        reserved_quantity:number;
        used_quantity:number;
        status:string;
        created_at:string;
        updated_at:string;
      }>(),
    ]);

    return Response.json({
      ok:true,
      repair:{
        id:`repair-${repair.id}`,
        unit:repair.unit,
        title:repair.title,
        status:repair.status,
      },
      notes:notes.results.map((row)=>({
        id:Number(row.id),
        detail:row.detail,
        technician:row.technician_name,
        createdAt:row.created_at,
      })),
      parts:parts.results.map((row)=>({
        partId:Number(row.part_id),
        partNumber:row.part_number,
        description:row.description,
        quantity:Number(row.quantity ?? 0),
        lastAppliedAt:row.last_applied_at,
      })),
      labor:labor.results.map((row)=>({
        id:Number(row.id),
        technician:row.technician_name,
        laborDate:row.labor_date,
        hours:Number(row.hours ?? 0),
        rate:Number(row.rate ?? 0),
        notes:row.notes,
        startedAt:row.started_at,
        endedAt:row.ended_at,
      })),
      requests:requests.results.map((row)=>{
        const requestedQuantity=Number(row.requested_quantity ?? 0);
        const usedQuantity=Number(row.used_quantity ?? 0);
        const reservedQuantity=Number(row.reserved_quantity ?? 0);
        const remainingQuantity=Math.max(0,requestedQuantity-usedQuantity);
        return {
          id:Number(row.id),
          partId:Number(row.part_id),
          partNumber:row.part_number,
          description:row.description,
          requestedQuantity,
          reservedQuantity,
          usedQuantity,
          remainingQuantity,
          shortageQuantity:Math.max(0,remainingQuantity-reservedQuantity),
          status:row.status,
          createdAt:row.created_at,
          updatedAt:row.updated_at,
        };
      }),
      updatedAt:new Date().toISOString(),
    }, { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : 'Repair review could not be loaded.' }, { status:400, headers:{ 'cache-control':'no-store' } });
  }
}
