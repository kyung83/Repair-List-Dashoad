"use client";

import { useEffect, useState } from "react";

type Props={repairId:string;unit:string;onAdded:()=>Promise<void>|void};
type TirePosition={code:string;label:string};
type TireAxle={axle:number;label:string;positions:TirePosition[]};
type TireStatus={required:boolean;equipmentType:string;axles:TireAxle[];positions:string[]};
type Result={
  ok?:boolean;error?:string;repairId?:string;unit?:string;issue?:string;foundRepair?:boolean;
  tirePositionsSaved?:boolean;tirePosition?:TireStatus;
};

export default function FoundRepairControl({repairId,unit,onAdded}:Props){
  const[open,setOpen]=useState(false),[issue,setIssue]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const[tire,setTire]=useState<TireStatus|null>(null),[selectedPositions,setSelectedPositions]=useState<string[]>([]),[tireMessage,setTireMessage]=useState("");

  useEffect(()=>{
    let cancelled=false;
    async function loadRepairDetails(){
      try{
        const response=await fetch(`/api/shop/found-repair?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});
        const result=await response.json() as Result;
        if(!response.ok||!result.ok)throw new Error(result.error||"Repair details could not be loaded.");
        if(cancelled)return;
        const next=result.tirePosition??null;
        setTire(next);
        setSelectedPositions(next?.positions??[]);
        setTireMessage("");
      }catch(error){
        if(!cancelled)setTireMessage(error instanceof Error?error.message:"Repair details could not be loaded.");
      }
    }
    void loadRepairDetails();
    return()=>{cancelled=true};
  },[repairId]);

  function togglePosition(code:string){
    setSelectedPositions(current=>current.includes(code)?current.filter(item=>item!==code):[...current,code]);
    setTireMessage("");
  }

  async function saveTirePositions(){
    if(!selectedPositions.length){setTireMessage("Choose at least one tire position.");return}
    setBusy(true);setTireMessage("");
    try{
      const response=await fetch("/api/shop/found-repair",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"saveTirePositions",repairId,positions:selectedPositions}),
      });
      const result=await response.json() as Result;
      if(!response.ok||!result.ok)throw new Error(result.error||"Tire positions could not be saved.");
      if(result.tirePosition){setTire(result.tirePosition);setSelectedPositions(result.tirePosition.positions)}
      setTireMessage(`Saved ${result.tirePosition?.positions.join(", ")||selectedPositions.join(", ")}. You can now mark the repair REPAIRED.`);
    }catch(error){setTireMessage(error instanceof Error?error.message:"Tire positions could not be saved.")}
    finally{setBusy(false)}
  }

  async function save(){
    const value=issue.trim();
    if(!value){setMessage("Enter what you found.");return}
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop/found-repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"foundRepair",repairId,issue:value})});
      const result=await response.json() as Result;
      if(!response.ok||!result.ok)throw new Error(result.error||"Repair could not be added.");
      setIssue("");setOpen(false);setMessage(`Added to Unit ${result.unit||unit}. Your current labor timer is still running.`);
      await onAdded();
    }catch(error){setMessage(error instanceof Error?error.message:"Repair could not be added.")}
    finally{setBusy(false)}
  }

  return <>
    {tire?.required&&<div style={tireBox}>
      <div><strong style={{fontSize:17,color:"#7c2d12"}}>TIRE POSITION REQUIRED</strong><div style={tireHelp}>Tap every tire repaired or replaced, then save the positions before pressing REPAIRED.</div><div style={legend}>L = left · R = right · I = inner · O = outer</div></div>
      <div style={{display:"grid",gap:10}}>{tire.axles.map(axle=><div key={axle.axle} style={axleBox}><strong style={{fontSize:13}}>{axle.label}</strong><div style={positionGrid}>{axle.positions.map(position=>{const selected=selectedPositions.includes(position.code);return <button key={position.code} type="button" aria-pressed={selected} disabled={busy} onClick={()=>togglePosition(position.code)} style={{...positionButton,...(selected?selectedPositionButton:{})}}><span style={{fontSize:16,fontWeight:950}}>{position.code}</span><span style={{fontSize:10,fontWeight:750}}>{position.label}</span></button>})}</div></div>)}</div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}><button type="button" disabled={busy||!selectedPositions.length} onClick={()=>void saveTirePositions()} style={saveTireButton}>{busy?"Saving…":"SAVE TIRE POSITION"}</button><strong style={{fontSize:12,color:selectedPositions.length?"#384956":"#9a3b2a"}}>{selectedPositions.length?`Selected: ${selectedPositions.join(", ")}`:"No position selected"}</strong></div>
      {tireMessage&&<div style={{fontSize:12,fontWeight:850,color:tireMessage.startsWith("Saved")?"#176440":"#8a3a2e"}}>{tireMessage}</div>}
    </div>}

    <div style={{display:"grid",gap:8}}>
      <button disabled={busy} onClick={()=>{setOpen(current=>!current);setMessage("")}} style={foundButton}>FOUND SOMETHING ELSE<span style={foundHelp}>Add another Open repair to this unit · keep working</span></button>
      {open&&<div style={formBox}><input value={issue} onChange={event=>setIssue(event.target.value)} placeholder="What else did you find?" style={inputStyle} autoFocus disabled={busy}/><div style={{display:"flex",gap:7}}><button type="button" onClick={()=>{setOpen(false);setIssue("");setMessage("")}} style={cancelButton} disabled={busy}>Cancel</button><button type="button" onClick={()=>void save()} style={saveButton} disabled={busy}>{busy?"Adding…":"Add repair"}</button></div></div>}
      {message&&<div style={{fontSize:12,fontWeight:800,color:message.startsWith("Added")?"#176440":"#8a3a2e"}}>{message}</div>}
      {!tire?.required&&tireMessage&&<div style={{fontSize:12,fontWeight:800,color:"#8a3a2e"}}>{tireMessage}</div>}
    </div>
  </>;
}

const tireBox={gridColumn:"1 / -1",border:"3px solid #f47b20",borderRadius:13,padding:15,background:"#fff7ef",display:"grid",gap:12} as const;
const tireHelp={marginTop:4,fontSize:13,color:"#5f4b3c",fontWeight:750} as const;
const legend={marginTop:5,fontSize:11,color:"#806b5d"} as const;
const axleBox={border:"1px solid #e9c6a8",borderRadius:10,padding:10,background:"white",display:"grid",gap:7} as const;
const positionGrid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:7} as const;
const positionButton={border:"2px solid #c9d1d8",borderRadius:9,padding:"10px 8px",background:"#f7f9fa",color:"#243441",display:"grid",gap:2,textAlign:"center" as const,cursor:"pointer"} as const;
const selectedPositionButton={borderColor:"#16784c",background:"#eaf7ef",color:"#0d5c39",boxShadow:"inset 0 0 0 1px #16784c"} as const;
const saveTireButton={border:0,borderRadius:9,padding:"11px 15px",background:"#16784c",color:"white",fontWeight:950,cursor:"pointer"} as const;
const foundButton={border:0,borderRadius:12,padding:16,fontWeight:900,fontSize:16,cursor:"pointer",textAlign:"left" as const,background:"#dfeaf5",color:"#173a5d"} as const;
const foundHelp={display:"block",marginTop:3,fontSize:11,fontWeight:700,opacity:.82} as const;
const formBox={padding:10,border:"1px solid #a8bfd6",borderRadius:10,background:"#f4f8fc",display:"grid",gap:8} as const;
const inputStyle={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #b8c8d7",borderRadius:8,background:"white",color:"#182331"} as const;
const cancelButton={border:"1px solid #c3cdd6",borderRadius:8,padding:"8px 10px",background:"white",fontWeight:800,cursor:"pointer"} as const;
const saveButton={border:0,borderRadius:8,padding:"8px 10px",background:"#173a5d",color:"white",fontWeight:900,cursor:"pointer"} as const;
