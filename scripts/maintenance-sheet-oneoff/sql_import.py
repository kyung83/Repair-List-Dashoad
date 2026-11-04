"""Generate only scoped maintenance SQL; no arbitrary SQL is accepted from input."""
import json
from plan_import import BATCH, ORDER, compact
AUDIT='maintenance_sheet_import_items'
RUNS='maintenance_sheet_import_runs'
SQL_FIELDS={
 'unit':'e.unit','equipment_type':'e.equipment_type','active':'e.active','archived_at':'e.archived_at',
 'merged_into_equipment_id':'e.merged_into_equipment_id','service_date':'e.service_date','annual_date':'e.annual_date',
 'status_service_date':'ps.service_date','status_annual_date':'ps.annual_date','pm_type':'ps.pm_type','last_mileage':'ps.last_mileage',
 'profile_id':'s.profile_id','sequence_json':'p.sequence_json','sale_status':'sale.sale_status',
 'status_exists':'CASE WHEN ps.id IS NULL THEN 0 ELSE 1 END',
 'event_count':"(SELECT COUNT(*) FROM maintenance_events me WHERE me.equipment_id=e.id AND me.event_type IN ('annual','pm','service'))",
}
JOIN="""FROM equipment e LEFT JOIN pm_status ps ON ps.equipment_id=e.id
 LEFT JOIN equipment_pm_settings s ON s.equipment_id=e.id
 LEFT JOIN pm_profiles p ON p.id=s.profile_id
 LEFT JOIN fleet_truck_sales sale ON sale.equipment_id=e.id"""
def q(v):
 if v is None:return 'NULL'
 if isinstance(v,bool):return '1' if v else '0'
 if isinstance(v,int):return str(v)
 if not isinstance(v,str):raise ValueError('Only scalar SQL values allowed')
 return "'"+v.replace("'","''")+"'"
def guard(eid,state):
 if set(state)!=set(SQL_FIELDS):raise ValueError('Unknown snapshot fields')
 return 'EXISTS(SELECT 1 '+JOIN+' WHERE e.id='+q(eid)+' AND '+' AND '.join('('+SQL_FIELDS[k]+') IS '+q(v) for k,v in state.items())+')'
def bootstrap_sql():
 return f"""CREATE TABLE IF NOT EXISTS {RUNS} (
 batch TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, plan_sha256 TEXT NOT NULL,
 before_bookmark TEXT NOT NULL, phases_json TEXT NOT NULL DEFAULT '[]',
 state TEXT NOT NULL CHECK(state IN ('running','verified')), started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 verified_at TEXT);
CREATE TABLE IF NOT EXISTS {AUDIT} (
 batch TEXT NOT NULL, phase TEXT NOT NULL, equipment_id INTEGER NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL, inserted_events_json TEXT NOT NULL,
 source_rows_json TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 guard_ok INTEGER NOT NULL CHECK(guard_ok=1),
 PRIMARY KEY(batch,phase,equipment_id));"""
def operation_sql(op):
 eid=op['equipmentId'];phase=op['phase'];updates=op['updates'];events=op['events']
 if not isinstance(eid,int) or eid<=0 or phase not in ORDER:raise ValueError('Invalid target')
 permitted={'annual_date','status_annual_date'} if phase.endswith('annual') else {'service_date','status_service_date'} if phase=='trailer_pm' else {'service_date','status_service_date','last_mileage','pm_type'}
 if not set(updates)<=permitted:raise ValueError('Update outside allowed maintenance columns')
 before=guard(eid,op['before']);after=guard(eid,op['after'])
 exists=f'EXISTS(SELECT 1 FROM {AUDIT} WHERE batch={q(BATCH)} AND phase={q(phase)} AND equipment_id={eid})'
 audit_after=f'EXISTS(SELECT 1 FROM {AUDIT} WHERE batch={q(BATCH)} AND phase={q(phase)} AND equipment_id={eid} AND after_json={q(compact(op["after"]))})'
 lines=[f'''INSERT INTO {AUDIT}(batch,phase,equipment_id,before_json,after_json,inserted_events_json,source_rows_json,guard_ok)
 VALUES({q(BATCH)},{q(phase)},{eid},{q(compact(op['before']))},{q(compact(op['after']))},{q(compact(events))},{q(compact(op['sourceRows']))},
 CASE WHEN (NOT {exists} AND {before}) OR ({audit_after} AND {after}) THEN 1 ELSE 0 END)
 ON CONFLICT(batch,phase,equipment_id) DO UPDATE SET guard_ok=excluded.guard_ok;''']
 for ev in events:
  if ev['equipment_id']!=eid or ev['event_type']!=('annual' if phase.endswith('annual') else 'pm') or ev['source']!=BATCH+'-'+phase:raise ValueError('Invalid event scope')
  keys=['equipment_id','event_type','pm_type','event_date','mileage','source','notes']
  values=','.join(q(ev[k]) for k in keys)
  lines.append('INSERT INTO maintenance_events('+','.join(keys)+') VALUES('+values+') ON CONFLICT(equipment_id,event_type,event_date,source) DO NOTHING;')
 eupdate={k:v for k,v in updates.items() if k in ('annual_date','service_date')}
 if eupdate:lines.append('UPDATE equipment SET '+','.join(k+'='+q(v) for k,v in eupdate.items())+',updated_at=CURRENT_TIMESTAMP WHERE id='+str(eid)+';')
 psupdate={k.removeprefix('status_'):v for k,v in updates.items() if k in ('status_service_date','status_annual_date','last_mileage','pm_type')}
 if psupdate:
  keys=list(psupdate);cols=','.join(keys);vals=','.join(q(psupdate[k]) for k in keys)
  lines.append('INSERT INTO pm_status(equipment_id,'+cols+',updated_at) VALUES('+str(eid)+','+vals+',CURRENT_TIMESTAMP) ON CONFLICT(equipment_id) DO UPDATE SET '+','.join(k+'=excluded.'+k for k in keys)+',updated_at=CURRENT_TIMESTAMP;')
 lines.append(f'UPDATE {AUDIT} SET guard_ok=CASE WHEN {after} THEN 1 ELSE 0 END WHERE batch={q(BATCH)} AND phase={q(phase)} AND equipment_id={eid};')
 return '\n'.join(lines)
def compile_plan(p):
 return {'batch':BATCH,'sourceDigest':p['sourceDigest'],'planDigest':p['planDigest'],
 'bootstrapSql':bootstrap_sql(),'phases':[{'phase':ph,'operations':[{'equipmentId':o['equipmentId'],'sql':operation_sql(o),'after':o['after']} for o in p['operations'] if o['phase']==ph]} for ph in ORDER]}
if __name__=='__main__':
 import sys
 from pathlib import Path
 p=json.loads(Path(sys.argv[1]).read_text());Path(sys.argv[2]).write_text(compact(compile_plan(p)))
