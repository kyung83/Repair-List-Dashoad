"use client";

import {useEffect,useState} from "react";
import s from "./repair-board.module.css";
import RepairCorrectionControls from "./repair-correction-controls";

type Props={repairId:string;source:string;dvirDefectId:string};
type Preview={url:string;label:string};
type ChecklistPayload={items?:{photos?:{url?:string;fileName?:string}[]}[]};

export default function RepairPhotoPreview({repairId,source,dvirDefectId}:Props){
 const[photos,setPhotos]=useState<Preview[]>([]);
 useEffect(()=>{
  let cancelled=false;
  async function load(){
   try{
    if(dvirDefectId){
     const r=await fetch(`/api/geotab-photo-ids?defectId=${encodeURIComponent(dvirDefectId)}`,{cache:"no-store"});
     const p=await r.json() as{ids?:string[]};
     if(!r.ok||!Array.isArray(p.ids))return;
     const next=p.ids.filter(Boolean).map((id,i)=>({url:`/api/geotab-media?id=${encodeURIComponent(id)}`,label:`DVIR photo ${i+1}`}));
     if(!cancelled)setPhotos(next);
     return;
    }
    if(source==="pm-repair"||source==="annual-repair"){
     const r=await fetch(`/api/maintenance-checklist?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});
     const p=await r.json() as ChecklistPayload;
     if(!r.ok)return;
     const next=(p.items??[]).flatMap(item=>(item.photos??[]).map((photo,i)=>({url:String(photo.url??""),label:photo.fileName||`Inspection photo ${i+1}`}))).filter(photo=>photo.url);
     if(!cancelled)setPhotos(next);
    }
   }catch{}
  }
  setPhotos([]);
  void load();
  return()=>{cancelled=true};
 },[repairId,source,dvirDefectId]);
 const shown=photos.slice(0,4);
 return <>
  {photos.length>0&&<div className={s.photoPreviewBlock}><div className={s.photoPreviewHead}><strong>ATTACHED PHOTOS</strong><span>{photos.length} photo{photos.length===1?"":"s"}</span></div><div className={s.photoPreviewStrip}>{shown.map((photo,i)=><a key={`${photo.url}-${i}`} href={photo.url} target="_blank" rel="noreferrer" className={s.photoThumb} title={photo.label}><img src={photo.url} alt={photo.label} loading="lazy"/></a>)}{photos.length>shown.length&&<div className={s.photoMore}>+{photos.length-shown.length}<span>more</span></div>}</div></div>}
  <RepairCorrectionControls repairId={repairId} source={source}/>
 </>;
}
