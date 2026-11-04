"""One-time maintenance import. Does not edit identity, notes, repairs or odometers."""
import copy, datetime as dt, hashlib, json, re, sys
from collections import defaultdict
from pathlib import Path
import openpyxl
BATCH='maintenance-sheet-2026-11-04'
ASOF='2026-11-04'
ORDER=['trailer_annual','truck_annual','trailer_pm','truck_pm']
FIELDS=['unit','equipment_type','active','archived_at','merged_into_equipment_id','service_date','annual_date','status_service_date','status_annual_date','pm_type','last_mileage','profile_id','sequence_json','sale_status']
def compact(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True)
def digest(x):return hashlib.sha256(compact(x).encode()).hexdigest()
def text(v):
 if v is None:return ''
 if isinstance(v,(int,float)) and not isinstance(v,bool) and float(v).is_integer():return str(int(v))
 return str(v).strip()
def date(v):
 if isinstance(v,dt.datetime):return v.date().isoformat()
 if isinstance(v,dt.date):return v.isoformat()
 if isinstance(v,str):
  for f in ['%m/%d/%Y','%m/%d/%y','%Y-%m-%d']:
   try:return dt.datetime.strptime(v.strip(),f).date().isoformat()
   except ValueError:pass
 return None

def source(path):
 w=openpyxl.load_workbook(path,read_only=True,data_only=True)
 out={'batch':BATCH,'asOf':ASOF,'phases':{p:[] for p in ORDER},'issues':[],'blanks':[]}
 def add(p,u,v,r,c,m=None,t=None):
  u=text(u)
  if not u:return
  row={'unit':u,'row':r,'column':c,'tab':'Equipment Info' if p!='truck_pm' else "Truck PM'S"}
  d=date(v)
  if v in (None,''):
   out['blanks'].append(dict(row,phase=p,reason='Blank date; existing value preserved'));return
  if not d or d>ASOF or d<'2000-01-01':
   out['issues'].append(dict(row,phase=p,reason='Future date' if d and d>ASOF else 'Invalid date',value=text(v)));return
  row['date']=d
  if p=='truck_pm':
   if not isinstance(m,(int,float)) or isinstance(m,bool) or not float(m).is_integer() or not 0<=m<=5000000:
    out['issues'].append(dict(row,phase=p,reason='Not a valid mileage (hours and text are not converted)',value=text(m),pmType=t));return
   row.update(mileage=int(m),pmType=t)
  out['phases'][p].append(row)
 s=w['Equipment Info'];s.reset_dimensions()
 for i,r in enumerate(s.iter_rows(values_only=True),1):
  r=list(r)+[None]*7
  if i==1:
   assert [str(r[x]).strip().lower() for x in [0,1,2,5,6]]==['trailer #','service date','annual date','truck','annual date'],'Equipment headers changed';continue
  add('trailer_annual',r[0],r[2],i,'C');add('truck_annual',r[5],r[6],i,'G');add('trailer_pm',r[0],r[1],i,'B')
 names=[n for n in w.sheetnames if re.sub('[^a-z0-9]','',n.lower())=='truckpms'];assert len(names)==1,'Truck PM tab ambiguous'
 s=w[names[0]];s.reset_dimensions()
 for i,r in enumerate(s.iter_rows(values_only=True),1):
  r=list(r)+[None]*9
  if i==1:
   assert [text(r[x]).upper() for x in [0,1,3,5]]==['UNIT','40','20A','20B'],'Truck PM headers changed';continue
  if r[0] in (None,''):continue
  for c,t in [(2,'40'),(4,'20A'),(6,'20B')]:add('truck_pm',r[0],r[c],i,chr(65+c),r[c-1],t)
 for p,rows in out['phases'].items():
  assert len(rows)<=1500,'Source unexpectedly large'
  keys=[(r['unit'].upper(),r.get('pmType',''),r['date']) for r in rows]
  assert len(keys)==len(set(keys)),'Duplicate source maintenance row'
 return out

