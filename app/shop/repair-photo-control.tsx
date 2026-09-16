"use client";

import {useEffect,useState} from "react";

type Photo={id:number;fileName:string;contentType:string;note:string;createdAt:string;uploadedBy:string;url:string};
type Payload={ok?:boolean;error?:string;photos?:Photo[]};
type Props={repairId:string;canWork:boolean};

function when(value:string){const parsed=Date.parse(value.includes("T")?value:value.replace(" ","T")+"Z");return Number.isFinite(parsed)?new Date(parsed).toLocaleString():value}
function refreshReview(repairId:string){window.dispatchEvent(new CustomEvent("repair-review-refresh",{detail:{repairId}}))}

export default function RepairPhotoControl({repairId,canWork}:Props){
  const[photos,setPhotos]=useState<Photo[]>([]),[note,setNote]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");

  async function load(){const response=await fetch(`/api/shop/repair-photos?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});const result=await response.json() as Payload;if(!response.ok||!result.ok)throw new Error(result.error||"Repair photos could not be loaded.");setPhotos(result.photos??[])}
  useEffect(()=>{setNote("");setMessage("");void load().catch(error=>setMessage(error instanceof Error?error.message:"Repair photos could not be loaded."))},[repairId]);

  async function upload(file:File|null){
    if(!file)return;
    setBusy(true);setMessage("");
    try{
      const form=new FormData();form.set("repairId",repairId);form.set("photo",file);form.set("note",note.trim());
      const response=await fetch("/api/shop/repair-photos",{method:"POST",body:form});
      const result=await response.json() as Payload;
      if(!response.ok||!result.ok)throw new Error(result.error||"Repair photo could not be saved.");
      setPhotos(result.photos??[]);setNote("");setMessage("Photo saved to this repair.");refreshReview(repairId);
    }catch(error){setMessage(error instanceof Error?error.message:"Repair photo could not be saved.")}
    finally{setBusy(false)}
  }

  return <section style={card}>
    <div style={head}><div><strong style={title}>📷 REPAIR PHOTOS</strong><div style={help}>Optional. Take a picture of what you found, before/after work, damage, leaks, or anything the next person should see.</div></div><span style={count}>{photos.length} photo{photos.length===1?"":"s"}</span></div>
    {canWork&&<><input value={note} onChange={event=>setNote(event.target.value.slice(0,500))} placeholder="Optional photo note — e.g. Before repair, leak found…" style={input} disabled={busy}/><label style={cameraButton}>📷 {busy?"SAVING…":"TAKE PICTURE"}<input type="file" accept="image/*" capture="environment" disabled={busy} style={{display:"none"}} onChange={event=>{const file=event.target.files?.[0]??null;void upload(file);event.currentTarget.value=""}}/></label></>}
    {message&&<div style={messageStyle}>{message}</div>}
    {photos.length>0&&<div style={grid}>{photos.map(photo=><a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" style={thumb}><img src={photo.url} alt={photo.note||photo.fileName} style={image}/><span style={caption}>{photo.note||photo.fileName}<small>{photo.uploadedBy} · {when(photo.createdAt)}</small></span></a>)}</div>}
  </section>;
}

const card={marginTop:12,border:"2px solid #b8cde0",borderRadius:13,background:"#f8fbfe",padding:14,display:"grid",gap:10} as const;
const head={display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"} as const;
const title={display:"block",fontSize:15,color:"#173a5d"} as const;
const help={marginTop:3,fontSize:11,color:"#687783",maxWidth:610} as const;
const count={whiteSpace:"nowrap" as const,borderRadius:999,padding:"6px 9px",background:"#eaf1f7",fontSize:11,fontWeight:900,color:"#45617a"} as const;
const input={width:"100%",boxSizing:"border-box" as const,padding:"11px 12px",border:"1px solid #adbdca",borderRadius:9,background:"white",fontSize:14,color:"#182331"} as const;
const cameraButton={minHeight:52,border:0,borderRadius:10,background:"#173a5d",color:"white",fontWeight:950,display:"grid",placeItems:"center",cursor:"pointer",fontSize:15} as const;
const messageStyle={padding:"8px 10px",borderRadius:8,background:"#fff8e6",border:"1px solid #f0d18e",fontSize:12,fontWeight:800,color:"#5b6670"} as const;
const grid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8} as const;
const thumb={border:"1px solid #d3dde5",borderRadius:10,overflow:"hidden",background:"white",textDecoration:"none",color:"#22384b",display:"grid"} as const;
const image={width:"100%",height:110,objectFit:"cover" as const,display:"block",background:"#edf2f6"} as const;
const caption={padding:8,fontSize:11,fontWeight:850,display:"grid",gap:3} as const;
