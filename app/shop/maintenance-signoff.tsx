"use client";

import {useEffect,useRef,useState,type PointerEvent as RPointerEvent} from "react";

type Point={x:number;y:number};
type Data={signed:boolean;signer:string;signedAt:string;strokes:Point[][];status:string;error?:string};
type Props={repairId:string;eventType:"pm"|"annual";canWork:boolean;onSignedChange:(value:boolean)=>void};

function stamp(value:string){if(!value)return"";const d=new Date(value.includes("T")?value:value.replace(" ","T")+"Z");return Number.isNaN(d.getTime())?value:d.toLocaleString()}
function pos(event:RPointerEvent<SVGSVGElement>){const r=event.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-r.left)/Math.max(1,r.width))),y:Math.max(0,Math.min(1,(event.clientY-r.top)/Math.max(1,r.height)))}}
function Ink({strokes}:{strokes:Point[][]}){return <>{strokes.map((stroke,i)=><polyline key={i} points={stroke.map(p=>`${p.x*600},${p.y*160}`).join(" ")} fill="none" stroke="#17283a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>)}</>}

export default function MaintenanceSignoff({repairId,eventType,canWork,onSignedChange}:Props){
 const[data,setData]=useState<Data|null>(null),[draft,setDraft]=useState<Point[][]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);const active=useRef<number|null>(null);
 async function load(){const r=await fetch(`/api/maintenance-signature?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"}),p=await r.json() as Data;if(!r.ok)throw new Error(p.error||"Signoff could not be loaded.");setData(p);onSignedChange(Boolean(p.signed))}
 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Signoff could not be loaded."))},[repairId]);
 function down(e:RPointerEvent<SVGSVGElement>){if(!canWork||data?.signed||busy)return;e.currentTarget.setPointerCapture(e.pointerId);const p=pos(e);setDraft(v=>{active.current=v.length;return[...v,[p]]})}
 function move(e:RPointerEvent<SVGSVGElement>){const i=active.current;if(i===null)return;const p=pos(e);setDraft(v=>v.map((s,n)=>n===i?[...s,p]:s))}
 function up(){active.current=null}
 async function post(action:"sign"|"clear") {setBusy(true);setMessage("");try{const r=await fetch("/api/maintenance-signature",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,repairId,strokes:draft})}),p=await r.json() as Data&{ok?:boolean};if(!r.ok||!p.ok)throw new Error(p.error||"Signoff failed.");setData(p);setDraft([]);onSignedChange(Boolean(p.signed));setMessage(action==="sign"?"Signature saved.":"Signature cleared.")}catch(e){setMessage(e instanceof Error?e.message:"Signoff failed.")}finally{setBusy(false)}}
 return <section className="easy-card easy-card-body" style={{marginTop:18,border:"2px solid #1f5d46"}}><p className="easy-eyebrow">FINAL TECHNICIAN SIGNOFF</p><h4 style={{margin:"6px 0",fontSize:21}}>{eventType==="annual"?"Annual Inspection":"Performance PM"} - Technician Signature</h4><p className="easy-section-copy">Sign after every inspection item and required repair is finished.</p>{message&&<div className="easy-notice">{message}</div>}<div style={{marginTop:12,border:"2px solid #9eabb5",borderRadius:10,overflow:"hidden"}}><svg viewBox="0 0 600 160" preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{width:"100%",height:150,display:"block",touchAction:"none",background:"white"}}><line x1="20" y1="135" x2="580" y2="135" stroke="#d5dce2"/><Ink strokes={data?.signed?data.strokes:draft}/></svg></div>{data?.signed?<div className="easy-actions" style={{marginTop:10,justifyContent:"space-between"}}><span><b style={{color:"#176440"}}>SIGNED - {data.signer||"Technician"}</b><small style={{display:"block"}}>{stamp(data.signedAt)}</small></span>{canWork&&data.status==="in_progress"&&<button className="easy-button" disabled={busy} onClick={()=>void post("clear")}>Clear & Re-sign</button>}</div>:<div className="easy-actions" style={{marginTop:10}}><button className="easy-button" disabled={busy||!draft.length} onClick={()=>setDraft([])}>Clear</button><button className="easy-button primary" disabled={busy||!canWork||!draft.length} onClick={()=>void post("sign")}>Sign Inspection</button></div>}</section>
}
