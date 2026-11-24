import type {AnalysisRow,Cell} from './report-center-model';
export type PrintColumn={key:string;label:string;format?:'money'|'number'|'hours'|'percent'};
export type PrintRow={key:string;fields:Record<string,Cell>};
export type PrintTable={title:string;rows:readonly PrintRow[];columns:readonly PrintColumn[]};
export type PrintCohort={label:string;records:readonly AnalysisRow[];partial?:boolean};
export type PrintSource={title:string;context:string;tables:readonly PrintTable[];cohorts:readonly PrintCohort[];partial?:boolean};
export type DetailRow=Record<string,unknown>;
export type PrintDetail={repair?:DetailRow;breakdown?:DetailRow|null;historical?:DetailRow;receipt?:DetailRow|null;notes?:DetailRow[];parts?:DetailRow[];labor?:DetailRow[];events?:DetailRow[];photos?:DetailRow[];receiptPages?:DetailRow[];lines?:DetailRow[];outsideDocuments?:DetailRow[];truncated?:boolean};
export const PRINT_SECTIONS=[
 ['summary','Executive summary'],['costs','Cost breakdown — parts, labor and outside'],['descriptions','Individual repair descriptions'],['notes','Technician notes and diagnosis'],['parts','Individual parts used'],['labor','Labor entries'],['timeline','Breakdown timelines'],['providers','Service provider information'],['repeat','Repeat failure analysis'],['charts','Comparison charts'],['photos','Repair photos'],['invoices','Receipts and invoices'],
] as const;
export type Section=typeof PRINT_SECTIONS[number][0];
export const ALL_SECTIONS=PRINT_SECTIONS.map(([key])=>key);
export const DETAIL_SECTIONS:Section[]=['descriptions','notes','parts','labor','timeline','providers','photos','invoices'];
export const VOLUME_SIZE=100;
export type DetailJob={key:string;row:AnalysisRow;cohorts:string[]};
export type DetailResult={job:DetailJob;detail?:PrintDetail;error?:string};
export type PrintOptions={sections:readonly Section[];repeatDays:number;volume:number;orientation:'portrait'|'landscape'};
const isRecord=(row:PrintRow):row is AnalysisRow=>['repair','historical','breakdown','maintenance','part','expense'].includes(String((row as AnalysisRow).kind))&&Number.isFinite((row as AnalysisRow).id);
export function analysisRecords(rows:readonly PrintRow[]):AnalysisRow[]{return rows.filter(isRecord);}
export function detailJobs(cohorts:readonly PrintCohort[]):DetailJob[]{
 const linked=new Map<number,AnalysisRow>();
 for(const cohort of cohorts)for(const r of cohort.records)if(r.kind==='breakdown'&&typeof r.fields.repairId==='number')linked.set(r.fields.repairId,r);
 const jobs=new Map<string,DetailJob>();
 for(const cohort of cohorts)for(const original of cohort.records){
  if(!['repair','historical','breakdown'].includes(original.kind)||original.id<=0)continue;
  // The linked roadside repair and breakdown share work notes/parts/labor. Print one dossier.
  const row=original.kind==='repair'&&linked.has(original.id)?linked.get(original.id)!:original;
  const key=row.kind+':'+row.id;
  const entry=jobs.get(key)??{key,row,cohorts:[]};
  if(!entry.cohorts.includes(cohort.label))entry.cohorts.push(cohort.label);
  jobs.set(key,entry);
 }
 return [...jobs.values()];
}
export const number=(v:unknown)=>v==null||v===''||!Number.isFinite(Number(v))?'Not recorded':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
export const money=(v:unknown)=>v==null||v===''||!Number.isFinite(Number(v))?'Not recorded':Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
export const plain=(v:unknown)=>v==null||v===''?'Not recorded':String(v);
export const escapeHtml=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function eastern(v:unknown){
 if(!v)return'Not recorded';
 const raw=String(v),ms=Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)?raw.replace(' ','T')+'Z':raw);
 return Number.isFinite(ms)?new Date(ms).toLocaleString('en-US',{timeZone:'America/Detroit'}):raw;
}
export function value(v:unknown,c:PrintColumn){return c.format==='money'?money(v):c.format==='hours'?v==null?'Not recorded':number(v)+' hr':c.format==='percent'?v==null?'Not recorded':number(v)+'%':c.format==='number'?number(v):plain(v);}
const h=escapeHtml;
const paragraph=(v:unknown)=>'<p class="note">'+h(plain(v))+'</p>';
const sub=(title:string,body:string)=>'<section class="sub"><h3>'+h(title)+'</h3>'+body+'</section>';
const section=(title:string,body:string)=>'<section class="section"><h2>'+h(title)+'</h2>'+body+'</section>';
const fields=(pairs:readonly [string,unknown][])=>'<dl>'+pairs.map(([k,v])=>'<div><dt>'+h(k)+'</dt><dd>'+h(plain(v))+'</dd></div>').join('')+'</dl>';
function table(headers:readonly string[],rows:readonly (readonly unknown[])[]){
 if(!rows.length)return'<p class="muted">No matching recorded entries.</p>';
 return '<table><thead><tr>'+headers.map(v=>'<th>'+h(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+h(plain(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
type DCol=[string,string,((v:unknown)=>string)?];
function detailTable(rows:DetailRow[]|undefined,cols:DCol[]){return table(cols.map(x=>x[1]),(rows??[]).map(r=>cols.map(([key,,format])=>format?format(r[key]):plain(r[key]))));}
export function renderTable(t:PrintTable){
 // Wide comparison exports are split into readable column bands; repeat the group/key column.
 const first=t.columns[0];if(!first)return sub(t.title,paragraph('No columns selected.'));
 const rest=t.columns.slice(1);const bands:PrintColumn[][]=[];
 if(rest.length<=7)bands.push([...t.columns]);else for(let i=0;i<rest.length;i+=7)bands.push([first,...rest.slice(i,i+7)]);
 return section(t.title+' · '+t.rows.length.toLocaleString()+' matching rows',bands.map((cols,i)=>(bands.length>1?'<p class="muted">Column group '+(i+1)+' of '+bands.length+'</p>':'')+table(cols.map(c=>c.label),t.rows.map(r=>cols.map(c=>value(r.fields[c.key],c))))).join(''));
}
function bucket(r:AnalysisRow){return r.key.startsWith('hl')?'Historical VMRS lines':r.kind==='repair'?'Current repairs':r.kind==='historical'?'Imported repair orders':r.kind==='breakdown'?'Roadside breakdown records':r.kind==='maintenance'?'PM / annual events':r.kind==='part'?'Part usage summaries':'Ownership / other expenses';}
function grouped<T>(rows:readonly T[],label:(r:T)=>string){const m=new Map<string,T[]>();for(const r of rows){const k=label(r),a=m.get(k)??[];a.push(r);m.set(k,a);}return [...m.entries()];}
function sumField(rows:readonly AnalysisRow[],key:string):number|null{const values=rows.map(r=>r.fields[key]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));return values.length?values.reduce((a,b)=>a+b,0):null;}
const actualBreakdowns=(rows:readonly AnalysisRow[])=>rows.filter(r=>r.kind==='breakdown'&&String(r.fields.status).toLowerCase()!=='not_breakdown');
function knownAverage(rows:readonly AnalysisRow[],key:string){const n=rows.map(r=>r.fields[key]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));return n.length?number(n.reduce((a,b)=>a+b,0)/n.length)+' hr':'Not recorded';}
function costRows(c:PrintCohort){return grouped(c.records,bucket).filter(([,rows])=>rows.some(r=>typeof r.fields.totalCost==='number')).map(([k,rows])=>[k,number(rows.length),money(sumField(rows,'partsCost')),money(sumField(rows,'laborCost')),money(sumField(rows,'outsideCost')),money(sumField(rows,'totalCost'))]);}
export function repeatPatterns(rows:readonly AnalysisRow[],days:number){
 const eligible=rows.filter(r=>r.kind==='breakdown'?String(r.fields.status).toLowerCase()!=='not_breakdown':r.kind==='repair'&&String(r.fields.source).toLowerCase()!=='roadside-breakdown'&&!['shop-duty','cutover-archive'].includes(String(r.fields.source).toLowerCase())&&['complete','completed','closed'].includes(String(r.fields.status).toLowerCase())).filter(r=>typeof r.fields.equipmentId==='number'&&!!String(r.fields.category??'').trim()&&!['uncategorized','historical ro','not recorded'].includes(String(r.fields.category).trim().toLowerCase())&&Number.isFinite(Date.parse(String(r.fields.date))));
 return grouped(eligible,r=>JSON.stringify([r.kind,r.fields.equipmentId,String(r.fields.category).toLowerCase().trim()])).flatMap(([,items])=>{
  const sorted=items.slice().sort((a,b)=>String(a.fields.date).localeCompare(String(b.fields.date))||a.id-b.id);let left=0,best:AnalysisRow[]=[];
  for(let i=0;i<sorted.length;i++){while(left<i&&Date.parse(String(sorted[i].fields.date))-Date.parse(String(sorted[left].fields.date))>days*86400000)left++;if(i-left+1>=best.length)best=sorted.slice(left,i+1);}
  return best.length<2?[]:[{unit:plain(best[0].fields.unit),category:plain(best[0].fields.category),kind:best[0].kind,count:best.length,first:plain(best[0].fields.date),last:plain(best[best.length-1].fields.date),ids:best.map(r=>r.id).join(', ')}];
 }).sort((a,b)=>b.count-a.count||a.unit.localeCompare(b.unit));
}
function providerSummary(rows:readonly AnalysisRow[]){
 return grouped(actualBreakdowns(rows),r=>String(r.fields.provider??'').trim()||'Not assigned').sort((a,b)=>(sumField(b[1],'totalCost')??0)-(sumField(a[1],'totalCost')??0)).map(([label,rs])=>[label,rs.length,money(sumField(rs,'totalCost')),knownAverage(rs,'arrivalHours'),knownAverage(rs,'downtimeHours'),rs.filter(r=>r.fields.downtimeHours==null).length]);
}
function barChart(title:string,entries:{label:string;amount:number;format?:'money'|'hours'}[]){
 if(!entries.length)return'';
 const max=Math.max(1,...entries.map(x=>Math.abs(x.amount)));
 return sub(title,'<div class="chart">'+entries.map(x=>'<div class="barrow"><span>'+h(x.label)+'</span><div class="track"><div class="bar" style="width:'+Math.max(0,Math.min(100,Math.abs(x.amount)/max*100)).toFixed(2)+'%"></div></div><strong>'+h(x.format==='money'?money(x.amount):x.format==='hours'?number(x.amount)+' hr':number(x.amount))+'</strong></div>').join('')+'</div>');
}
function summary(source:PrintSource,options:PrintOptions){
 const has=(s:Section)=>options.sections.includes(s);
 let html='';
 if(has('summary'))html+=section('Executive summary',source.cohorts.map(c=>{
  const actual=actualBreakdowns(c.records),known=actual.filter(r=>r.fields.downtimeHours!=null);
  return sub(c.label,fields([['Selected records',number(c.records.length)],['Current repair records',number(c.records.filter(r=>r.kind==='repair').length)],['Imported repair orders',number(c.records.filter(r=>r.kind==='historical'&&!r.key.startsWith('hl')).length)],['Historical VMRS lines',number(c.records.filter(r=>r.key.startsWith('hl')).length)],['Actual breakdown records',number(actual.length)],['Known roadside downtime',known.length?number(sumField(known,'downtimeHours'))+' hr':'Not recorded'],['Unknown rolling times',number(actual.length-known.length)],['Maintenance events',number(c.records.filter(r=>r.kind==='maintenance').length)]])+(c.partial?'<p class="warning">Partial source data for this cohort.</p>':''));
 }).join('')+'<p class="muted">Totals describe selected loaded records, not necessarily all work in the date range. Costs for open repairs may not be final. Missing times are unknown, never zero.</p>');
 if(has('costs'))html+=section('Cost breakdown',source.cohorts.map(c=>sub(c.label,table(['Record group','Rows','Parts','Labor','Outside','Recorded cost'],costRows(c)))).join('')+'<p class="muted">Do not add record groups together: roadside repairs can also be included in current repair costs, historical VMRS line costs overlap imported RO totals, and part summaries overlap parts charged to repairs.</p>');
 if(has('providers'))html+=section('Service provider analysis',source.cohorts.map(c=>sub(c.label,table(['Provider','Breakdowns','Recorded cost','Avg. known arrival','Avg. known downtime','Unknown rolling times'],providerSummary(c.records)))).join('')+'<p class="muted">Cleared Not a Breakdown records are excluded. Averages use recorded times only.</p>');
 if(has('repeat'))html+=section('Potential repeat failures · '+options.repeatDays+' day window',source.cohorts.map(c=>sub(c.label,table(['Unit','Category','Type','Count','First','Last','Record IDs'],repeatPatterns(c.records,options.repeatDays).map(x=>[x.unit,x.category,x.kind,x.count,x.first,x.last,x.ids])))).join('')+'<p class="muted">Same-category patterns within the selected date range, not proof of the same defect or a technician comeback. Imported ROs and duplicate linked roadside repair records are excluded.</p>');
 if(has('charts')){
  const parts=source.cohorts.map(c=>{
   const r=c.records.filter(x=>x.kind==='repair'||x.kind==='historical'&&!x.key.startsWith('hl')),b=actualBreakdowns(c.records);
   const ranked=(rs:AnalysisRow[],k:string)=>grouped(rs,x=>String(x.fields[k]??'').trim()||'Not recorded').map(([label,items])=>({label,amount:sumField(items,'totalCost')??0,format:'money' as const})).sort((a,b)=>b.amount-a.amount).slice(0,10);
   return sub(c.label,barChart('Top repair categories by recorded cost',ranked(r,'category'))+barChart('Top units by repair / RO cost',ranked(r,'unit'))+barChart('Top breakdown providers by cost',ranked(b,'provider')));
  }).join('');
  const anyRepairs=source.cohorts.some(c=>c.records.some(r=>r.kind==='repair'||r.kind==='historical'&&!r.key.startsWith('hl')));
  const anyBreakdowns=source.cohorts.some(c=>c.records.some(r=>r.kind==='breakdown'));
  const compare=source.cohorts.length>1?(anyRepairs?barChart('Selected repair / RO cost by cohort',source.cohorts.map(c=>({label:c.label,amount:sumField(c.records.filter(r=>r.kind==='repair'||r.kind==='historical'&&!r.key.startsWith('hl')),'totalCost')??0,format:'money'}))):'')+(anyBreakdowns?barChart('Actual breakdown count by cohort',source.cohorts.map(c=>({label:c.label,amount:actualBreakdowns(c.records).length}))):''):'';
  // For arbitrary comparison tables, render the actual selected metric columns instead of inventing a cohort total.
  const comparisons=source.tables.filter(t=>t.columns.some(c=>c.key.startsWith('a_'))).map(t=>{
   const metric=t.columns.find(c=>c.key.startsWith('a_'));if(!metric)return'';
   const b=t.columns.find(c=>c.key==='b_'+metric.key.slice(2));
   const top=t.rows.filter(r=>typeof r.fields[metric.key]==='number').slice().sort((a,b)=>Number(b.fields[metric.key])-Number(a.fields[metric.key])).slice(0,8);
   return barChart(t.title+' · '+metric.label,top.flatMap(r=>[...(typeof r.fields[metric.key]==='number'?[{label:plain(r.fields[t.columns[0]?.key])+ (b?' · A':''),amount:Number(r.fields[metric.key]),format:metric.format==='money'?'money' as const:metric.format==='hours'?'hours' as const:undefined}]:[]),...(b&&typeof r.fields[b.key]==='number'?[{label:plain(r.fields[t.columns[0]?.key])+' · B',amount:Number(r.fields[b.key]),format:b.format==='money'?'money' as const:b.format==='hours'?'hours' as const:undefined}]:[])]));
  }).join('');
  html+=section('Comparison charts',compare+comparisons+parts+'<p class="muted">Charts use the selected records and show leading groups, with exact values. Full comparison tables are included separately.</p>');
 }
 return html;
}
function safeMediaUrl(raw:unknown,origin:string){
 if(typeof raw!=='string'||!raw.startsWith('/api/'))return'';
 try{const u=new URL(raw,origin);if(u.origin!==origin)return'';if(u.pathname.startsWith('/api/photos/')||u.pathname==='/api/breakdowns/receipts/file'||u.pathname==='/api/outside-work'&&/^\d+$/.test(u.searchParams.get('fileId')||''))return u.href;}catch{}return'';
}
function media(rows:readonly DetailRow[],origin:string){
 if(!rows.length)return'<p class="muted">No saved supporting files returned.</p>';
 return '<div class="media">'+rows.map(r=>{
  const link=safeMediaUrl(r.url,origin),name=plain(r.file_name??r.original_file_name),type=String(r.content_type??'').toLowerCase(),inline=/^image\/(jpeg|png|webp|gif|bmp)$/.test(type);
  return '<figure><figcaption>'+h(name)+(r.note?' — '+h(r.note):'')+'</figcaption>'+(link?(inline?'<img src="'+h(link)+'" alt="'+h(name)+'" loading="eager" decoding="async">':'<p class="warning">Original file requires separate viewing / printing.</p>')+'<a href="'+h(link)+'" target="_blank" rel="noopener noreferrer">Open original file</a>':'<p class="warning">Original file link unavailable.</p>')+'</figure>';
 }).join('')+'</div>';
}
function rollingSource(v:unknown){return v==='office_geotab'?'Office confirmed using Geotab':v==='office_manual'?'Office-entered time':v==='driver'?'Driver confirmed':'Recorded source not specified';}
function recordedDowntime(b:DetailRow){if(b.status==='not_breakdown'||!b.rolling_at||!b.created_at)return'Not recorded';const parse=(v:unknown)=>Date.parse(String(v).includes('T')?String(v):String(v).replace(' ','T')+'Z');const mins=(parse(b.rolling_at)-parse(b.created_at))/60000;return Number.isFinite(mins)&&mins>=0?number(mins/60)+' hr':'Not recorded';}
function renderDetail(result:DetailResult,options:PrintOptions,origin:string){
 const {job,detail:d,error}=result,r=job.row,has=(s:Section)=>options.sections.includes(s);
 let body='<div class="recordhead"><h2>'+h(plain(r.fields.unit))+' · '+h(r.kind==='breakdown'?'Breakdown':r.kind==='historical'?'Historical RO':'Repair')+' #'+r.id+'</h2><p>'+h(job.cohorts.join(' / '))+' · '+h(plain(r.fields.date))+' · '+h(plain(r.fields.status))+'</p></div>';
 if(error||!d)return '<article class="record">'+body+'<p class="warning">Details could not be loaded: '+h(error||'No response')+'. Reopen this volume to retry.</p></article>';
 if(d.truncated)body+='<p class="warning">Some individual record sections exceeded the source detail limit. This dossier is partial.</p>';
 const repair=d.repair,b=d.breakdown,hist=d.historical;
 if(hist){
  body+=fields([['RO number',hist.ro_number],['Date',hist.ro_date],['Location',hist.location],['Status',hist.source_status]]);
  if(has('costs'))body+=fields([['Parts',money(hist.parts_cost)],['Labor',money(hist.labor_cost)],['Outside',money(hist.sublet_cost)],['RO total',money(hist.total_cost)]]);
  if(has('descriptions')||has('parts')||has('labor')||has('notes'))body+=sub('Imported VMRS repair lines',detailTable(d.lines,[['major_category','Major category'],['system_code','System'],['assembly_code','Assembly'],['vmrs_description','Description'],['labor_hours','Hours',number],['parts_cost','Parts',money],['labor_cost','Labor',money],['sublet_cost','Outside',money],['total_cost','Total',money]])+'<p class="muted">Historical import: individual part numbers, technician notes, photos and receipts may not have been imported.</p>');
 }else if(repair){
  body+=fields([['Repair title',repair.title],['Source',repair.source],['Status',repair.status],['Assigned technician',repair.assigned_technician],['Opened (Eastern)',eastern(repair.opened_at)],['Completed (Eastern)',eastern(repair.completed_at)],['Location',repair.location],['Geotab defect',repair.geotab_defect_id]]);
  if(has('costs'))body+=sub('Recorded cost breakdown',fields([['Parts',money(r.fields.partsCost)],['Labor',money(r.fields.laborCost)],['Outside',money(r.fields.outsideCost)],['Report total',money(r.fields.totalCost)],['Labor hours recorded on repair',number(repair.labor_hours)]]));
  if(has('descriptions'))body+=b?sub('Original driver complaint',paragraph(b.description)):sub('Recorded repair description',paragraph(repair.description));
  if(has('notes'))body+=(b?sub('Office diagnosis',paragraph(b.repair_needed?repair.description:null))+sub('Closeout / work performed',paragraph(b.closeout_notes||d.receipt?.reviewed_service_summary)):'')+sub('Technician notes',detailTable(d.notes,[['created_at','Eastern time',eastern],['technician','Technician'],['detail','Note']]))+sub('Review notes',paragraph(repair.review_note));
  if(has('parts'))body+=sub('Individual parts used',detailTable(d.parts,[['part_number','Part'],['description','Description'],['source_type','Stock / one-time'],['quantity','Qty',number],['recorded_unit_cost','Recorded unit cost',money],['reporting_line_cost','Report line cost',money]])+'<p class="muted">Missing original unit prices may use the current part price in existing report totals.</p>');
  if(has('labor'))body+=sub('Individual labor entries',detailTable(d.labor,[['technician','Technician'],['labor_date','Date'],['hours','Hours',number],['rate','Rate',money],['amount','Entry amount',money],['notes','Notes'],['started_at','Start (Eastern)',eastern],['ended_at','End (Eastern)',eastern]])+'<p class="muted">Entry-level amounts may differ from corrected repair-level report totals.</p>');
  if(b&&has('timeline'))body+=sub('Roadside timeline · Eastern time',fields([['Breakdown ID',b.id],['Driver',b.driver_name],['Original category',b.repair_category],['Office repair category',b.repair_needed],['Tire positions',r.fields.tirePositions],['Recorded equipment downtime',recordedDowntime(b)],['Rolling source',b.rolling_at?rollingSource(b.rolling_confirmation_source):'Not recorded']])+table(['Event','Recorded time'],[['Reported',eastern(b.created_at)],['Claimed',eastern(b.claimed_at)],['Arrival',eastern(b.tech_arrived_at||b.on_location_at)],['Repair finished',eastern(b.repair_finished_at)],['Rolling',eastern(b.rolling_at)],['Office closeout',eastern(repair.completed_at)]])+detailTable(d.events,[['created_at','Eastern time',eastern],['action','Event'],['detail','Correction details']])+'<p class="muted">Office closeout is not actual equipment downtime.</p>');
  if(has('providers')&&(b||d.outsideDocuments?.length))body+=sub('Service provider',fields([['Roadside provider',b?.service_provider],['Breakdown location',b?[b.city,b.state].filter(Boolean).join(', '):null],['Outside-work vendor(s)',d.outsideDocuments?.map(x=>x.vendor_name).filter(Boolean).join(', ')]]));
  if(has('photos'))body+=sub('Repair and driver photos',media(d.photos??[],origin));
  if(has('invoices')){
   const receipt=d.receipt;
   body+=sub('Receipts and invoices',(b?fields([['Reviewed vendor',receipt?.reviewed_vendor||b.service_provider],['Invoice number',receipt?.reviewed_invoice_number||b.closeout_invoice_number],['Invoice date',receipt?.reviewed_invoice_date||b.closeout_invoice_date],['Reviewed amount',money(receipt?.reviewed_total_amount)],['Receipt review status',receipt?.review_status]])+paragraph(receipt?.reviewed_service_summary||b.closeout_notes):'')+media(d.receiptPages??[],origin)+(d.outsideDocuments??[]).map(x=>fields([['Vendor',x.vendor_name],['Invoice number',x.invoice_number],['Invoice date',x.invoice_date],['Invoice amount',money(x.total_amount)],['Mileage',number(x.mileage)],['Service performed',x.service_summary]])+media([x],origin)).join('')+'<p class="muted">Saved image receipts print inline. PDF and unsupported original files are listed with links and must be printed separately; an invoice is not counted as an additional repair charge.</p>');
  }
 }
 return '<article class="record">'+body+'</article>';
}
export function buildPrintDocument(source:PrintSource,options:PrintOptions,results:readonly DetailResult[],origin:string){
 const partial=Boolean(source.partial||source.cohorts.some(c=>c.partial)||results.some(x=>x.error||x.detail?.truncated||!x.detail));
 const allJobs=detailJobs(source.cohorts),volumes=options.sections.some(s=>DETAIL_SECTIONS.includes(s))?Math.max(1,Math.ceil(allJobs.length/VOLUME_SIZE)):1;
 const detailed=options.sections.some(s=>DETAIL_SECTIONS.includes(s));
 const start=(options.volume-1)*VOLUME_SIZE;
 const volumeLabel=detailed&&allJobs.length?'Detailed records '+(start+1)+'–'+Math.min(allJobs.length,start+VOLUME_SIZE)+' of '+allJobs.length+' · Volume '+options.volume+' of '+volumes:'Summary and selected tables';
 const heading='<header><div class="brand">NORTHERN LOGISTICS</div><div class="eyebrow">FLEET MAINTENANCE · REPORTING CENTER</div><h1>'+h(source.title)+'</h1><p>'+h(source.context)+'</p><p class="muted">'+h(volumeLabel)+' · Generated '+h(eastern(new Date().toISOString()))+' Eastern</p></header>';
 const warning=partial?'<p class="warning"><strong>PARTIAL REPORT:</strong> Source limits, unavailable detail, or incomplete records affect this volume. Review the warnings and narrow the scope or retry missing records.</p>':'';
 const overview=options.volume===1?summary(source,options)+source.tables.map(renderTable).join(''):'<p class="muted">Executive summary, comparison charts and all selected table rows are in volume 1. This volume continues the detailed supporting records.</p>';
 const details=results.length?section('Detailed supporting records',results.map(r=>renderDetail(r,options,origin)).join('')):detailed&&options.volume===1?'<p class="muted">No linked repair, historical RO or breakdown dossiers in this selected report. The available selected table rows are included above.</p>':'';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+h(source.title)+'</title><style>@page{size:letter '+(options.orientation==='landscape'?'landscape':'portrait')+';margin:.45in}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#20282a;margin:0;background:#edf0ef}main{max-width:1120px;margin:20px auto;padding:28px;background:#fff}header{border-bottom:3px solid #263e37;margin-bottom:15px;padding-bottom:12px}h1{font-size:24px;margin:6px 0;color:#192f29}h2{font-size:16px;margin:10px 0 8px;color:#203b32}h3{font-size:12px;margin:9px 0 6px}p{line-height:1.4;margin:6px 0;overflow-wrap:anywhere}.brand{font-weight:900;font-size:18px;letter-spacing:.08em}.eyebrow,.muted{color:#52645f;font-size:10px}.section{margin:14px 0;padding-top:6px;border-top:1px solid #bac6c0}.sub{margin:9px 0}.record{border-top:2px solid #263e37;margin-top:16px;padding-top:8px}.recordhead{background:#eef3f0;padding:7px;break-after:avoid}.recordhead h2{margin:0}.note{white-space:pre-wrap}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:5px 12px;margin:9px 0}dt{font-size:9px;color:#52645f}dd{font-weight:600;margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:auto;margin:7px 0 10px}th,td{text-align:left;border:1px solid #d2dcd6;padding:5px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#e6eeea;font-weight:750}thead{display:table-header-group}tr{break-inside:avoid}h2,h3{break-after:avoid}.warning{border:1px solid #b38a39;background:#fff7e5;padding:7px;color:#694c0b}.media{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.media figure{margin:0;border:1px solid #d2dcd6;padding:6px;break-inside:avoid}.media img{display:block;width:100%;max-height:6.5in;object-fit:contain}.media figcaption{font-weight:bold;margin-bottom:5px;overflow-wrap:anywhere}.media a{display:block;font-size:10px;color:#215b4e;overflow-wrap:anywhere}.chart{margin:8px 0}.barrow{display:grid;grid-template-columns:minmax(90px,2fr) 3fr minmax(70px,1fr);gap:6px;align-items:center;margin:4px 0;break-inside:avoid}.track{height:10px;background:#e6eeea;border:1px solid #d2dcd6}.bar{height:100%;background:#356d5c;print-color-adjust:exact;-webkit-print-color-adjust:exact}.toolbar{position:sticky;top:0;display:flex;gap:10px;align-items:center;justify-content:space-between;background:#1e3a30;color:white;padding:12px 20px}.toolbar button{padding:9px 14px;cursor:pointer;font-weight:bold}.footer{border-top:1px solid #bac6c0;margin-top:15px;padding-top:7px;font-size:9px;color:#52645f}@media print{body{background:white}main{max-width:none;margin:0;padding:0}.toolbar{display:none!important}h1,h2,h3{break-after:avoid}th,.recordhead,.track,.bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}.media img{max-height:5in}.warning{background:white}}</style></head><body><div class="toolbar"><span id="print-status" role="status">Preparing attachments…</span><div><button id="print-action" disabled>Print / Save PDF</button> <button id="close-action">Close preview</button></div></div><main>'+heading+warning+overview+details+'<footer class="footer">Northern Logistics Maintenance · Selected report data · Original supporting files remain subject to account access.</footer></main></body></html>';
}
