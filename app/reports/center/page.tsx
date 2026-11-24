'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {analysisRows,cleared,repeats,unitRollups,sum,type AnalysisRow,type Dataset,type RepairData,type BreakdownData} from '@/lib/report-center-model';
import ComparisonWorkspace from './comparison-workspace';
import ReportTable,{column,defaultColumns,dateRangeLabel,formatValue,type TableRow} from './report-table';
import RecordDetail from './record-detail';
import styles from './report-center.module.css';

type Scope={start:string;end:string;equipmentType:string;unit:string;q:string};
type Period={scope:Scope;repairs:RepairData;breakdowns:BreakdownData};
type Tab='overview'|'repairs'|'breakdowns'|'units'|'compare'|'repeat'|'parts'|'maintenance'|'expenses'|'technicians'|'library';
const tabs:Array<{id:Tab;label:string}>=[{id:'overview',label:'Overview'},{id:'repairs',label:'Repairs & ROs'},{id:'breakdowns',label:'Breakdowns'},{id:'units',label:'Unit reliability / history'},{id:'compare',label:'Compare / custom reports'},{id:'repeat',label:'Repeat failures'},{id:'parts',label:'Parts'},{id:'maintenance',label:'PMs & annuals'},{id:'expenses',label:'Ownership & expenses'},{id:'technicians',label:'Technicians'},{id:'library',label:'All existing reports'}];
const legacy=[
 ['Fleet Summary / lifetime costs','/reports','Fleet and unit costs, lifecycle cost, cost per recorded mile, yearly trends and original exports.'],
 ['Unit Cost / Search','/reports/search','All original equipment, repair, technician, location, source, PM and expense filters.'],
 ['Breakdown Reports','/reports/breakdowns','Original tire-position, provider, location, category and status reports; completed-record edits, detailed printing and exports.'],
 ['Historical Repair Orders','/reports/history','Imported repair orders, VMRS major categories, systems, assemblies and historical cost corrections.'],
 ['Parts Usage','/reports/parts-usage','Original part usage and repair/part analysis.'],
 ['Technician Productivity','/reports/technician-productivity','Actual direct and indirect labor, daily productivity and work completed.'],
 ['Compare Technicians on Jobs','/reports/technician-productivity/comparisons','Existing same-job comparisons and productivity details.'],
 ['Completed Work / Work Orders','/work-orders','Original work order review, approvals and corrections.'],
 ['PM Records / Forms','/pm-inspections','Original PM inspection records and forms.'],
 ['Annual Records / Forms','/annual-inspections','Original annual inspection records and forms.'],
];
function day(){const d=new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=(k:string)=>d.find(x=>x.type===k)?.value??'';return p('year')+'-'+p('month')+'-'+p('day');}
function shift(date:string,days:number){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function initialScope():Scope{const end=day();return {start:shift(end,-29),end,equipmentType:'',unit:'',q:''};}
function previous(scope:Scope):Scope{const duration=Math.max(0,Math.round((Date.parse(scope.end)-Date.parse(scope.start))/86400000));const end=shift(scope.start,-1);return {...scope,start:shift(end,-duration),end};}
function preset(key:string):{start:string;end:string}|null{const today=day(),year=Number(today.slice(0,4));switch(key){case'today':return {start:today,end:today};case'7':return {start:shift(today,-6),end:today};case'30':return {start:shift(today,-29),end:today};case'90':return {start:shift(today,-89),end:today};case'month':return {start:today.slice(0,7)+'-01',end:today};case'ytd':return {start:year+'-01-01',end:today};case'lastyear':return {start:(year-1)+'-01-01',end:(year-1)+'-12-31'};case'all':return {start:'1900-01-01',end:today};default:return null;}}
function money(n:number|null|undefined){return formatValue(n,column('totalCost'));}
function hours(n:number|null|undefined){return formatValue(n,{key:'hours',label:'Hours',format:'hours'});}
type Equipment={id:number;unit:string;equipmentType:string;make?:string;model?:string};
function ScopeFields({value,onChange,equipment,busy,onRun,label}:{value:Scope;onChange:(value:Scope)=>void;equipment:Equipment[];busy:boolean;onRun:()=>void;label:string}){
 const units=equipment.filter(e=>!value.equipmentType||e.equipmentType===value.equipmentType).slice().sort((a,b)=>a.unit.localeCompare(b.unit,undefined,{numeric:true}));
 function set<K extends keyof Scope>(k:K,v:Scope[K]){onChange({...value,[k]:v,...(k==='equipmentType'?{unit:''}:{})});}
 return <form onSubmit={e=>{e.preventDefault();onRun();}} className={styles.fields}>
  <label className={styles.field}>Quick dates<select className={styles.input} value="" onChange={e=>{const p=preset(e.target.value);if(p)onChange({...value,...p});}}><option value="">Select a range</option>{[['today','Today'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['month','This month'],['ytd','Year to date'],['lastyear','Last calendar year'],['all','All history']].map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label className={styles.field}>Start date<input required className={styles.input} type="date" value={value.start} max={value.end} onChange={e=>set('start',e.target.value)}/></label>
  <label className={styles.field}>End date<input required className={styles.input} type="date" value={value.end} min={value.start} onChange={e=>set('end',e.target.value)}/></label>
  <label className={styles.field}>Equipment<select className={styles.input} value={value.equipmentType} onChange={e=>set('equipmentType',e.target.value)}><option value="">All equipment</option><option value="truck">Trucks</option><option value="trailer">Trailers</option></select></label>
  <label className={styles.field}>Unit<select className={styles.input} value={value.unit} onChange={e=>set('unit',e.target.value)}><option value="">All units</option>{units.map(e=><option key={e.id} value={e.id}>{e.unit}{e.make?' · '+e.make:''}</option>)}</select></label>
  <label className={styles.field} style={{gridColumn:'span 2'}}>Deep search across record text<input className={styles.input} value={value.q} maxLength={200} onChange={e=>set('q',e.target.value)} placeholder="Complaint, part number, tech note, vendor, VMRS…" /></label>
  <button className={styles.primary} type="submit" disabled={busy||!value.start||!value.end||value.start>value.end}>{busy?'Loading…':label}</button>
 </form>;
}
async function readPeriod(scope:Scope,signal:AbortSignal):Promise<Period>{
 const params=new URLSearchParams({start:scope.start,end:scope.end,equipmentType:scope.equipmentType,unit:scope.unit,q:scope.q.trim()});
 async function get<T,>(view:'repairs'|'breakdowns'):Promise<T>{const r=await fetch('/api/reports/center?'+params.toString()+'&view='+view,{cache:'no-store',signal});const payload=await r.json();if(!r.ok)throw Error(payload.error||'Report request failed.');return payload as T;}
 const [repairs,breakdowns]=await Promise.all([get<RepairData>('repairs'),get<BreakdownData>('breakdowns')]);
 return {scope:{...scope,q:scope.q.trim()},repairs,breakdowns};
}
function partial(p:Period|null):Record<Dataset,boolean>{return {repairs:!!p?.repairs.truncated.repairs,breakdowns:!!p?.breakdowns.truncated,maintenance:!!p?.repairs.truncated.maintenance,expenses:!!p?.repairs.truncated.expenses,parts:(p?.repairs.parts.length??0)>=1000};}
function context(p:Period|null){if(!p)return'No report loaded';const e=p.repairs.equipment.find(x=>String(x.id)===p.scope.unit)??p.breakdowns.filterOptions.equipment.find(x=>String(x.id)===p.scope.unit);return dateRangeLabel(p.scope)+' · '+(p.scope.equipmentType||'All equipment')+(p.scope.unit?' · '+(e?.unit??p.scope.unit):' · All units')+(p.scope.q?' · Search: '+p.scope.q:'');}

function Library(){return <section className={styles.panel}><h2>Every existing report and workflow</h2><p className={styles.muted}>The trial is additive. These are the original reports and controls, with no replacement or loss of features.</p><div className={styles.two}>{legacy.map(([title,href,description])=><div key={href} className={styles.panel}><h3>{title}</h3><p className={styles.muted}>{description}</p><a className={styles.link} href={href}>Open {title}</a></div>)}</div></section>;}
export default function ReportingCenter(){
 const [draft,setDraft]=useState(initialScope),[draftB,setDraftB]=useState(()=>previous(initialScope())),[a,setA]=useState<Period|null>(null),[b,setB]=useState<Period|null>(null),[loadingA,setLoadingA]=useState(false),[loadingB,setLoadingB]=useState(false),[errorA,setErrorA]=useState(''),[errorB,setErrorB]=useState('');
 const [tab,setTab]=useState<Tab>('overview'),[detail,setDetail]=useState<AnalysisRow|null>(null),[unitFilter,setUnitFilter]=useState<number|null>(null),[repeatDays,setRepeatDays]=useState(30),[repeatSelection,setRepeatSelection]=useState<{kind:string;ids:number[];label:string}|null>(null),[includeCleared,setIncludeCleared]=useState(false),[compareStart,setCompareStart]=useState<{dataset:Dataset;dimension?:string}>({dataset:'repairs'}),[compareEpoch,setCompareEpoch]=useState(0);
 const refs=useRef<{a?:AbortController;b?:AbortController}>({}),detailRef=useRef<HTMLDivElement>(null);
 const run=useCallback(async(scope:Scope,target:'a'|'b')=>{
   const setError=target==='a'?setErrorA:setErrorB,setLoading=target==='a'?setLoadingA:setLoadingB,setData=target==='a'?setA:setB;
   if(!scope.start||!scope.end||scope.start>scope.end){setError('Choose a valid date range.');return;}
   refs.current[target]?.abort();const c=new AbortController();refs.current[target]=c;setLoading(true);setError('');
   try{const result=await readPeriod(scope,c.signal);if(!c.signal.aborted){setData(result);if(target==='a'){setDetail(null);setUnitFilter(null);setRepeatSelection(null);}}}
   catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Could not load reports.');}
   finally{if(!c.signal.aborted)setLoading(false);}
 },[]);
 useEffect(()=>{void run(initialScope(),'a');return()=>{refs.current.a?.abort();refs.current.b?.abort();};},[run]);
 const dataA=useMemo(()=>analysisRows(a?.repairs??null,a?.breakdowns??null),[a]);
 const dataB=useMemo(()=>b?analysisRows(b.repairs,b.breakdowns):null,[b]);
 const pa=partial(a),pb=b?partial(b):null,scopeA=context(a),scopeB=context(b);
 const equipment=useMemo(()=>{const map=new Map<number,Equipment>();for(const e of [...(a?.breakdowns.filterOptions.equipment??[]),...(b?.breakdowns.filterOptions.equipment??[]),...(a?.repairs.equipment??[]),...(b?.repairs.equipment??[])])map.set(e.id,e);return [...map.values()];},[a,b]);
 const actual=useMemo(()=>(a?.breakdowns.breakdowns??[]).filter(x=>!cleared(x)),[a]);
 const breakdownRows=useMemo(()=>dataA.breakdowns.filter(x=>includeCleared||x.fields.status!=='not_breakdown'),[dataA,includeCleared]);
 const units=useMemo(()=>unitRollups(a?.repairs.repairs??[],a?.breakdowns.breakdowns??[]).map(x=>({key:'u'+x.equipmentId,fields:{...x}})),[a]);
 const repeatRows=useMemo(()=>repeats(a?.repairs.repairs??[],a?.breakdowns.breakdowns??[],repeatDays).map((r,i)=>({key:'repeat'+i,fields:{unit:r.unit,category:r.category,kind:r.kind,count:r.count,first:r.first,last:r.last},repeat:r})),[a,repeatDays]);
 const go=(next:Tab)=>{setTab(next);setDetail(null);};
 function compare(dataset:Dataset,dimension?:string){setCompareStart({dataset,dimension});setCompareEpoch(n=>n+1);go('compare');}
 function open(row:AnalysisRow){setDetail(row);setTimeout(()=>detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),0);}
 function clearB(){refs.current.b?.abort();setB(null);setLoadingB(false);setErrorB('');}
 const sourcePartial=Object.values(pa).some(Boolean),known=actual.filter(r=>r.downtimeMinutes!==null),noCost=actual.filter(r=>r.stage>=5&&r.totalCost===0);
 const card=(label:string,value:string|number,hint:string,action:()=>void)=><button className={styles.metric} type="button" onClick={action}><span>{label}</span><strong>{value}</strong><small>{hint}</small></button>;
 const isRecordTab=['repairs','breakdowns','parts','maintenance','expenses'].includes(tab);
 const dataset=isRecordTab?tab as Dataset:'repairs';
 const activeUnit=unitFilter==null?null:units.find(x=>x.fields.equipmentId===unitFilter);
 const unitRepairs=dataA.repairs.filter(r=>r.fields.equipmentId===unitFilter),unitBreakdowns=dataA.breakdowns.filter(r=>r.fields.equipmentId===unitFilter),unitMaintenance=dataA.maintenance.filter(r=>r.fields.equipmentId===unitFilter),unitExpenses=dataA.expenses.filter(r=>r.fields.equipmentId===unitFilter);
 return <main className={styles.page}><div className={styles.shell}>
 <header className={styles.header}><div><div className={styles.eyebrow}>Northern Logistics · reporting trial</div><h1>Fleet Reporting Center</h1><div className={styles.muted}>Explore, compare, drill down and export. All original reporting tools remain available.</div></div><a className={styles.primary} href="/reports">Return to classic reports</a></header>
 <nav className={styles.tabs} aria-label="Reporting sections">{tabs.map(t=><button type="button" key={t.id} className={tab===t.id?styles.active:styles.tab} aria-current={tab===t.id?'page':undefined} onClick={()=>go(t.id)}>{t.label}</button>)}</nav>
 {tab==='library'?<Library/>:<>
 <section className={styles.panel}><div className={styles.line}><h2>Report scope {tab==='compare'?'· Cohort A':''}</h2><span className={styles.muted}>Applied: {scopeA}</span></div><ScopeFields value={draft} onChange={setDraft} equipment={equipment} busy={loadingA} onRun={()=>void run(draft,'a')} label="Run report"/><p className={styles.muted}>Date ranges use the existing report record dates; individual timestamps display Eastern time. Deep search includes recorded repair notes, part numbers, breakdown closeout notes and imported VMRS descriptions where available.</p>{loadingA&&<p role="status" className={styles.muted}>Loading selected reports…</p>}{errorA&&<p role="alert" className={styles.error}>{errorA}{a?' Previous applied results remain visible.':''}</p>}</section>
 {tab==='compare'&&<section className={styles.panel}><div className={styles.line}><div><h2>Optional second cohort · B</h2><p className={styles.muted}>Compare different periods, equipment, individual units or searched issues. A minus B is the difference.</p></div><div className={styles.actions}><button className={styles.button} disabled={!a||loadingB} onClick={()=>{if(a){const next=previous(a.scope);setDraftB(next);void run(next,'b');}}}>Compare previous equal period</button>{b&&<button className={styles.button} onClick={clearB}>Remove cohort B</button>}</div></div><ScopeFields value={draftB} onChange={setDraftB} equipment={equipment} busy={loadingB} onRun={()=>void run(draftB,'b')} label="Run comparison B"/><p className={styles.muted}>{b?'Applied B: '+scopeB:'No second cohort applied yet. You can still compare groups within A.'}</p>{errorB&&<p className={styles.error}>{errorB}{b?' Previous B results remain visible.':''}</p>}</section>}
 {a&&sourcePartial&&<div className={styles.warning}>Some report results reached the existing source row limits (5,000 detail rows per report, 1,000 part summaries). Loaded-record comparisons, drill-downs and exports are labeled partial. Narrow date ranges for complete detail. Classic reports are still available.</div>}
 {!a&&!loadingA&&!errorA&&<p className={styles.muted}>Run a report to begin.</p>}
 {a&&tab==='overview'&&<>
 <section className={styles.panel}><h2>Fleet performance at a glance</h2><div className={styles.metrics}>
 {card('Repair / RO cost',money(a.repairs.summary.repairCost),'Full matching repair and imported RO summary',()=>go('repairs'))}
 {card('Repair / RO records',a.repairs.summary.repairCount,'Includes linked roadside repairs',()=>go('repairs'))}
 {card('Roadside breakdowns',actual.length,pa.breakdowns?'Loaded actual breakdown records':'Excludes Not a Breakdown',()=>go('breakdowns'))}
 {card('Roadside cost',money(sum(actual,r=>r.totalCost)),pa.breakdowns?'Loaded actual breakdown cost':'Included in linked repair costs; do not add twice',()=>go('breakdowns'))}
 {card('Known roadside downtime',known.length?hours(sum(known,r=>(r.downtimeMinutes??0)/60)):'Not recorded',known.length+' of '+actual.length+' have a recorded rolling time',()=>compare('breakdowns','unit'))}
 {card('No-cost closed breakdowns',noCost.length,'Closed actual breakdowns with $0 recorded cost',()=>compare('breakdowns','costClass'))}
 {card('Potential repeat groups',repeatRows.length,'Same-category records in '+repeatDays+' days',()=>go('repeat'))}
 {card('PM / annual events',a.repairs.summary.maintenanceEvents,'Matching recorded maintenance events',()=>go('maintenance'))}
 {card('Other recorded expenses',money(a.repairs.summary.expenseCost),'Ownership / operating expense records',()=>go('expenses'))}
 </div><p className={styles.muted}>Repair and roadside costs overlap through their linked repairs; they are not added together. Recorded downtime excludes unknown Rolling times and office closeout delay. Open-record costs are not necessarily final.</p></section>
 <section className={styles.panel}><h2>Choose a question to investigate</h2><div className={styles.two}>
 {([['What keeps failing?','Compare repair categories and failure frequency by unit or make.','repairs','category'],['Which providers cost the most?','Compare breakdown costs, arrival time, downtime and count.','breakdowns','provider'],['What are our most expensive units?','Compare repair cost by unit, fleet or model year.','repairs','unit'],['Where are our breakdowns occurring?','Compare roadside locations and failure types.','breakdowns','location'],['Which tires are failing?','Compare recorded tire position sets and repair costs.','breakdowns','tirePositions'],['How is spending changing?','Compare costs by month or across two date ranges.','repairs','month'],['Which parts are used most?','Compare part quantity, cost and repair associations.','parts','partNumber'],['Which PMs are completed?','Compare recorded maintenance events by type, unit and month.','maintenance','pmType']] as Array<[string,string,Dataset,string]>).map(([title,description,ds,dim])=><div key={title} className={styles.panel}><h3>{title}</h3><p className={styles.muted}>{description}</p><button className={styles.button} onClick={()=>compare(ds,dim)}>Analyze →</button></div>)}
 </div></section>
 <ReportTable key="overview-units" title="Highest recorded unit repair costs" rows={units} initialColumns={defaultColumns.units} initialSort="repairCost" context={scopeA} partial={pa.repairs||pa.breakdowns} onOpen={row=>{setUnitFilter(Number(row.fields.equipmentId));go('units');}} openLabel="Open unit history"/>
 </>}
 {a&&isRecordTab&&<>
 <div className={styles.line}><div className={styles.actions}><button className={styles.primary} onClick={()=>compare(dataset)}>Detailed comparisons</button><a className={styles.link} href={dataset==='breakdowns'?'/reports/breakdowns':dataset==='parts'?'/reports/parts-usage':'/reports/search'}>Original advanced filters & reports</a></div>{dataset==='breakdowns'&&<label className={styles.field}><span><input type="checkbox" checked={includeCleared} onChange={e=>setIncludeCleared(e.target.checked)}/> Include Not a Breakdown</span></label>}</div>
 <ReportTable key={dataset+'-records'} title={tabs.find(x=>x.id===tab)?.label??'Records'} rows={dataset==='breakdowns'?breakdownRows:dataA[dataset]} initialColumns={defaultColumns[dataset]} context={scopeA} partial={pa[dataset]} onOpen={open} initialSort={dataset==='parts'?'totalCost':'date'}/>
 </>}
 {a&&tab==='units'&&<>
 <ReportTable key="unit-rank" title="Equipment reliability and repair costs" rows={units} initialColumns={defaultColumns.units} context={scopeA} partial={pa.repairs||pa.breakdowns} initialSort="repairCost" onOpen={row=>{setUnitFilter(Number(row.fields.equipmentId));setDetail(null);}} openLabel="Open unit history"/>
 {activeUnit&&<><section className={styles.panel}><div className={styles.line}><h2>Unit {String(activeUnit.fields.unit)} · selected history</h2><button className={styles.button} onClick={()=>{setUnitFilter(null);setDetail(null);}}>Clear unit</button></div><p className={styles.muted}>The records below follow the applied date range and search. To see lifetime history, run an All history scope for this unit.</p><div className={styles.actions}><button className={styles.button} onClick={()=>{const next={...a.scope,unit:String(unitFilter),start:'1900-01-01',end:day(),q:''};setDraft(next);void run(next,'a');}}>Run all history for this unit</button><a className={styles.link} href="/reports">Classic lifetime ownership / cost per mile</a><a className={styles.link} href="/reports/history">Historical VMRS breakdown</a></div></section>
 <ReportTable key={'unit-r'+unitFilter} title="Unit repairs and imported ROs" rows={unitRepairs} initialColumns={defaultColumns.repairs} context={scopeA} partial={pa.repairs} onOpen={open}/>
 <ReportTable key={'unit-b'+unitFilter} title="Unit breakdown history (including cleared reports)" rows={unitBreakdowns} initialColumns={defaultColumns.breakdowns} context={scopeA} partial={pa.breakdowns} onOpen={open}/>
 <ReportTable key={'unit-m'+unitFilter} title="Unit PM & annual history" rows={unitMaintenance} initialColumns={defaultColumns.maintenance} context={scopeA} partial={pa.maintenance} onOpen={open}/>
 <ReportTable key={'unit-e'+unitFilter} title="Unit ownership and other expenses" rows={unitExpenses} initialColumns={defaultColumns.expenses} context={scopeA} partial={pa.expenses} onOpen={open}/>
 </>}
 </>}
 {a&&tab==='compare'&&<ComparisonWorkspace key={compareEpoch} dataA={dataA} dataB={dataB} partialA={pa} partialB={pb} contextA={scopeA} contextB={scopeB} initialDataset={compareStart.dataset} initialDimension={compareStart.dimension} onOpen={open}/>}
 {a&&tab==='repeat'&&<>
 <section className={styles.panel}><h2>Potential repeat failures</h2><p className={styles.muted}>Completed current shop repair records and actual roadside breakdowns are grouped separately by equipment and recorded category. This is a repeat-pattern indicator, not proof of the same defect or a technician comeback. Imported ROs and uncategorized records are excluded from this indicator.</p><label className={styles.field} style={{maxWidth:240}}>Lookback within selected dates<select className={styles.input} value={repeatDays} onChange={e=>{setRepeatDays(Number(e.target.value));setRepeatSelection(null);}}>{[7,14,30,60,90,180,365].map(n=><option key={n} value={n}>{n} days</option>)}</select></label></section>
 <ReportTable key={'repeat-'+repeatDays} title="Repeat-category patterns" rows={repeatRows} initialColumns={defaultColumns.repeat} context={scopeA} partial={pa.repairs||pa.breakdowns} initialSort="count" onOpen={row=>setRepeatSelection({kind:row.repeat.kind,ids:row.repeat.ids,label:row.repeat.unit+' · '+row.repeat.category})} openLabel="See related records"/>
 {repeatSelection&&<ReportTable key={repeatSelection.label} title={'Related records · '+repeatSelection.label} rows={(repeatSelection.kind==='Breakdown'?dataA.breakdowns:dataA.repairs).filter(r=>repeatSelection.ids.includes(r.id))} initialColumns={defaultColumns[repeatSelection.kind==='Breakdown'?'breakdowns':'repairs']} context={scopeA} partial={repeatSelection.kind==='Breakdown'?pa.breakdowns:pa.repairs} onOpen={open}/>}
 </>}
 {a&&tab==='technicians'&&<><section className={styles.panel}><h2>Technician reporting</h2><p className={styles.muted}>Use true labor productivity and same-job comparisons for performance. Assignment-based repair counts and cost are a different measure.</p><div className={styles.actions}><a className={styles.primary} href="/reports/technician-productivity">Detailed technician productivity</a><a className={styles.primary} href="/reports/technician-productivity/comparisons">Compare technicians on same jobs</a><button className={styles.button} onClick={()=>compare('repairs','technician')}>Compare assigned repair records, hours and cost</button></div></section><ComparisonWorkspace key="technician-assignment" dataA={dataA} dataB={null} partialA={pa} partialB={null} contextA={scopeA} contextB="" initialDataset="repairs" initialDimension="technician" onOpen={open}/></>}
 {detail&&<div ref={detailRef} className={styles.detail}>{['repair','historical','breakdown'].includes(detail.kind)?<RecordDetail key={detail.key} row={detail} onClose={()=>setDetail(null)}/>:<section className={styles.panel}><div className={styles.line}><h2>Record details</h2><button className={styles.button} onClick={()=>setDetail(null)}>Close details</button></div><dl>{Object.entries(detail.fields).map(([k,v])=><div key={k}><dt>{column(k).label}</dt><dd>{formatValue(v,column(k))}</dd></div>)}</dl><div className={styles.actions} style={{marginTop:12}}>{detail.kind==='part'&&<button className={styles.primary} onClick={()=>{const next={...a!.scope,q:String(detail.fields.partNumber??'')};setDraft(next);go('repairs');void run(next,'a');}}>Find repair records matching this part number</button>}{detail.kind==='maintenance'&&<><a className={styles.link} href="/pm-inspections">PM records and forms</a><a className={styles.link} href="/annual-inspections">Annual records and forms</a></>}{detail.kind==='expense'&&<a className={styles.link} href="/reports">Original ownership expense report</a>}</div></section>}</div>}
 </>}
 </div></main>;
}
