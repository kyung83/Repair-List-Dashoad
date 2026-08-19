"use client";

import {useEffect,useMemo,useRef,useState} from "react";

type RepairNote={id:number;detail:string;technician:string;createdAt:string};
type Part={id:number;partNumber:string;description:string;quantityOnHand:number;available?:number;location?:string};
type AppliedPart={partId:number;partNumber:string;description:string;quantity:number};
type ShopPayload={parts?:Part[];repairs?:Array<{id:string;usedParts?:AppliedPart[]}>;error?:string};
type NotesPayload={ok?:boolean;error?:string;notes?:RepairNote[]};
type ActionResult={ok?:boolean;error?:string;awaitingParts?:boolean;partNumber?:string;shortageQuantity?:number;reservedQuantity?:number;usedImmediately?:number;warehouseCode?:string};
type RemoveResult={ok?:boolean;error?:string;partNumber?:string;quantity?:number};
type UnmatchedResult={ok?:boolean;error?:string;requestedText?:string;requestedQuantity?:number;warehouseCode?:string;unmatchedPart?:boolean};
type SpeechResultLike={length:number;isFinal:boolean;[index:number]:{transcript:string}|undefined};
type SpeechEventLike={results:ArrayLike<SpeechResultLike>};
type RecognitionLike={lang:string;continuous:boolean;interimResults:boolean;start:()=>void;stop:()=>void;onresult:((event:SpeechEventLike)=>void)|null;onerror:((event:{error?:string})=>void)|null;onend:(()=>void)|null};
type RecognitionCtor=new()=>RecognitionLike;

type Props={repairId:string;canWork:boolean};

function noteTime(value:string){
  const parsed=Date.parse(value.includes("T")?value:value.replace(" ","T")+"Z");
  return Number.isFinite(parsed)?new Date(parsed).toLocaleString():value;
}

function qty(value:number|undefined){
  const number=Number(value??0);
  return Number.isInteger(number)?String(number):number.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
}

function partActionLabel(part:Part,quantity:number){
  const available=Number(part.available??part.quantityOnHand??0);
  if(available<=0)return "REQUEST PART";
  if(available+0.000001>=quantity)return "APPLY PART";
  return "USE / REQUEST";
}

