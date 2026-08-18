"use client";

import { useEffect, useRef, useState } from "react";

type Props={repairId:string;unit:string;onAdded:()=>Promise<void>|void};
type Result={ok?:boolean;error?:string;repairId?:string;unit?:string;issue?:string;foundRepair?:boolean;noteSaved?:boolean};
type RepairNote={id:number;detail:string;technician:string;createdAt:string};
type NotesPayload={ok?:boolean;error?:string;notes?:RepairNote[]};
type SpeechResultLike={length:number;isFinal:boolean;[index:number]:{transcript:string}|undefined};
type SpeechEventLike={results:ArrayLike<SpeechResultLike>};
type RecognitionLike={lang:string;continuous:boolean;interimResults:boolean;start:()=>void;stop:()=>void;onresult:((event:SpeechEventLike)=>void)|null;onerror:((event:{error?:string})=>void)|null;onend:(()=>void)|null};
type RecognitionCtor=new()=>RecognitionLike;

function noteTime(value:string){
  const parsed=Date.parse(value.includes("T")?value:value.replace(" ","T")+"Z");
  return Number.isFinite(parsed)?new Date(parsed).toLocaleString():value;
}

export default function FoundRepairControl({repairId,unit,onAdded}:Props){
  const[open,setOpen]=useState(false),[issue,setIssue]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const[note,setNote]=useState(""),[notes,setNotes]=useState<RepairNote[]>([]),[noteBusy,setNoteBusy]=useState(false),[noteMessage,setNoteMessage]=useState(""),[listening,setListening]=useState(false);
  const recognitionRef=useRef<RecognitionLike|null>(null);

  async function loadNotes(){
    try{
      const response=await fetch(`/api/shop/found-repair?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});
      const result=await response.json() as NotesPayload;
      if(!response.ok||!result.ok)throw new Error(result.error||"Repair notes could not be loaded.");
      setNotes(result.notes??[]);
    }catch(error){setNoteMessage(error instanceof Error?error.message:"Repair notes could not be loaded.")}
  }

  useEffect(()=>{
    setNote("");setNoteMessage("");void loadNotes();
    return()=>{try{recognitionRef.current?.stop()}catch{}recognitionRef.current=null};
  },[repairId]);

  async function saveNote(){
    const value=note.trim();
    if(!value){setNoteMessage("Type or dictate a repair note first.");return}
    setNoteBusy(true);setNoteMessage("");
    try{
      const response=await fetch("/api/shop/found-repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"note",repairId,note:value})});
      const result=await response.json() as Result;
      if(!response.ok||!result.ok)throw new Error(result.error||"Repair note could not be saved.");
      setNote("");setNoteMessage("Note saved to this repair.");await loadNotes();
    }catch(error){setNoteMessage(error instanceof Error?error.message:"Repair note could not be saved.")}
    finally{setNoteBusy(false)}
  }

  function talk(){
    if(listening){try{recognitionRef.current?.stop()}catch{}return}
    const speechWindow=window as typeof window&{SpeechRecognition?:RecognitionCtor;webkitSpeechRecognition?:RecognitionCtor};
    const Recognition=speechWindow.SpeechRecognition??speechWindow.webkitSpeechRecognition;
    if(!Recognition){setNoteMessage("Voice input is not available in this browser. Use the keyboard microphone or type the note.");return}
    try{
      const recognition=new Recognition();
      recognition.lang="en-US";recognition.continuous=false;recognition.interimResults=false;
      recognition.onresult=event=>{const result=event.results[event.results.length-1],spoken=result?.[0]?.transcript?.trim()??"";if(spoken)setNote(current=>[current.trim(),spoken].filter(Boolean).join(" ").slice(0,2000))};
      recognition.onerror=event=>{setNoteMessage(event.error?`Voice input stopped: ${event.error}.`:"Voice input stopped.");setListening(false)};
      recognition.onend=()=>{setListening(false);recognitionRef.current=null};
      recognitionRef.current=recognition;setNoteMessage("Listening… speak your repair note.");setListening(true);recognition.start();
    }catch{setListening(false);recognitionRef.current=null;setNoteMessage("Voice input could not start. You can still type the note.")}
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

  return <div style={{display:"grid",gap:10,gridColumn:"1 / -1"}}>
    <section style={notePanel} aria-label="Repair notes">
      <div><strong style={{display:"block",fontSize:15,color:"#173a5d"}}>REPAIR NOTES</strong><span style={{display:"block",marginTop:2,fontSize:11,color:"#687783"}}>Type it or tap TALK and say what you found, checked, changed, or still need.</span></div>
      <textarea value={note} onChange={event=>setNote(event.target.value.slice(0,2000))} placeholder="Example: Air line rubbed through behind cab. Replaced section and leak checked OK." rows={4} style={noteInput} disabled={noteBusy}/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" onClick={talk} style={talkButton} disabled={noteBusy}>{listening?"■ STOP":"🎤 TALK"}</button><button type="button" onClick={()=>void saveNote()} style={noteSaveButton} disabled={noteBusy}>{noteBusy?"Saving…":"SAVE NOTE"}</button></div>
      {noteMessage&&<div style={{fontSize:12,fontWeight:800,color:noteMessage.startsWith("Note saved")?"#176440":"#5b6670"}}>{noteMessage}</div>}
      {notes.length>0&&<div style={noteHistory}><strong style={{fontSize:12,color:"#52616d"}}>RECENT NOTES</strong>{notes.map(item=><div key={item.id} style={noteRow}><div style={{fontSize:13,color:"#243341",whiteSpace:"pre-wrap"}}>{item.detail}</div><div style={{marginTop:4,fontSize:10,color:"#7a8791"}}>{item.technician} · {noteTime(item.createdAt)}</div></div>)}</div>}
    </section>

    <button disabled={busy} onClick={()=>{setOpen(current=>!current);setMessage("")}} style={foundButton}>FOUND SOMETHING ELSE<span style={foundHelp}>Add another Open repair to this unit · keep working</span></button>
    {open&&<div style={formBox}><input value={issue} onChange={event=>setIssue(event.target.value)} placeholder="What else did you find?" style={inputStyle} autoFocus disabled={busy}/><div style={{display:"flex",gap:7}}><button type="button" onClick={()=>{setOpen(false);setIssue("");setMessage("")}} style={cancelButton} disabled={busy}>Cancel</button><button type="button" onClick={()=>void save()} style={saveButton} disabled={busy}>{busy?"Adding…":"Add repair"}</button></div></div>}
    {message&&<div style={{fontSize:12,fontWeight:800,color:message.startsWith("Added")?"#176440":"#8a3a2e"}}>{message}</div>}
  </div>;
}

const notePanel={padding:14,border:"2px solid #a8bfd6",borderRadius:12,background:"#f7fbff",display:"grid",gap:9} as const;
const noteInput={width:"100%",boxSizing:"border-box" as const,padding:"12px",border:"1px solid #aebdca",borderRadius:9,background:"white",color:"#182331",fontSize:15,lineHeight:1.4,resize:"vertical" as const} as const;
const talkButton={border:"1px solid #9ab1c5",borderRadius:9,padding:"10px 14px",background:"#e7f1fa",color:"#173a5d",fontWeight:900,cursor:"pointer"} as const;
const noteSaveButton={border:0,borderRadius:9,padding:"10px 14px",background:"#173a5d",color:"white",fontWeight:900,cursor:"pointer"} as const;
const noteHistory={display:"grid",gap:7,paddingTop:4} as const;
const noteRow={padding:"9px 10px",border:"1px solid #d4dde5",borderRadius:8,background:"white"} as const;
const foundButton={border:0,borderRadius:12,padding:16,fontWeight:900,fontSize:16,cursor:"pointer",textAlign:"left" as const,background:"#dfeaf5",color:"#173a5d"} as const;
const foundHelp={display:"block",marginTop:3,fontSize:11,fontWeight:700,opacity:.82} as const;
const formBox={padding:10,border:"1px solid #a8bfd6",borderRadius:10,background:"#f4f8fc",display:"grid",gap:8} as const;
const inputStyle={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #b8c8d7",borderRadius:8,background:"white",color:"#182331"} as const;
const cancelButton={border:"1px solid #c3cdd6",borderRadius:8,padding:"8px 10px",background:"white",fontWeight:800,cursor:"pointer"} as const;
const saveButton={border:0,borderRadius:8,padding:"8px 10px",background:"#173a5d",color:"white",fontWeight:900,cursor:"pointer"} as const;
