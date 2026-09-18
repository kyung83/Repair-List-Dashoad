import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type CurrentRepairRow = {
  id:number;
  equipment_id:number|null;
  technician_id:number|null;
  unit:string;
  title:string;
  source:string;
  repair_type:string;
};

type LiveHistoryRow = {
  id:number;
  title:string;
  description:string;
  status:string;
  source:string;
  repair_type:string;
  occurred_at:string;
  mileage_at_completion:number|null;
};

type HistoricalRow = {
  id:number;
  ro_number:string;
  ro_date:string;
  work_text:string;
};

type NoteRow = { repair_id:number; detail:string; created_at:string };
type PartRow = { repair_id:number; part_number:string; description:string; quantity:number };
type PhotoRow = { repair_id:number; photo_key:string; object_key:string; content_type:string|null; note:string; created_at:string };
type IdentityRow = { value:string };

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function photoUrl(key:string) {
  return '/api/photos/' + key.split('/').map(encodeURIComponent).join('/');
}

function escapeRegExp(value:string) {
  return value.replace(/[\^$.*+?()[\]{}|]/g,'\\$&');
}

function redactIdentity(value:string, identities:string[]) {
  let text=String(value??'');
  for (const identity of identities) {
    const clean=identity.trim();
    if (clean.length<3) continue;
    text=text.replace(new RegExp(escapeRegExp(clean),'gi'),'Technician');
  }
  return text;
}

const STOP_WORDS = new Set([
  'a','an','and','are','at','bad','be','been','but','by','check','checked','driver','fix','fixed','for','from',
  'has','have','in','is','it','need','needs','not','of','on','or','problem','repair','repaired','reported','the',
  'this','to','truck','trailer','unit','was','with'
]);

function tokens(value:string) {
  return [...new Set(
    String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/)
      .map(token=>token.trim()).filter(token=>token.length>=2&&!STOP_WORDS.has(token))
  )];
}

function isSimilar(currentIssue:string,currentType:string,entry:{issue:string;details:string;repairType:string;notes:{detail:string}[];parts:{partNumber:string;description:string}[]}) {
  const current=tokens(currentIssue);
  if (!current.length) return false;
  const haystack=tokens([
    entry.issue,entry.details,entry.repairType,
    ...entry.notes.map(note=>note.detail),
    ...entry.parts.flatMap(part=>[part.partNumber,part.description]),
  ].join(' '));
  const set=new Set(haystack);
  const overlap=current.filter(token=>set.has(token)).length;
  const typeMatch=Boolean(currentType)&&entry.repairType.toLowerCase()===currentType.toLowerCase();
  return overlap>=2 || (overlap>=1&&typeMatch) || (current.length===1&&overlap===1);
}

function maintenanceLabel(source:string,repairType:string) {
  if (source==='scheduled-pm') return 'PM';
  if (source==='scheduled-annual') return 'ANNUAL';
  return repairType || 'Uncategorized';
}