export default function TechnicianRepairTools({repairId,canWork}:Props){
  const[note,setNote]=useState(""),[notes,setNotes]=useState<RepairNote[]>([]),[noteBusy,setNoteBusy]=useState(false),[noteMessage,setNoteMessage]=useState(""),[listening,setListening]=useState(false);
  const[parts,setParts]=useState<Part[]>([]),[appliedParts,setAppliedParts]=useState<AppliedPart[]>([]),[search,setSearch]=useState(""),[selectedPart,setSelectedPart]=useState<Part|null>(null),[quantity,setQuantity]=useState(1),[partBusy,setPartBusy]=useState(false),[partMessage,setPartMessage]=useState("");
  const recognitionRef=useRef<RecognitionLike|null>(null);

  async function loadNotes(){
    const response=await fetch(`/api/shop/found-repair?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});
    const result=await response.json() as NotesPayload;
    if(!response.ok||!result.ok)throw new Error(result.error||"Repair notes could not be loaded.");
    setNotes(result.notes??[]);
  }

  async function loadParts(){
    const response=await fetch("/api/shop",{cache:"no-store"});
    const result=await response.json() as ShopPayload;
    if(!response.ok)throw new Error(result.error||"Parts could not be loaded.");
    setParts(result.parts??[]);
    setAppliedParts(result.repairs?.find(repair=>repair.id===repairId)?.usedParts??[]);
  }

  useEffect(()=>{
    setNote("");setNoteMessage("");setSearch("");setSelectedPart(null);setQuantity(1);setPartMessage("");setAppliedParts([]);
    void loadNotes().catch(error=>setNoteMessage(error instanceof Error?error.message:"Repair notes could not be loaded."));
    void loadParts().catch(error=>setPartMessage(error instanceof Error?error.message:"Parts could not be loaded."));
    return()=>{try{recognitionRef.current?.stop()}catch{}recognitionRef.current=null};
  },[repairId]);

  const matches=useMemo(()=>{
    const term=search.trim().toLowerCase();
    if(!term)return [];
    return parts.filter(part=>`${part.partNumber} ${part.description}`.toLowerCase().includes(term)).slice(0,8);
  },[parts,search]);

  async function saveNote(){
    const value=note.trim();
    if(!value){setNoteMessage("Type or dictate a repair note first.");return}
    setNoteBusy(true);setNoteMessage("");
    try{
      const response=await fetch("/api/shop/found-repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"note",repairId,note:value})});
      const result=await response.json() as {ok?:boolean;error?:string};
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

  function validQuantity(){
    if(!Number.isFinite(quantity)||quantity<=0){setPartMessage("Enter a positive quantity.");return false}
    return true;
  }

  async function useOrRequestPart(){
    if(!selectedPart){setPartMessage("Type a part number or description and choose a matching part.");return}
    if(!validQuantity())return;
    setPartBusy(true);setPartMessage("");
    try{
      const response=await fetch("/api/shop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"usePart",repairId,partId:selectedPart.id,quantity})});
      const result=await response.json() as ActionResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Part could not be used or requested.");
      if(result.awaitingParts)setPartMessage(`${result.partNumber||selectedPart.partNumber}: Parts Desk updated. ${qty(result.shortageQuantity)} still needed.`);
      else setPartMessage(`${qty(result.usedImmediately||quantity)} × ${result.partNumber||selectedPart.partNumber} applied${result.warehouseCode?` from ${result.warehouseCode}`:""}.`);
      setSearch("");setSelectedPart(null);setQuantity(1);await loadParts();
    }catch(error){setPartMessage(error instanceof Error?error.message:"Part could not be used or requested.")}
    finally{setPartBusy(false)}
  }

  async function requestTypedPart(){
    const requestedText=search.trim();
    if(!requestedText){setPartMessage("Type the part number or description first.");return}
    if(!validQuantity())return;
    setPartBusy(true);setPartMessage("");
    try{
      const response=await fetch("/api/shop/unmatched-part",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repairId,requestedText,quantity})});
      const result=await response.json() as UnmatchedResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Part request could not be sent to Parts Desk.");
      setPartMessage(`${qty(quantity)} × ${result.requestedText||requestedText} sent to Parts Desk${result.warehouseCode?` for ${result.warehouseCode}`:""}.`);
      setSearch("");setSelectedPart(null);setQuantity(1);
    }catch(error){setPartMessage(error instanceof Error?error.message:"Part request could not be sent to Parts Desk.")}
    finally{setPartBusy(false)}
  }

  async function removeAppliedPart(part:AppliedPart){
    if(!canWork||partBusy)return;
    const confirmed=window.confirm(`Remove ${part.partNumber} × ${qty(part.quantity)} from this repair?\n\nThe part will be returned to inventory and any remaining request for this same part on this repair will be cancelled.`);
    if(!confirmed)return;
    setPartBusy(true);setPartMessage("");
    try{
      const response=await fetch("/api/shop/remove-applied-part",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repairId,partId:part.partId})});
      const result=await response.json() as RemoveResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Applied part could not be removed.");
      setPartMessage(`${qty(result.quantity||part.quantity)} × ${result.partNumber||part.partNumber} removed and returned to inventory.`);
      await loadParts();
    }catch(error){setPartMessage(error instanceof Error?error.message:"Applied part could not be removed.")}
    finally{setPartBusy(false)}
  }

  return <section style={toolsPanel}>
    <div style={toolCard}>
      <div><strong style={heading}>REPAIR NOTES</strong><span style={help}>Type it or tap TALK. Notes stay on this repair with technician and time.</span></div>
      <textarea value={note} onChange={event=>setNote(event.target.value.slice(0,2000))} placeholder="What did you find, check, repair, or still need?" rows={4} style={textarea} disabled={noteBusy}/>
      <div style={buttonRow}><button type="button" onClick={talk} style={talkButton} disabled={noteBusy}>{listening?"■ STOP":"🎤 TALK"}</button><button type="button" onClick={()=>void saveNote()} style={saveButton} disabled={noteBusy}>{noteBusy?"Saving…":"SAVE NOTE"}</button></div>
      {noteMessage&&<div style={messageStyle}>{noteMessage}</div>}
      {notes.length>0&&<div style={history}><strong style={historyHeading}>RECENT NOTES</strong>{notes.map(item=><div key={item.id} style={noteRow}><div style={{whiteSpace:"pre-wrap"}}>{item.detail}</div><div style={meta}>{item.technician} · {noteTime(item.createdAt)}</div></div>)}</div>}
    </div>

    <div style={toolCard}>
      <div><strong style={heading}>PART LOOKUP</strong><span style={help}>Type the part once. If it matches inventory, the button automatically applies it or requests the shortage. If there is no match, send exactly what you typed to Parts Desk.</span></div>
      <div style={searchRow}><input value={search} onChange={event=>{setSearch(event.target.value);setSelectedPart(null);setPartMessage("")}} placeholder="Type part number or description…" style={input} disabled={partBusy||!canWork}/><input aria-label="Part quantity" type="number" min="0.01" step="any" value={quantity} onChange={event=>setQuantity(Number(event.target.value))} style={qtyInput} disabled={partBusy||!canWork}/></div>
      {matches.length>0&&<div style={results}>{matches.map(part=><button key={part.id} type="button" onClick={()=>{setSelectedPart(part);setSearch(`${part.partNumber} — ${part.description}`);setPartMessage("")}} style={selectedPart?.id===part.id?selectedResult:resultButton}><span><strong>{part.partNumber}</strong> — {part.description}</span><span style={availability}>{qty(part.available??part.quantityOnHand)} available</span></button>)}</div>}
      {selectedPart&&<button type="button" onClick={()=>void useOrRequestPart()} style={partButton} disabled={partBusy||!canWork}>{partBusy?"Saving…":partActionLabel(selectedPart,quantity)}</button>}
      {search.trim()&&matches.length===0&&!selectedPart&&<div style={unmatchedBox}><div><strong>No catalog match.</strong><div style={small}>Request exactly: “{search.trim()}” · Qty {qty(quantity)}</div></div><button type="button" onClick={()=>void requestTypedPart()} style={requestButton} disabled={partBusy||!canWork}>{partBusy?"Sending…":"REQUEST THIS PART"}</button></div>}
      {partMessage&&<div style={messageStyle}>{partMessage}</div>}
      <div style={appliedBox}>
        <div><strong style={appliedHeading}>PARTS APPLIED TO THIS REPAIR</strong><span style={appliedHelp}>Review every part and quantity before finishing. Tap the X to undo a mistaken part, return it to inventory, and cancel any remaining request for that same part.</span></div>
        {appliedParts.length>0?<div style={appliedList}>{appliedParts.map(part=><div key={part.partId} style={appliedRow}><div><strong>{part.partNumber}</strong><span style={appliedDescription}>{part.description}</span></div><div style={appliedActions}><strong style={appliedQty}>× {qty(part.quantity)}</strong><button type="button" aria-label={`Remove ${part.partNumber}`} title="Remove mistaken applied part" onClick={()=>void removeAppliedPart(part)} style={removeAppliedButton} disabled={partBusy||!canWork}>✕</button></div></div>)}</div>:<div style={emptyApplied}>No parts applied yet.</div>}
      </div>
    </div>
  </section>;
}

const toolsPanel={marginTop:16,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:12} as const;
const toolCard={border:"2px solid #a8bfd6",borderRadius:12,background:"#f7fbff",padding:14,display:"grid",gap:9} as const;
const heading={display:"block",fontSize:15,color:"#173a5d"} as const;
const help={display:"block",marginTop:2,fontSize:11,color:"#687783"} as const;
const textarea={width:"100%",boxSizing:"border-box" as const,padding:12,border:"1px solid #aebdca",borderRadius:9,background:"white",color:"#182331",fontSize:15,lineHeight:1.4,resize:"vertical" as const} as const;
const input={width:"100%",boxSizing:"border-box" as const,padding:"12px",border:"1px solid #aebdca",borderRadius:9,background:"white",color:"#182331",fontSize:15} as const;
const searchRow={display:"grid",gridTemplateColumns:"minmax(170px,1fr) 90px",gap:8} as const;
const buttonRow={display:"flex",gap:8,flexWrap:"wrap" as const} as const;
const talkButton={border:"1px solid #9ab1c5",borderRadius:9,padding:"10px 14px",background:"#e7f1fa",color:"#173a5d",fontWeight:900,cursor:"pointer"} as const;
const saveButton={border:0,borderRadius:9,padding:"10px 14px",background:"#173a5d",color:"white",fontWeight:900,cursor:"pointer"} as const;
const history={display:"grid",gap:7,paddingTop:4} as const;
const historyHeading={fontSize:12,color:"#52616d"} as const;
const noteRow={padding:"9px 10px",border:"1px solid #d4dde5",borderRadius:8,background:"white",fontSize:13,color:"#243341"} as const;
const meta={marginTop:4,fontSize:10,color:"#7a8791"} as const;
const results={display:"grid",gap:6,maxHeight:260,overflowY:"auto" as const} as const;
const resultButton={border:"1px solid #d4dde5",borderRadius:8,padding:"9px 10px",background:"white",color:"#243341",display:"flex",justifyContent:"space-between",gap:10,textAlign:"left" as const,cursor:"pointer"} as const;
const selectedResult={...resultButton,border:"2px solid #173a5d",background:"#edf5fb"} as const;
const availability={fontSize:11,color:"#667482",whiteSpace:"nowrap" as const} as const;
const small={fontSize:11,color:"#667482",marginTop:2} as const;
const qtyInput={width:"100%",boxSizing:"border-box" as const,padding:"10px",border:"1px solid #ccd4db",borderRadius:8,background:"white"} as const;
const partButton={border:0,borderRadius:9,padding:"11px 12px",background:"#173a5d",color:"white",fontWeight:900,cursor:"pointer"} as const;
const unmatchedBox={display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap" as const,padding:11,border:"2px solid #e1b256",borderRadius:9,background:"#fff9ed"} as const;
const requestButton={border:0,borderRadius:9,padding:"10px 12px",background:"#f0ad2d",color:"#2c261b",fontWeight:950,cursor:"pointer"} as const;
const messageStyle={fontSize:12,fontWeight:800,color:"#5b6670"} as const;
const appliedBox={marginTop:4,border:"2px solid #7f9fb9",borderRadius:10,background:"white",padding:11,display:"grid",gap:8} as const;
const appliedHeading={display:"block",fontSize:12,color:"#173a5d",letterSpacing:".04em"} as const;
const appliedHelp={display:"block",marginTop:2,fontSize:10,color:"#687783"} as const;
const appliedList={display:"grid",gap:6} as const;
const appliedRow={display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"8px 9px",border:"1px solid #d7e0e8",borderRadius:8,background:"#f8fbfd"} as const;
const appliedDescription={display:"block",marginTop:2,fontSize:10,color:"#6c7882"} as const;
const appliedActions={display:"flex",alignItems:"center",gap:8} as const;
const appliedQty={fontSize:15,color:"#173a5d",whiteSpace:"nowrap" as const} as const;
const removeAppliedButton={width:28,height:28,border:"1px solid #e4a2a2",borderRadius:7,background:"#fff2f2",color:"#9f2929",fontWeight:950,fontSize:14,cursor:"pointer",lineHeight:1} as const;
const emptyApplied={fontSize:12,color:"#7a8791",padding:"4px 0"} as const;
