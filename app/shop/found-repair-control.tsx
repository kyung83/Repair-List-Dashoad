"use client";

import { useState } from "react";

type Props={repairId:string;unit:string;onAdded:()=>Promise<void>|void};
type Result={ok?:boolean;error?:string;repairId?:string;unit?:string;issue?:string;foundRepair?:boolean};

export default function FoundRepairControl({repairId,unit,onAdded}:Props){
  const[open,setOpen]=useState(false),[issue,setIssue]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");

  async function save(){
    const value=issue.trim();
    if(!value){setMessage("Enter what you found.");return}
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop/found-repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repairId,issue:value})});
      const result=await response.json() as Result;
      if(!response.ok||!result.ok)throw new Error(result.error||"Repair could not be added.");
      setIssue("");setOpen(false);setMessage(`Added to Unit ${result.unit||unit}. Your current labor timer is still running.`);
      await onAdded();
    }catch(error){setMessage(error instanceof Error?error.message:"Repair could not be added.")}
    finally{setBusy(false)}
  }

  return <div style={{display:"grid",gap:8}}>
    <button disabled={busy} onClick={()=>{setOpen(current=>!current);setMessage("")}} style={foundButton}>FOUND SOMETHING ELSE<span>Add another Open repair to this unit · keep working</span></button>
    {open&&<div style={formBox}><input value={issue} onChange={event=>setIssue(event.target.value)} placeholder="What else did you find?" style={inputStyle} autoFocus disabled={busy}/><div style={{display:"flex",gap:7}}><button type="button" onClick={()=>{setOpen(false);setIssue("");setMessage("")}} style={cancelButton} disabled={busy}>Cancel</button><button type="button" onClick={()=>void save()} style={saveButton} disabled={busy}>{busy?"Adding…":"Add repair"}</button></div></div>}
    {message&&<div style={{fontSize:12,fontWeight:800,color:message.startsWith("Added")?"#176440":"#8a3a2e"}}>{message}</div>}
  </div>;
}

const foundButton={border:0,borderRadius:12,padding:16,fontWeight:900,fontSize:16,cursor:"pointer",textAlign:"left" as const,background:"#dfeaf5",color:"#173a5d"} as const;
const formBox={padding:10,border:"1px solid #a8bfd6",borderRadius:10,background:"#f4f8fc",display:"grid",gap:8} as const;
const inputStyle={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #b8c8d7",borderRadius:8,background:"white",color:"#182331"} as const;
const cancelButton={border:"1px solid #c3cdd6",borderRadius:8,padding:"8px 10px",background:"white",fontWeight:800,cursor:"pointer"} as const;
const saveButton={border:0,borderRadius:8,padding:"8px 10px",background:"#173a5d",color:"white",fontWeight:900,cursor:"pointer"} as const;