export async function GET(request:Request) {
  try {
    const user=await getSessionUser(env.DB,request);
    if (!user) throw new Error('Authentication required.');
    if (!['mechanic','manager','admin'].includes(user.role)) throw new Error('This account cannot view unit work history.');

    const currentRepairId=numericRepairId(new URL(request.url).searchParams.get('repairId'));
    if (!currentRepairId) throw new Error('The current repair was not found.');

    const active=await env.DB.prepare(`
      SELECT repair_id,technician_id
      FROM repair_labor_timers
      WHERE user_id=?
    `).bind(user.id).first<{repair_id:number;technician_id:number}>();
    if (!active || Number(active.repair_id)!==currentRepairId) {
      throw new Error('Unit history is available for the repair that is WORKING NOW.');
    }

    const current=await env.DB.prepare(`
      SELECT r.id,r.equipment_id,r.technician_id,COALESCE(e.unit,'') AS unit,
             COALESCE(r.title,'') AS title,COALESCE(r.source,'manual') AS source,
             COALESCE(rt.name,'') AS repair_type
      FROM repairs r
      LEFT JOIN equipment e ON e.id=r.equipment_id
      LEFT JOIN repair_types rt ON rt.id=r.repair_type_id
      WHERE r.id=?
    `).bind(currentRepairId).first<CurrentRepairRow>();
    if (!current) throw new Error('The current repair was not found.');
    if (!current.equipment_id) throw new Error('This work order is not linked to a fleet unit.');
    if (user.role==='mechanic' && (
      !user.technicianId ||
      Number(current.technician_id??0)!==Number(user.technicianId) ||
      Number(active.technician_id)!==Number(user.technicianId)
    )) {
      throw new Error('This repair is not assigned to you.');
    }

    const [live, historical, identities] = await Promise.all([
      env.DB.prepare(`
        SELECT r.id,COALESCE(r.title,'') AS title,COALESCE(r.description,'') AS description,
               COALESCE(r.status,'') AS status,COALESCE(r.source,'manual') AS source,
               COALESCE(rt.name,'') AS repair_type,
               COALESCE(r.completed_at,r.updated_at,r.opened_at,'') AS occurred_at,
               m.mileage_at_completion
        FROM repairs r
        LEFT JOIN repair_types rt ON rt.id=r.repair_type_id
        LEFT JOIN maintenance_checklist_runs m ON m.repair_id=r.id
        WHERE r.equipment_id=? AND r.id<>?
          AND lower(COALESCE(r.status,'')) LIKE '%complete%'
        ORDER BY COALESCE(r.completed_at,r.updated_at,r.opened_at) DESC,r.id DESC
        LIMIT 120
      `).bind(current.equipment_id,currentRepairId).all<LiveHistoryRow>(),
      env.DB.prepare(`
        SELECT h.id,h.ro_number,h.ro_date,
               COALESCE(GROUP_CONCAT(DISTINCT NULLIF(l.vmrs_description,'')),'') AS work_text
        FROM historical_repairs h
        LEFT JOIN historical_repair_lines l ON l.historical_repair_id=h.id
        WHERE h.equipment_id=?
        GROUP BY h.id,h.ro_number,h.ro_date
        ORDER BY h.ro_date DESC,h.id DESC
        LIMIT 120
      `).bind(current.equipment_id).all<HistoricalRow>(),
      env.DB.prepare(`
        SELECT name AS value FROM technicians WHERE trim(COALESCE(name,''))<>''
        UNION
        SELECT display_name AS value FROM app_users WHERE trim(COALESCE(display_name,''))<>''
        UNION
        SELECT username AS value FROM app_users WHERE trim(COALESCE(username,''))<>''
      `).all<IdentityRow>(),
    ]);

    const liveIds=live.results.map(row=>Number(row.id)).filter(Boolean);
    const identitiesList=identities.results.map(row=>String(row.value??'').trim()).filter(Boolean).sort((a,b)=>b.length-a.length);
    const notesByRepair=new Map<number,{id:string;detail:string;createdAt:string}[]>();
    const partsByRepair=new Map<number,{partNumber:string;description:string;quantity:number}[]>();
    const photosByRepair=new Map<number,{id:string;fileName:string;contentType:string;note:string;createdAt:string;url:string}[]>();

    if (liveIds.length) {
      const placeholders=liveIds.map(()=>'?').join(',');
      const notesSql=`
          SELECT repair_id,COALESCE(detail,'') AS detail,created_at
          FROM repair_job_events
          WHERE repair_id IN (__IDS__) AND action='technician_note'
          ORDER BY created_at ASC,id ASC
        `.replace('__IDS__',placeholders);
      const partsSql=`
          SELECT rp.repair_id,p.part_number,p.description,SUM(rp.quantity) AS quantity
          FROM repair_parts rp
          JOIN parts p ON p.id=rp.part_id
          WHERE rp.repair_id IN (__IDS__)
          GROUP BY rp.repair_id,p.id,p.part_number,p.description
          ORDER BY rp.repair_id,p.part_number
        `.replace('__IDS__',placeholders);
      const workPhotosSql=`
          SELECT repair_id,'work-'||id AS photo_key,object_key,content_type,
                 COALESCE(note,'') AS note,created_at
          FROM repair_work_photos
          WHERE repair_id IN (__IDS__)
          ORDER BY repair_id,created_at,id
        `.replace('__IDS__',placeholders);
      const maintenancePhotosSql=`
          SELECT r.repair_id,'maintenance-'||p.id AS photo_key,p.object_key,p.content_type,
                 COALESCE(i.item_text,'') AS note,p.created_at
          FROM maintenance_checklist_photos p
          JOIN maintenance_checklist_runs r ON r.id=p.checklist_run_id
          JOIN maintenance_checklist_items i ON i.id=p.checklist_item_id
          WHERE r.repair_id IN (__IDS__)
          ORDER BY r.repair_id,p.created_at,p.id
        `.replace('__IDS__',placeholders);
      const typePhotosSql=`
          SELECT r.repair_id,'type-'||p.id AS photo_key,p.object_key,p.content_type,
                 COALESCE(i.item_text,'') AS note,p.created_at
          FROM repair_type_checklist_photos p
          JOIN repair_type_checklist_runs r ON r.id=p.checklist_run_id
          JOIN repair_type_checklist_items i ON i.id=p.checklist_item_id
          WHERE r.repair_id IN (__IDS__)
          ORDER BY r.repair_id,p.created_at,p.id
        `.replace('__IDS__',placeholders);

      const [notes,parts,workPhotos,maintenancePhotos,typePhotos]=await Promise.all([
        env.DB.prepare(notesSql).bind(...liveIds).all<NoteRow>(),
        env.DB.prepare(partsSql).bind(...liveIds).all<PartRow>(),
        env.DB.prepare(workPhotosSql).bind(...liveIds).all<PhotoRow>(),
        env.DB.prepare(maintenancePhotosSql).bind(...liveIds).all<PhotoRow>(),
        env.DB.prepare(typePhotosSql).bind(...liveIds).all<PhotoRow>(),
      ]);

      for (const row of notes.results) {
        const list=notesByRepair.get(Number(row.repair_id))??[];
        list.push({id:'note-'+row.repair_id+'-'+(list.length+1),detail:redactIdentity(row.detail,identitiesList),createdAt:row.created_at});
        notesByRepair.set(Number(row.repair_id),list);
      }
      for (const row of parts.results) {
        const list=partsByRepair.get(Number(row.repair_id))??[];
        list.push({partNumber:row.part_number,description:row.description,quantity:Number(row.quantity??0)});
        partsByRepair.set(Number(row.repair_id),list);
      }
      for (const row of [...workPhotos.results,...maintenancePhotos.results,...typePhotos.results]) {
        const list=photosByRepair.get(Number(row.repair_id))??[];
        list.push({
          id:row.photo_key,
          fileName:'Repair photo',
          contentType:row.content_type||'',
          note:redactIdentity(row.note,identitiesList),
          createdAt:row.created_at,
          url:photoUrl(row.object_key),
        });
        photosByRepair.set(Number(row.repair_id),list);
      }
    }

    const liveEntries=live.results.map(row=>{
      const repairType=maintenanceLabel(row.source,row.repair_type);
      return {
        id:'repair-'+row.id,
        kind:'repair' as const,
        date:row.occurred_at,
        repairType,
        source:row.source,
        issue:redactIdentity(row.title,identitiesList),
        details:redactIdentity(row.description,identitiesList),
        status:row.status,
        mileage:row.mileage_at_completion==null?null:Number(row.mileage_at_completion),
        notes:notesByRepair.get(Number(row.id))??[],
        parts:partsByRepair.get(Number(row.id))??[],
        photos:photosByRepair.get(Number(row.id))??[],
      };
    });

    const historicalEntries=historical.results.map(row=>({
      id:'historical-'+row.id,
      kind:'historical' as const,
      date:row.ro_date,
      repairType:'Historical RO',
      source:'historical-ro',
      issue:'RO '+row.ro_number,
      details:redactIdentity(row.work_text,identitiesList),
      status:'Completed',
      mileage:null,
      notes:[],
      parts:[],
      photos:[],
    }));

    const currentType=maintenanceLabel(current.source,current.repair_type);
    const entries=[...liveEntries,...historicalEntries]
      .map(entry=>({...entry,similar:isSimilar(current.title,currentType,entry)}))
      .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
      .slice(0,180);
    const relatedCount=entries.filter(entry=>entry.similar).length;

    return Response.json({
      ok:true,
      unit:current.unit,
      current:{repairId:'repair-'+current.id,issue:redactIdentity(current.title,identitiesList),repairType:currentType},
      relatedCount,
      repeatRepair:relatedCount>=2,
      entries,
      privacy:{technicianIdentityIncluded:false},
      updatedAt:new Date().toISOString(),
    },{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return Response.json(
      {error:error instanceof Error?error.message:'Unit work history could not be loaded.'},
      {status:400,headers:{'cache-control':'no-store'}},
    );
  }
}