def exact(u):return re.sub(r'\s+','',str(u).upper())
def canonical(u,kind):
 v=str(u).upper().strip()
 v=re.sub(r'^(TRL|TRAILER)\s*','',v) if kind=='trailer' else re.sub(r'^(TRUCK|TRACTOR)\s+','',v)
 if kind=='powered' and v in ('FORD TRANSIT','FORD TRANSIT VAN'):return 'FORDTRANSITVAN'
 m=re.fullmatch(r'(\d+)\s*(?:\([^)]*\)|/[^\r\n]+)?',v)
 return m.group(1) if m else re.sub(r'\s+','',v)
def resolve(unit,phase,equipment):
 trailer=phase.startswith('trailer_');kind='trailer' if trailer else 'powered'
 eligible=[e for e in equipment if e.get('merged_into_equipment_id') is None and ((e['equipment_type']=='trailer')==trailer)]
 matches=[e for e in eligible if canonical(e['unit'],kind)==canonical(unit,kind)]
 active=[e for e in matches if e['active']==1 and not e['archived_at'] and e.get('sale_status')!='sold']
 if trailer and re.fullmatch(r'\d{3}',text(unit)):
  active=[e for e in active if re.match(r'^(TRL|TRAILER)\s+',e['unit'].upper())]
 if len(active)!=1:
  why='ambiguous' if len(active)>1 else 'inactive_or_sold' if matches and not any(e['active']==1 and not e['archived_at'] for e in matches) else 'unmatched'
  return None,why,[{'id':e['id'],'unit':e['unit'],'active':e['active']} for e in (active or matches)]
 e=active[0]
 return e,('exact' if exact(e['unit'])==exact(unit) else 'unit_alias'),[]
def before(e,events):
 out={k:e.get(k) for k in FIELDS};out['status_exists']=e.get('status_id') is not None
 out['event_count']=len([x for x in events if x['equipment_id']==e['id']]);return out

