'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ALL_SECTIONS,PRINT_SECTIONS,DETAIL_SECTIONS,VOLUME_SIZE,detailJobs,buildPrintDocument,escapeHtml,type PrintSource,type PrintOptions,type Section,type DetailResult,type PrintDetail} from '@/lib/report-center-print';
import styles from './report-center.module.css';

type Props={source:PrintSource;label?:string;repeatDays?:number};
const presets:Record<string,Section[]>={full:[...ALL_SECTIONS],summary:['summary','costs','providers','repeat','charts'],detailed:ALL_SECTIONS.filter(s=>s!=='photos'&&s!=='invoices')};
export default function FullPrintButton({source,label='Full Detailed Report',repeatDays:defaultDays=30}:Props){
 const [open,setOpen]=useState(false),[preset,setPreset]=useState('full'),[sections,setSections]=useState<Section[]>([...ALL_SECTIONS]),[repeatDays,setRepeatDays]=useState(defaultDays),[orientation,setOrientation]=useState<'portrait'|'landscape'>('landscape'),[volume,setVolume]=useState(1),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
 const abortRef=useRef<AbortController|null>(null),popupRef=useRef<Window|null>(null);
 const jobs=useMemo(()=>detailJobs(source.cohorts),[source.cohorts]);
 const detailed=sections.some(s=>DETAIL_SECTIONS.includes(s)),volumes=detailed?Math.max(1,Math.ceil(jobs.length/VOLUME_SIZE)):1,selectedVolume=Math.min(volume,volumes);
 const partial=Boolean(source.partial||source.cohorts.some(c=>c.partial));
 useEffect(()=>()=>{abortRef.current?.abort();},[]);
 function configure(){setError('');setProgress('');setOpen(true);setVolume(1);}
 function stop(){abortRef.current?.abort();popupRef.current?.close();setBusy(false);setProgress('Preparation cancelled.');}
 async function generate(){
  if(busy||!sections.length)return;
  setError('');setProgress('');
  const popup=window.open('','_blank');
  if(!popup){setError('Your browser blocked the print preview. Allow pop-ups for this site and try again.');return;}
  popupRef.current=popup;
  popup.opener=null;
  popup.document.open();popup.document.write('<!doctype html><html><head><title>Preparing Northern Logistics report</title></head><body style="font:16px Arial;padding:30px"><h1>Preparing full detailed report</h1><p id="loading">Loading selected records…</p><p>Return to the reporting center to cancel preparation.</p></body></html>');popup.document.close();
  const controller=new AbortController();abortRef.current=controller;setBusy(true);
  const options:PrintOptions={sections:[...sections],repeatDays,volume:selectedVolume,orientation};
  const selected=detailed?jobs.slice((selectedVolume-1)*VOLUME_SIZE,selectedVolume*VOLUME_SIZE):[];
  const results:DetailResult[]=new Array(selected.length);let next=0,done=0;
  const update=(message:string)=>{if(controller.signal.aborted)return;setProgress(message);if(!popup.closed){const node=popup.document.getElementById('loading');if(node)node.textContent=message;}};
  try{
   update('Loading '+selected.length+' detailed record(s)…');
   async function worker(){
    while(!controller.signal.aborted&&!popup.closed){
     const i=next++;if(i>=selected.length)return;
     const job=selected[i];
     try{
      const response=await fetch('/api/reports/center/detail?kind='+encodeURIComponent(job.row.kind)+'&id='+job.row.id,{cache:'no-store',signal:controller.signal});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Record request failed.');
      results[i]={job,detail:payload as PrintDetail};
     }catch(e){if(controller.signal.aborted)return;results[i]={job,error:e instanceof Error?e.message:'Record request failed.'};}
     done++;update('Loaded '+done+' of '+selected.length+' detailed records…');
    }
   }
   await Promise.all(Array.from({length:Math.min(4,selected.length)},()=>worker()));
   if(controller.signal.aborted)return;
   if(popup.closed){setProgress('Print preview closed.');return;}
   const failures=results.filter(r=>r.error||r.detail?.truncated).length;
   popup.document.open();popup.document.write(buildPrintDocument(source,options,results,window.location.origin));popup.document.close();
   const doc=popup.document,printButton=doc.getElementById('print-action') as HTMLButtonElement|null,status=doc.getElementById('print-status');
   doc.getElementById('close-action')?.addEventListener('click',()=>popup.close());
   printButton?.addEventListener('click',()=>{popup.focus();popup.print();});
   const images=Array.from(doc.querySelectorAll('img'));
   let timedOut=false;
   const wait=Promise.all(images.map(img=>new Promise<void>(resolve=>{if(img.complete){resolve();return;}img.addEventListener('load',()=>resolve(),{once:true});img.addEventListener('error',()=>resolve(),{once:true});})));
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([wait,new Promise<void>(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},30000);}),new Promise<void>(resolve=>controller.signal.addEventListener('abort',()=>resolve(),{once:true}))]);}finally{if(timer)clearTimeout(timer);}
   if(controller.signal.aborted||popup.closed)return;
   const bad=images.filter(img=>!img.complete||!img.naturalWidth);
   for(const img of bad){const p=doc.createElement('p');p.className='warning';p.textContent='Image unavailable for inline printing. Open the original supporting file below.';img.replaceWith(p);}
   if(bad.length){const p=doc.createElement('p');p.className='warning';p.textContent=bad.length+' supporting image(s) could not be rendered in this preview. Use their original-file links. '+(timedOut?'Image loading timed out.':'');doc.querySelector('main header')?.after(p);}
   if(printButton)printButton.disabled=false;
   if(status)status.textContent=(failures||bad.length||partial?'Review partial-data / attachment warnings. ':'')+'Ready — Print / Save PDF';
   setProgress('Volume '+selectedVolume+' of '+volumes+' prepared.'+(failures?' '+failures+' record(s) incomplete; see preview warnings.':'')+(bad.length?' '+bad.length+' image(s) unavailable.':''));
   popup.focus();
  }catch(e){
   if(!controller.signal.aborted){
    const message=e instanceof Error?e.message:'Unable to prepare report.';
    setError(message);if(!popup.closed){popup.document.open();popup.document.write('<!doctype html><title>Report error</title><p>'+escapeHtml(message)+'</p>');popup.document.close();}
   }
  }finally{if(abortRef.current===controller){abortRef.current=null;setBusy(false);}}
 }
 return <><button className={styles.primary} type="button" onClick={configure} disabled={busy||!source.tables.some(t=>t.rows.length)&&!source.cohorts.some(c=>c.records.length)}>{label}</button>
 {open&&<div className={styles.printOverlay} role="dialog" aria-modal="true" aria-label="Generate full detailed report">
  <section className={styles.printDialog}><div className={styles.line}><div><div className={styles.eyebrow}>Northern Logistics · Print / Save PDF</div><h2 style={{margin:'4px 0'}}>Generate report</h2><strong>{source.title}</strong><p className={styles.muted}>{source.context}</p></div><button className={styles.button} type="button" disabled={busy} onClick={()=>setOpen(false)}>Close</button></div>
   {partial&&<p className={styles.warning}>This scope has reached a source row limit. The report will be clearly marked partial. Narrow your date range to obtain complete source detail.</p>}
   <div className={styles.fields}>
    <label className={styles.field}>Report type<select className={styles.input} value={preset} disabled={busy} onChange={e=>{const v=e.target.value;setPreset(v);if(presets[v])setSections([...presets[v]]);setVolume(1);}}><option value="full">Full detailed report + supporting files</option><option value="summary">Management summary</option><option value="detailed">Detailed report (no attachments)</option><option value="custom">Custom report</option></select></label>
    <label className={styles.field}>Page orientation<select className={styles.input} value={orientation} disabled={busy} onChange={e=>setOrientation(e.target.value as PrintOptions['orientation'])}><option value="landscape">Landscape · US Letter</option><option value="portrait">Portrait · US Letter</option></select></label>
    <label className={styles.field}>Repeat failure window<select className={styles.input} value={repeatDays} disabled={busy} onChange={e=>setRepeatDays(Number(e.target.value))}>{[7,14,30,60,90,180,365].map(n=><option key={n} value={n}>{n} days</option>)}</select></label>
   </div>
   <div className={styles.section}><div className={styles.line}><h3>Include in report</h3><button className={styles.button} disabled={busy} onClick={()=>{setPreset('full');setSections([...ALL_SECTIONS]);setVolume(1);}}>Select everything</button></div><div className={styles.checkGrid}>{PRINT_SECTIONS.map(([key,label])=><label key={key}><input type="checkbox" disabled={busy} checked={sections.includes(key)} onChange={e=>{setPreset('custom');setSections(old=>e.target.checked?[...old,key]:old.filter(s=>s!==key));setVolume(1);}}/>{label}</label>)}</div></div>
   <div className={styles.section}><h3>Report coverage</h3><p>{source.tables.reduce((n,t)=>n+t.rows.length,0).toLocaleString()} selected table rows, {jobs.length.toLocaleString()} unique supporting repair / RO / breakdown dossiers.</p><p className={styles.muted}>All matching loaded rows are included, regardless of screen pagination. Linked roadside repairs share one dossier; cost categories are kept separate to prevent double-counting. A/B comparisons keep their cohort labels.</p>
   {detailed&&volumes>1&&<><p className={styles.warning}>This report has {volumes} volumes of up to {VOLUME_SIZE} detailed dossiers. Volume 1 includes the complete selected summary tables and charts; subsequent volumes contain the remaining dossiers. Generate every volume for the complete loaded report.</p><label className={styles.field}>Volume<select className={styles.input} disabled={busy} value={selectedVolume} onChange={e=>setVolume(Number(e.target.value))}>{Array.from({length:volumes},(_,i)=><option key={i} value={i+1}>Volume {i+1} — records {i*VOLUME_SIZE+1}–{Math.min(jobs.length,(i+1)*VOLUME_SIZE)}</option>)}</select></label></>}
   {sections.some(s=>s==='photos'||s==='invoices')&&<p className={styles.muted}>Printable image attachments appear inline. Original PDF invoices and unsupported image formats are linked for separate printing. Missing files and incomplete detail are identified in the preview.</p>}</div>
   {error&&<p className={styles.error} role="alert">{error}</p>}{progress&&<p role="status" className={styles.muted}>{progress}</p>}
   <div className={styles.actions}>{busy?<button className={styles.button} onClick={stop}>Cancel preparation</button>:<><button className={styles.button} onClick={()=>setOpen(false)}>Cancel</button><button className={styles.primary} disabled={!sections.length} onClick={()=>void generate()}>Generate print preview{volumes>1?' · volume '+selectedVolume:''}</button></>}</div>
  </section></div>}
 </>;
}
