"use client";
import {ChangeEvent,useEffect,useState} from "react";
import {HistoricalPackage,parseNorlowHistoryXls} from "@/lib/ro-history-xls-client";

type S=any;
type ImportRo=HistoricalPackage['ros'][number];
type ImportSource={meta:{importKey:string;sourceName:string;sourceSha256:string;rawSourceRows:number;rawSourceRos:number;historyStart:string;historyEnd:string};ros:ImportRo[]};
const panel={background:"white",border:"1px solid #dce2e7",borderRadius:14,padding:18} as const;
const button={padding:"10px 14px",border:0,borderRadius:8,background:"#0d1b2b",color:"white",fontWeight:850,cursor:"pointer"} as const;
const money=(v:number)=>Number(v||0).toLocaleString(undefined,{style:"currency",currency:"USD"});
const num=(v:number)=>Number(v||0).toLocaleString();

async function post(body:any){const r=await fetch('/api/admin/history-import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),p=await r.json();if(!r.ok)throw new Error(p.error||'Import failed');return p}
function expandLegacy(p:any):ImportRo[]{const m=new Map<string,ImportRo>();for(const r of p.rows){const [unit,roNumber,roDate,li,si,ci,h,l,parts,sub,total]=r,c=p.cats[ci];let x=m.get(roNumber);if(!x)x={unit:String(unit),roNumber:String(roNumber),roDate:String(roDate),location:p.locs[li]||'',status:p.sts[si]||'',lines:[]};x.lines.push({systemCode:c[0],assemblyCode:c[1],description:c[2],laborHours:h,laborCost:l,partsCost:parts,subletCost:sub,totalCost:total});m.set(roNumber,x)}return [...m.values()].sort((a,b)=>a.roDate.localeCompare(b.roDate)||a.roNumber.localeCompare(b.roNumber))}
async function readSource(file:File,importKey:string):Promise<ImportSource>{
  if(/\.xls$/i.test(file.name))return parseNorlowHistoryXls(file,importKey);
  if(!/\.json$/i.test(file.name))throw new Error('Select the Norlow RO History .xls export or a prepared .json recovery package.');
  const p=JSON.parse(await file.text());
  if(p?.v===1&&p?.meta?.importKey===importKey&&Array.isArray(p.rows)&&Array.isArray(p.cats)&&Array.isArray(p.locs)&&Array.isArray(p.sts)){
    const ros=expandLegacy(p);if(ros.length!==Number(p.meta.rawSourceRos))throw new Error('Prepared JSON repair-order count is inconsistent.');
    return {meta:{importKey,sourceName:String(p.meta.sourceName||file.name),sourceSha256:String(p.meta.sourceSha256||''),rawSourceRows:Number(p.meta.rawSourceRows),rawSourceRos:Number(p.meta.rawSourceRos),historyStart:String(p.meta.historyStart||''),historyEnd:String(p.meta.historyEnd||'')},ros};
  }
  if(p?.v===2&&p?.meta?.importKey===importKey&&Array.isArray(p.ros))return p as ImportSource;
  throw new Error('This is not a recognized Norlow RO-history package.');
}

export default function Page(){
  const [d,setD]=useState<S|null>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[progress,setProgress]=useState({done:0,total:0});
  async function load(){const r=await fetch('/api/admin/history-import',{cache:'no-store'}),p=await r.json();if(!r.ok)throw new Error(p.error||'Could not load import status');setD(p)}
  useEffect(()=>{void load().catch(e=>setMsg(e.message))},[]);
  async function choose(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];e.target.value='';if(!file||!d)return;setBusy(true);setProgress({done:0,total:0});
    try{
      setPhase('Reading Excel locally');setMsg(`Reading ${file.name} locally in this browser…`);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      const source=await readSource(file,d.importKey);
      if(source.meta.importKey!==d.importKey)throw new Error('This history export belongs to a different import stream.');
      if(!source.meta.sourceSha256||!/^[0-9a-f]{64}$/i.test(source.meta.sourceSha256))throw new Error('The source checksum could not be verified.');
      if(!source.ros.length||source.ros.length!==source.meta.rawSourceRos)throw new Error('The repair-order count in this source is inconsistent.');
      const id={importKey:d.importKey,sourceName:source.meta.sourceName,sourceSha256:source.meta.sourceSha256};
      const reprocess=Boolean(d.status);
      setMsg(`Validated ${num(source.meta.rawSourceRos)} ROs / ${num(source.meta.rawSourceRows)} source rows (${source.meta.historyStart} to ${source.meta.historyEnd}). Starting cumulative import…`);
      setPhase(reprocess?'Refreshing existing history':'Importing history');
      const s=await post({action:'start',...id,sourceLineCount:source.meta.rawSourceRows,sourceRoCount:source.meta.rawSourceRos,reprocess});
      if(s.alreadyCompleted){setMsg('This exact cumulative history snapshot is already imported.');await load();return}
      setProgress({done:0,total:source.ros.length});
      for(let i=0;i<source.ros.length;i+=250){
        await post({action:'batch',...id,ros:source.ros.slice(i,i+250)});
        const done=Math.min(i+250,source.ros.length);setProgress({done,total:source.ros.length});setMsg(`${reprocess?'Refreshing':'Importing'}… ${num(done)} of ${num(source.ros.length)} ROs.`);
      }
      setPhase('Verifying production totals');await post({action:'finish',...id});setMsg('Cumulative historical repair import completed and production totals verified.');await load();
    }catch(x){setMsg(x instanceof Error?x.message:'Import failed')}finally{setBusy(false);setPhase('')}
  }
  const pct=progress.total?Math.round(progress.done/progress.total*100):0;
  return <main style={{minHeight:'100vh',background:'#f3f5f7',color:'#172033',padding:'34px 34px 110px'}}>
    <header><p style={{margin:0,color:'#6d28d9',fontWeight:900}}>ADMIN · DATA IMPORT</p><h1>Historical Repair Orders</h1><p>Upload the full cumulative Norlow Excel export each time. Existing ROs are refreshed, new ROs are added, existing active equipment is matched, and no equipment is created.</p></header>
    {msg&&<div style={{...panel,marginTop:14,borderColor:'#f2c66d'}}><b>{phase||'Status'}</b><div style={{marginTop:5}}>{msg}</div></div>}
    <section style={{...panel,marginTop:18}}>
      <h2 style={{marginTop:0}}>Cumulative Excel import</h2>
      <p><b>Use the same “RO History Account Export” Excel report you provided originally, with the date range kept cumulative so it contains the prior history plus all new ROs.</b></p>
      <p>The .xls file is parsed and SHA-256 checked locally in your browser. Only normalized batches of 250 repair orders are sent to the dashboard API, so the entire Excel file is not uploaded to Cloudflare in one request.</p>
      <p style={{color:'#64748b'}}>Scope stays consistent with the original approved import: standard <b>WO…</b> repair orders are included, exact duplicate source rows are removed, duplicate repair categories inside an RO are combined, and non-final statuses are audited rather than counted as completed history.</p>
      <label style={{...button,display:'inline-block',opacity:busy?.6:1}}>Select Excel history export<input type="file" accept=".xls,.json,application/vnd.ms-excel,application/json" onChange={choose} disabled={busy} style={{display:'none'}}/></label> <a href="/reports/history" style={{...button,background:'#6d28d9',textDecoration:'none'}}>RO History Reports</a>
      <div style={{marginTop:8,fontSize:12,color:'#64748b'}}>Prepared JSON remains supported as a recovery/testing path.</div>
      {progress.total>0&&<div style={{marginTop:14}}><div style={{height:10,background:'#e8edf2',borderRadius:99}}><div style={{height:'100%',width:`${pct}%`,background:'#6d28d9',borderRadius:99}}/></div><b>{pct}% · {num(progress.done)} / {num(progress.total)} ROs</b></div>}
    </section>
    <section style={{...panel,marginTop:18}}><h2 style={{marginTop:0}}>Production status</h2>{d?.status?<div>
      {[['Status',d.status.status],['Last source',d.status.sourceName],['Source ROs',num(d.status.sourceRoCount)],['Source rows',num(d.status.sourceLineCount)],['Matched ROs',num(d.status.importedRoCount)],['Detail lines',num(d.status.importedLineCount)],['Current units matched',num(d.status.matchedUnitCount)],['Unmatched ROs',num(d.status.unmatchedRoCount)],['Unmatched units',num(d.status.unmatchedUnitCount)],['Non-final skipped',num(d.status.skippedNonfinalRoCount)]].map(([a,b])=><div key={a} style={{display:'flex',justifyContent:'space-between',gap:20,maxWidth:650,padding:'6px 0',borderBottom:'1px solid #eee'}}><span>{a}</span><b style={{textAlign:'right'}}>{b}</b></div>)}
    </div>:<p>No history has been imported yet.</p>}</section>
    {d?.unmatchedUnits?.length>0&&<section style={{...panel,marginTop:18}}><h2 style={{marginTop:0}}>Unmatched source units</h2><p>These were audited but were not added to Equipment.</p><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th>Unit</th><th>ROs</th><th>Lines</th><th>Cost</th></tr></thead><tbody>{d.unmatchedUnits.map((x:any)=><tr key={x.unit}><td>{x.unit}</td><td>{num(x.roCount)}</td><td>{num(x.lineCount)}</td><td>{money(x.totalCost)}</td></tr>)}</tbody></table></div></section>}
  </main>
}
