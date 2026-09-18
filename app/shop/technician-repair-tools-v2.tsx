"use client";

import {useEffect,useMemo,useRef,useState} from "react";

type RepairNote={id:number;detail:string;technician:string;createdAt:string};
type WarehouseStock={warehouseCode:string;warehouseName?:string;available?:number;quantityOnHand?:number;physicalOnHand?:number;reserved?:number};
type Part={id:number;partNumber:string;description:string;quantityOnHand:number;available?:number;location?:string;crossReferences?:string[];warehouseStocks?:WarehouseStock[]};
type ShopUser={role?:string;assignedWarehouseCode?:string;assignedWarehouseName?:string;warehouseAssigned?:boolean};
type ShopPayload={parts?:Part[];user?:ShopUser;error?:string};
type NotesPayload={ok?:boolean;error?:string;notes?:RepairNote[]};
type ActionResult={ok?:boolean;error?:string;awaitingParts?:boolean;partNumber?:string;shortageQuantity?:number;reservedQuantity?:number;usedImmediately?:number;warehouseCode?:string;waitingOnPart?:boolean;nextRepairId?:string|null;hours?:number;laborStarted?:boolean;activeLaborContinues?:boolean};
type UnmatchedResult={ok?:boolean;error?:string;requestedText?:string;requestedQuantity?:number;warehouseCode?:string;unmatchedPart?:boolean;awaitingParts?:boolean;waitingOnPart?:boolean;nextRepairId?:string|null;hours?:number;laborStarted?:boolean;activeLaborContinues?:boolean};
type SpeechResultLike={length:number;isFinal:boolean;[index:number]:{transcript:string}|undefined};
type SpeechEventLike={results:ArrayLike<SpeechResultLike>};
type RecognitionLike={lang:string;continuous:boolean;interimResults:boolean;start:()=>void;stop:()=>void;onresult:((event:SpeechEventLike)=>void)|null;onerror:((event:{error?:string})=>void)|null;onend:(()=>void)|null};
type RecognitionCtor=new()=>RecognitionLike;
type Props={repairId:string;canWork:boolean;mode?:"all"|"notes"|"parts"};

