"use client";

import { useEffect, useState, type CSSProperties } from "react";
import CameraOutsideWorkIntake from "./camera-intake";
import FileOutsideWorkIntake from "./file-intake";

type IntakeMode = "camera" | "file";

export default function OutsideWorkIntakeSwitcher(){
  const[mode,setMode]=useState<IntakeMode>("camera");

  useEffect(()=>{
    const source=new URLSearchParams(window.location.search).get("source");
    if(source==="file")setMode("file");
  },[]);

  function choose(next:IntakeMode){
    setMode(next);
    const url=new URL(window.location.href);
    if(next==="file")url.searchParams.set("source","file");
    else url.searchParams.delete("source");
    window.history.replaceState(null,"",`${url.pathname}${url.search}${url.hash}`);
  }

  return <>
    <div style={chooserBar}>
      <div style={chooserShell}>
        <div>
          <strong style={chooserTitle}>How are you bringing in this outside-work invoice?</strong>
          <div style={chooserCopy}>Scan paper with the camera, or use a PDF/photo you already have.</div>
        </div>
        <div style={chooserActions}>
          <button type="button" onClick={()=>choose("camera")} style={mode==="camera"?activeButton:inactiveButton}>SCAN INVOICE</button>
          <button type="button" onClick={()=>choose("file")} style={mode==="file"?activeButton:inactiveButton}>USE EXISTING FILE</button>
        </div>
      </div>
    </div>
    {mode==="file"?<FileOutsideWorkIntake/>:<CameraOutsideWorkIntake/>}
  </>;
}

const chooserBar:CSSProperties={background:'#e9eef2',borderBottom:'1px solid #cfd8df',padding:'12px clamp(16px,4vw,46px)'};
const chooserShell:CSSProperties={maxWidth:1500,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap'};
const chooserTitle:CSSProperties={display:'block',fontSize:13,color:'#172536'};
const chooserCopy:CSSProperties={fontSize:11,color:'#667581',marginTop:2};
const chooserActions:CSSProperties={display:'flex',gap:8,flexWrap:'wrap'};
const baseButton:CSSProperties={borderRadius:8,padding:'9px 12px',fontWeight:900,fontSize:11,cursor:'pointer'};
const activeButton:CSSProperties={...baseButton,border:'1px solid #0d1b2b',background:'#0d1b2b',color:'white'};
const inactiveButton:CSSProperties={...baseButton,border:'1px solid #b9c5ce',background:'white',color:'#17324a'};