def plan(src,snapshot):
 equipment=copy.deepcopy(snapshot['equipment']);events=copy.deepcopy(snapshot['events'])
 report={'batch':BATCH,'sourceDigest':digest(src),'phases':[],'issues':copy.deepcopy(src['issues']),'blankDatesPreserved':len(src['blanks']),'operations':[]}
 for phase in ORDER:
  groups=defaultdict(list);skipped=[];aliases=[]
  for row in src['phases'][phase]:
   target,how,candidates=resolve(row['unit'],phase,equipment)
   if not target:skipped.append(dict(row,phase=phase,reason=how,candidates=candidates));continue
   groups[target['id']].append(row)
   if how!='exact':aliases.append({'source':row['unit'],'target':target['unit']})
  totals={'phase':phase,'sourceRows':len(src['phases'][phase]),'matchedUnits':len(groups),'updatedUnits':0,'historyOnlyUnits':0,'unchangedUnits':0,'eventsAdded':0,'skippedRows':len(skipped),'skipped':skipped,'aliases':aliases,'decisions':[]}
  for eid,rows in groups.items():
   e=next(x for x in equipment if x['id']==eid)
   annual=phase.endswith('annual');etype='annual' if annual else 'pm'
   related=[x for x in events if x['equipment_id']==eid]
   previous=before(e,events);updates={};new_events=[];warnings=[]
   rows=sorted(rows,key=lambda r:(r['date'],r.get('pmType','')))
   latest=rows[-1];last_date=latest['date'];same_day=defaultdict(list)
   for r in rows:same_day[r['date']].append(r)
   bad_dates={d for d,rs in same_day.items() if len({r.get('pmType') for r in rs})>1}
   if bad_dates:warnings.append('Multiple PM types on the same source date; those events and current PM state are held')
   hold_state=bool(bad_dates)
   if phase=='truck_pm':
    if any(i['phase']==phase and i['unit']==latest['unit'] and (i['reason'] in ('Future date','Invalid date') or i.get('date','')>=last_date) for i in src['issues']):
     hold_state=True;warnings.append('Incomplete/invalid source row may affect latest PM; current PM state held')
    if any(a['mileage']>b['mileage'] for a,b in zip(rows,rows[1:])):
     hold_state=True;warnings.append('Source PM mileage decreases over time; current PM state held')
   for r in rows:
    if r['date'] in bad_dates:continue
    day_events=[x for x in related if x['event_date'][:10]==r['date'] and (x['event_type']=='annual' if annual else x['event_type'] in ('pm','service'))]
    if day_events:
     if phase=='truck_pm' and any(x['pm_type'] not in (None,'',r['pmType']) or (x['mileage'] is not None and x['mileage']!=r['mileage']) for x in day_events):
      warnings.append('Existing same-day PM record differs; history left unchanged: '+r['date'])
      if r['date']==last_date:hold_state=True
     continue
    new_events.append({'equipment_id':eid,'event_type':etype,'pm_type':r.get('pmType',None if annual else 'Service'),'event_date':r['date'],'mileage':r.get('mileage'),'source':BATCH+'-'+phase,'notes':'Imported maintenance history from REPAIR LIST NEW; '+r['tab']+' row '+str(r['row'])+'. Not a new inspection or work-order sign-off.'})
   relevant_dates=[x['event_date'][:10] for x in related if x['event_type']=='annual'] if annual else [x['event_date'][:10] for x in related if x['event_type'] in ('pm','service')]
   col='annual_date' if annual else 'service_date'
   current_date=max([e.get(col) or '',e.get('status_'+col) or '']+relevant_dates)
   reason='source_is_older' if last_date<current_date else 'same_date' if last_date==current_date else 'newer_source'
   if not hold_state and last_date>=current_date:
    updates[col]=last_date;updates['status_'+col]=last_date
    if phase=='truck_pm':
     try:seq=json.loads(e['sequence_json']) if e['sequence_json'] else ['40','20A','20B']
     except (ValueError,TypeError):seq=[]
     if not isinstance(seq,list) or not seq or not all(isinstance(x,str) and x for x in seq) or latest['pmType'] not in seq:
      warnings.append('Latest source PM type is outside configured rotation; current PM state held');hold_state=True;updates={}
     else:
      if e.get('status_service_date')==last_date and e.get('last_mileage') not in (None,latest['mileage']):
       warnings.append('Current PM mileage differs on same date; current PM state held');hold_state=True;updates={}
      else:
       updates['last_mileage']=latest['mileage'];updates['pm_type']=seq[(seq.index(latest['pmType'])+1)%len(seq)]
       if not e.get('sequence_json'):warnings.append('No PM profile assigned; prior standard 40/20A/20B fallback used, profile settings unchanged')
   updates={k:v for k,v in updates.items() if e.get(k)!=v}
   if updates and e.get('status_id') is None:e['status_id']=-1
   e.update(updates);events.extend(new_events)
   outcome='updated' if updates else 'history_only' if new_events else 'unchanged'
   totals[{'updated':'updatedUnits','history_only':'historyOnlyUnits','unchanged':'unchangedUnits'}[outcome]]+=1
   totals['eventsAdded']+=len(new_events)
   decision={'equipmentId':eid,'unit':e['unit'],'sourceUnit':latest['unit'],'sourceRows':[r['row'] for r in rows],'outcome':outcome,'reason':'state_held' if hold_state else reason,'sourceDate':last_date,'previousDate':current_date,'updates':updates,'eventsAdded':len(new_events),'warnings':warnings}
   totals['decisions'].append(decision)
   if warnings:report['issues'].extend(dict(phase=phase,unit=e['unit'],row=latest['row'],reason=w) for w in warnings)
   if updates or new_events:report['operations'].append({'phase':phase,'equipmentId':eid,'unit':e['unit'],'before':previous,'after':before(e,events),'updates':updates,'events':new_events,'sourceRows':[r['row'] for r in rows]})
  report['phases'].append(totals)
 report['planDigest']=digest({'sourceDigest':report['sourceDigest'],'operations':report['operations']})
 return report
if __name__=='__main__':
 src=source(sys.argv[1]);snap=json.loads(Path(sys.argv[2]).read_text());p=plan(src,snap)
 Path(sys.argv[3]).write_text(compact(p))