function noteTime(value:string){const parsed=Date.parse(value.includes("T")?value:value.replace(" ","T")+"Z");return Number.isFinite(parsed)?new Date(parsed).toLocaleString():value}
function qty(value:number|undefined){const number=Number(value??0);return Number.isInteger(number)?String(number):number.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function warehouseAvailable(stock:WarehouseStock|undefined){return Number(stock?.available??stock?.quantityOnHand??0)}
function refreshReview(repairId:string){window.dispatchEvent(new CustomEvent("repair-review-refresh",{detail:{repairId}}))}
function refreshShop(){window.dispatchEvent(new Event("shop-jobs-refresh"))}
function waitMessage(result:{waitingOnPart?:boolean;nextRepairId?:string|null;activeLaborContinues?:boolean}){if(result.nextRepairId)return " Labor was saved, this repair moved to Waiting on Part, and the next repair started.";if(result.waitingOnPart)return " Labor was saved and this repair moved to Waiting on Part.";if(result.activeLaborContinues)return " The request was saved, but another active labor session is still running on this repair.";return " The request was saved for Parts Desk."}

export default function TechnicianRepairToolsV2({repairId,canWork,mode="all"}:Props){
  const[note,setNote]=useState(""),[notes,setNotes]=useState<RepairNote[]>([]),[noteBusy,setNoteBusy]=useState(false),[noteMessage,setNoteMessage]=useState(""),[listening,setListening]=useState(false);
  const[parts,setParts]=useState<Part[]>([]),[search,setSearch]=useState(""),[selectedPart,setSelectedPart]=useState<Part|null>(null),[warehouseCode,setWarehouseCode]=useState(""),[quantity,setQuantity]=useState(1),[partBusy,setPartBusy]=useState(false),[partMessage,setPartMessage]=useState("");
  const[shopRole,setShopRole]=useState(""),[assignedWarehouseCode,setAssignedWarehouseCode]=useState(""),[assignedWarehouseName,setAssignedWarehouseName]=useState("");
  const recognitionRef=useRef<RecognitionLike|null>(null);
  const showNotes=mode!=="parts";
  const showParts=mode!=="notes";

  async function loadNotes(){const response=await fetch(`/api/shop/found-repair?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});const result=await response.json() as NotesPayload;if(!response.ok||!result.ok)throw new Error(result.error||"Repair notes could not be loaded.");setNotes(result.notes??[])}
  async function loadParts(){const response=await fetch("/api/shop",{cache:"no-store"});const result=await response.json() as ShopPayload;if(!response.ok)throw new Error(result.error||"Parts could not be loaded.");const role=String(result.user?.role??"");const code=String(result.user?.assignedWarehouseCode??"");setParts(result.parts??[]);setShopRole(role);setAssignedWarehouseCode(code);setAssignedWarehouseName(String(result.user?.assignedWarehouseName??""));if((role==="mechanic"||role==="manager")&&!code)setPartMessage("Your account needs an assigned yard/parts warehouse before you can use or request parts.")}

  useEffect(()=>{setNote("");setNoteMessage("");setSearch("");setSelectedPart(null);setWarehouseCode("");setQuantity(1);setPartMessage("");if(showNotes)void loadNotes().catch(error=>setNoteMessage(error instanceof Error?error.message:"Repair notes could not be loaded."));if(showParts)void loadParts().catch(error=>setPartMessage(error instanceof Error?error.message:"Parts could not be loaded."));return()=>{try{recognitionRef.current?.stop()}catch{}recognitionRef.current=null}},[repairId,showNotes,showParts]);

  const matches=useMemo(()=>{const term=search.trim().toLowerCase();if(!term)return[];return parts.filter(part=>`${part.partNumber} ${part.description} ${(part.crossReferences??[]).join(" ")}`.toLowerCase().includes(term)).slice(0,8)},[parts,search]);
  const warehouseLocked=shopRole==="mechanic"||shopRole==="manager";
  const effectiveWarehouseCode=warehouseLocked?assignedWarehouseCode:warehouseCode;
  const selectedWarehouse=(selectedPart?.warehouseStocks??[]).find(stock=>stock.warehouseCode===effectiveWarehouseCode)??(warehouseLocked?(selectedPart?.warehouseStocks??[])[0]:undefined);
  const selectedAvailable=warehouseAvailable(selectedWarehouse);

  async function saveNote(){const value=note.trim();if(!value){setNoteMessage("Type or dictate a repair note first.");return}setNoteBusy(true);setNoteMessage("");try{const response=await fetch("/api/shop/found-repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"note",repairId,note:value})});const result=await response.json() as {ok?:boolean;error?:string};if(!response.ok||!result.ok)throw new Error(result.error||"Repair note could not be saved.");setNote("");setNoteMessage("Note saved. It is also in Review Before Finishing.");await loadNotes();refreshReview(repairId)}catch(error){setNoteMessage(error instanceof Error?error.message:"Repair note could not be saved.")}finally{setNoteBusy(false)}}

  function talk(){if(listening){try{recognitionRef.current?.stop()}catch{}return}const speechWindow=window as typeof window&{SpeechRecognition?:RecognitionCtor;webkitSpeechRecognition?:RecognitionCtor};const Recognition=speechWindow.SpeechRecognition??speechWindow.webkitSpeechRecognition;if(!Recognition){setNoteMessage("Voice input is not available in this browser. Use the keyboard microphone or type the note.");return}try{const recognition=new Recognition();recognition.lang="en-US";recognition.continuous=false;recognition.interimResults=false;recognition.onresult=event=>{const result=event.results[event.results.length-1],spoken=result?.[0]?.transcript?.trim()??"";if(spoken)setNote(current=>[current.trim(),spoken].filter(Boolean).join(" ").slice(0,2000))};recognition.onerror=event=>{setNoteMessage(event.error?`Voice input stopped: ${event.error}.`:"Voice input stopped.");setListening(false)};recognition.onend=()=>{setListening(false);recognitionRef.current=null};recognitionRef.current=recognition;setNoteMessage("Listening… speak your repair note.");setListening(true);recognition.start()}catch{setListening(false);recognitionRef.current=null;setNoteMessage("Voice input could not start. You can still type the note.")}}

  function validQuantity(){if(!Number.isFinite(quantity)||quantity<=0){setPartMessage("Enter a positive quantity.");return false}return true}

  async function useOrRequestPart(){
    if(!selectedPart){setPartMessage("Type a part number or description and choose a matching part.");return}
    if(!effectiveWarehouseCode){setPartMessage(warehouseLocked?"Your account needs an assigned yard/parts warehouse before you can use or request parts.":"Choose the warehouse that will supply this part.");return}
    if(!validQuantity())return;
    setPartBusy(true);setPartMessage("");
    try{
      const operationKey=`shop-part:${repairId}:${crypto.randomUUID()}`;
      const response=await fetch("/api/shop",{method:"POST",headers:{"content-type":"application/json","idempotency-key":operationKey},body:JSON.stringify({action:"usePart",repairId,partId:selectedPart.id,quantity,warehouseCode:effectiveWarehouseCode,operationKey})});
      const result=await response.json() as ActionResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Part could not be applied or requested.");
      if(result.awaitingParts){setPartMessage(`${result.partNumber||selectedPart.partNumber}: request recorded for ${result.warehouseCode||effectiveWarehouseCode}. ${qty(result.shortageQuantity)} still needed.${waitMessage(result)}`);if(result.waitingOnPart)refreshShop()}
      else setPartMessage(`${qty(result.usedImmediately||quantity)} × ${result.partNumber||selectedPart.partNumber} applied from ${result.warehouseCode||effectiveWarehouseCode}.`);
      setSearch("");setSelectedPart(null);setWarehouseCode("");setQuantity(1);await loadParts();refreshReview(repairId);
    }catch(error){setPartMessage(error instanceof Error?error.message:"Part could not be applied or requested.")}finally{setPartBusy(false)}
  }

  async function requestTypedPart(){const requestedText=search.trim();if(!requestedText){setPartMessage("Type the part number or description first.");return}if(!validQuantity())return;setPartBusy(true);setPartMessage("");try{const response=await fetch("/api/shop/unmatched-part",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repairId,requestedText,quantity})});const result=await response.json() as UnmatchedResult;if(!response.ok||!result.ok)throw new Error(result.error||"Part request could not be sent to Parts Desk.");setPartMessage(`${qty(quantity)} × ${result.requestedText||requestedText} sent to Parts Desk${result.warehouseCode?` for ${result.warehouseCode}`:""}.${waitMessage(result)}`);if(result.waitingOnPart)refreshShop();setSearch("");setSelectedPart(null);setWarehouseCode("");setQuantity(1);refreshReview(repairId)}catch(error){setPartMessage(error instanceof Error?error.message:"Part request could not be sent to Parts Desk.")}finally{setPartBusy(false)}}

  const actionLabel=!effectiveWarehouseCode?(warehouseLocked?"WAREHOUSE NOT ASSIGNED":"CHOOSE WAREHOUSE"):selectedAvailable+0.000001>=quantity?"APPLY PART":"REQUEST PART";

  return <section style={mode==="parts"?partsOnlyPanel:toolsPanel}>
    {showNotes&&<div style={toolCard}>
      <div><strong style={heading}>REPAIR NOTES</strong><span style={help}>Type it or tap TALK. Saved notes stay on this repair and remain visible in the final review.</span></div>
      <textarea value={note} onChange={event=>setNote(event.target.value.slice(0,2000))} placeholder="What did you find, check, repair, or still need?" rows={4} style={textarea} disabled={noteBusy}/>
      <div style={buttonRow}><button type="button" onClick={talk} style={talkButton} disabled={noteBusy}>{listening?"■ STOP":"🎤 TALK"}</button><button type="button" onClick={()=>void saveNote()} style={saveButton} disabled={noteBusy}>{noteBusy?"Saving…":"SAVE NOTE"}</button></div>
      {noteMessage&&<div style={messageStyle}>{noteMessage}</div>}
      {notes.length>0&&<div style={history}><strong style={historyHeading}>SAVED NOTES</strong>{notes.map(item=><div key={item.id} style={noteRow}><div style={{whiteSpace:"pre-wrap"}}>{item.detail}</div><div style={meta}>{item.technician} · {noteTime(item.createdAt)}</div></div>)}</div>}
    </div>}

    {showParts&&<div style={toolCard}>
      <div><strong style={heading}>PART LOOKUP</strong><span style={help}>{warehouseLocked?`Parts are automatically tied to ${assignedWarehouseName||assignedWarehouseCode||"your assigned warehouse"}. `:"Choose the exact warehouse. "}In-stock parts are applied immediately. If the warehouse is short, requesting the part automatically saves labor and moves the repair to Waiting on Part.</span></div>
      {warehouseLocked&&<div style={lockedWarehouseBox}><span>YOUR PARTS WAREHOUSE</span><strong>{assignedWarehouseName||assignedWarehouseCode||"NOT ASSIGNED"}</strong></div>}
      <div style={searchRow}><input value={search} onChange={event=>{setSearch(event.target.value);setSelectedPart(null);if(!warehouseLocked)setWarehouseCode("");setPartMessage("")}} placeholder="Type part number or description…" style={input} disabled={partBusy||!canWork||(warehouseLocked&&!assignedWarehouseCode)}/><input aria-label="Part quantity" type="number" min="0.01" step="any" value={quantity} onChange={event=>setQuantity(Number(event.target.value))} style={qtyInput} disabled={partBusy||!canWork||(warehouseLocked&&!assignedWarehouseCode)}/></div>
      {matches.length>0&&<div style={results}>{matches.map(part=><button key={part.id} type="button" onClick={()=>{setSelectedPart(part);if(!warehouseLocked)setWarehouseCode("");setSearch(`${part.partNumber} — ${part.description}`);setPartMessage("")}} style={selectedPart?.id===part.id?selectedResult:resultButton}><span><strong>{part.partNumber}</strong> — {part.description}{(part.crossReferences??[]).length>0&&<small style={crossRef}>Cross: {(part.crossReferences??[]).join(" · ")}</small>}</span><span style={availability}>{qty(part.available??part.quantityOnHand)} available{warehouseLocked&&effectiveWarehouseCode?` · ${effectiveWarehouseCode}`:""}</span></button>)}</div>}
      {selectedPart&&<>
        {!warehouseLocked&&<label style={warehouseLabel}>SUPPLY WAREHOUSE<select value={warehouseCode} onChange={event=>{setWarehouseCode(event.target.value);setPartMessage("")}} style={select} disabled={partBusy||!canWork}><option value="">Choose warehouse…</option>{(selectedPart.warehouseStocks??[]).map(stock=><option key={stock.warehouseCode} value={stock.warehouseCode}>{stock.warehouseName||stock.warehouseCode} — {qty(warehouseAvailable(stock))} available</option>)}</select></label>}
        {warehouseLocked&&<div style={assignedStockLine}><span>{assignedWarehouseName||assignedWarehouseCode}</span><strong>{qty(selectedAvailable)} available</strong></div>}
        <button type="button" onClick={()=>void useOrRequestPart()} style={partButton} disabled={partBusy||!canWork||!effectiveWarehouseCode}>{partBusy?"Saving…":actionLabel}</button>
      </>}
      {search.trim()&&matches.length===0&&!selectedPart&&<div style={unmatchedBox}><div><strong>No catalog match.</strong><div style={small}>Request exactly: “{search.trim()}” · Qty {qty(quantity)}{warehouseLocked&&assignedWarehouseCode?` · ${assignedWarehouseCode}`:""}</div></div><button type="button" onClick={()=>void requestTypedPart()} style={requestButton} disabled={partBusy||!canWork||(warehouseLocked&&!assignedWarehouseCode)}>{partBusy?"Sending…":"REQUEST THIS PART"}</button></div>}
      {partMessage&&<div style={messageStyle}>{partMessage}</div>}
    </div>}
  </section>;
}

const toolsPanel={marginTop:16,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:12} as const;
const partsOnlyPanel={display:"grid",gap:12} as const;
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
const crossRef={display:"block",marginTop:3,fontSize:10,color:"#6d7b87",fontWeight:700} as const;
const small={fontSize:11,color:"#667482",marginTop:2} as const;
const qtyInput={width:"100%",boxSizing:"border-box" as const,padding:"10px",border:"1px solid #ccd4db",borderRadius:8,background:"white"} as const;
const lockedWarehouseBox={display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"9px 11px",border:"1px solid #b8c9d8",borderRadius:9,background:"#edf5fb",fontSize:11,color:"#52616d"} as const;
const assignedStockLine={display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"9px 11px",borderRadius:8,background:"#eef2f5",fontSize:11,color:"#425565"} as const;
const warehouseLabel={display:"grid",gap:4,fontSize:11,fontWeight:900,color:"#52616d"} as const;
const select={width:"100%",boxSizing:"border-box" as const,padding:"10px",border:"1px solid #aebdca",borderRadius:9,background:"white",color:"#182331",fontSize:14} as const;
const partButton={border:0,borderRadius:9,padding:"11px 12px",background:"#173a5d",color:"white",fontWeight:900,cursor:"pointer"} as const;
const unmatchedBox={display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap" as const,padding:11,border:"2px solid #e1b256",borderRadius:9,background:"#fff9ed"} as const;
const requestButton={border:0,borderRadius:9,padding:"10px 12px",background:"#f0ad2d",color:"#2c261b",fontWeight:950,cursor:"pointer"} as const;
const messageStyle={fontSize:12,fontWeight:800,color:"#5b6670"} as const;