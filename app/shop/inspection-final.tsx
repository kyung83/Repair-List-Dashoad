"use client";
import {useEffect,useState} from "react";
import MaintenanceSignoff from "./maintenance-signoff";
import PmSheetDetails from "./pm-sheet-details";
import type {ActionData,ChecklistData} from "./maintenance-types";

type Props={repairId:string;canWork:boolean;manualMileage:string;onReady:(data:ChecklistData)=>void};

export default function InspectionFinal({repairId,canWork,manualMileage,onReady}:Props){
 const[data,setData]=useState<ChecklistData|null>(null),[actions,setActions]=useState<ActionData|null>(null),[signed,setSigned]=useState(false),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 async function load(){
  const [cr,ar]=await Promise.all([fetch(`/api/maintenance-checklist?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"}),fetch(`/api/maintenance-actions?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"})]);
  const cp=await cr.json() as ChecklistData&{error?:string};if(!cr.ok)throw new Error(cp.error||"Inspection could not be loaded.");setData(cp);
  const ap=await ar.json() as ActionData&{error?:string};if(ar.ok)setActions(ap);
 }
 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Final signoff could not be loaded."));const id=window.setInterval(()=>void load().catch(()=>undefined),2500);return()=>window.clearInterval(id)},[repairId]);
 async function finish(){
  if(!data)return;
  if(!signed){setMessage("Sign the inspection first.");return}
  if(data.eventType==='pm'&&data.mileageSource==='Manual'&&!manualMileage.trim()){setMessage("Enter the current mileage above before finishing this PM.");return}
  setBusy(true);setMessage("");
  try{
   const body:Record<string,unknown>={action:'markReady',repairId};if(data.eventType==='pm'&&data.mileageSource==='Manual')body.mileage=manualMileage;
   const r=await fetch('/api/maintenance-checklist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),p=await r.json() as ChecklistData&{ok?:boolean;error?:string};
   if(!r.ok||!p.ok)throw new Error(p.error||"Inspection could not be finished.");
   setData(p);onReady(p);setMessage("Signed inspection finished and locked. Print the truck copy below.");
  }catch(e){setMessage(e instanceof Error?e.message:"Inspection could not be finished.")}finally{setBusy(false)}
 }
 if(!data||!data.started)return null;
 if(data.status==='ready'||data.status==='completed')return <div className="easy-finish" style={{marginTop:18,border:"2px solid #1f5d46"}}><strong>Signed inspection sheet is ready.</strong><p>{message||"Print the truck copy now. If the work order is still open, complete it after the truck is ready to leave."}</p><a className="easy-button orange" href={`/annual-inspections/print?repairId=${encodeURIComponent(repairId)}`}>{data.eventType==='annual'?"Print Truck Copy":"Print PM Sheet"}</a></div>;
 const pending=data.pendingCount??data.items.filter(i=>i.result==='pending').length,failed=data.failedCount??data.items.filter(i=>i.result==='fail').length,required=actions?.requiredRepairs.length??0;
 if(data.status!=='in_progress'||pending>0||failed>0||required>0)return null;
 return <section style={{marginTop:18}}><div className="easy-finish" style={{border:"2px solid #1f5d46"}}><p className="easy-eyebrow">FINAL STEP</p><strong style={{display:'block',fontSize:20,marginTop:5}}>1. Review the sheet. 2. Sign. 3. Finish & lock the inspection.</strong><p style={{margin:'6px 0 0'}}>The signature now comes before Finish Inspection. You will not be sent to a separate clearance/permission step afterward.</p></div>{data.eventType==='pm'&&<PmSheetDetails repairId={repairId} canWork={canWork} locked={signed}/>}<MaintenanceSignoff repairId={repairId} eventType={data.eventType} canWork={canWork} onSignedChange={setSigned}/>{message&&<div className="easy-notice" style={{marginTop:10}}>{message}</div>}<div className="easy-finish" style={{marginTop:12,border:'2px solid #1f5d46'}}>{signed?<><strong>Signature saved.</strong><p>Finish & lock the inspection. This does not stop the PM/Annual labor timer.</p><button className="easy-button primary" disabled={busy||!canWork} onClick={()=>void finish()}>{busy?'Finishing...':'Finish & Lock Signed Inspection'}</button></>:<><strong>Technician signature required.</strong><p>Sign directly above. The finish button appears after the signature is saved.</p></>}</div></section>
}
