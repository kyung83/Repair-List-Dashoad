"use client";

import {useEffect,useMemo,useState} from "react";

type Part={id:number;partNumber:string;description:string;quantityOnHand:number;unitCost:number|null;location:string};
type Labor={id:number;repairId:string;repairIssue:string;technicianId:number|null;technician:string;laborDate:string;hours:number;rate:number;amount:number;notes:string};
type UsedPart={usageId:number;repairId:string;repairIssue:string;partId:number;partNumber:string;description:string;quantity:number;unitCost:number;lineCost:number;costRecorded:boolean};
type Repair={id:string;issue:string;technicianId:number|null;outsideCost:number;laborRate:number;reviewedAt:string};
type ReviewPackage={id:string;repairIds:string[];unit:string;technician:string;reviewed:boolean;reviewedAt:string;reviewedBy:string;repairs:Repair[];laborEntries:Labor[];usedParts:UsedPart[]};
type Data={canApprove:boolean;defaultLaborRate:number;parts:Part[];reviewPackages:ReviewPackage[]};

function money(value:number){return Number(value||0).toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:2});}
function partLabel(part:Part){return `${part.partNumber} — ${part.description}`;}

export default function ManagerWorkOrderCorrections(){
  const[data,setData]=useState<Data|null>(null);
  const[workId,setWorkId]=useState("");
  const[repairId,setRepairId]=useState("");
  const[repairTitle,setRepairTitle]=useState("");
  const[outsideCost,setOutsideCost]=useState("0");
  const[laborHours,setLaborHours]=useState("");
  const[laborRate,setLaborRate]=useState("");
  const[laborNotes,setLaborNotes]=useState("");
  const[partSearch,setPartSearch]=useState("");
  const[partQty,setPartQty]=useState("1");
  const[partCost,setPartCost]=useState("");
  const[reopenReason,setReopenReason]=useState("");
  const[busy,setBusy]=useState("");
  const[message,setMessage]=useState("");

  async function load(){
    const response=await fetch("/api/work-orders",{cache:"no-store"});
    const payload=await response.json() as Data&{error?:string};
    if(!response.ok)throw new Error(payload.error||"Work order corrections could not be loaded.");
    setData(payload);
  }
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Work order corrections could not be loaded."));},[]);
  useEffect(()=>{
    if(!data?.canApprove)return;
    if(!workId||!data.reviewPackages.some(item=>item.id===workId)){
      const first=data.reviewPackages.find(item=>!item.reviewed)??data.reviewPackages[0];
      setWorkId(first?.id??"");
    }
  },[data,workId]);

  const work=useMemo(()=>data?.reviewPackages.find(item=>item.id===workId)??null,[data,workId]);
  useEffect(()=>{
    if(!work)return;
    if(!repairId||!work.repairs.some(item=>item.id===repairId))setRepairId(work.repairs[0]?.id??"");
  },[work,repairId]);
  const repair=useMemo(()=>work?.repairs.find(item=>item.id===repairId)??null,[work,repairId]);
  useEffect(()=>{
    if(!repair)return;
    setRepairTitle(repair.issue);
    setOutsideCost(String(Number(repair.outsideCost||0)));
    if(!laborRate)setLaborRate(String(Number(repair.laborRate||data?.defaultLaborRate||0)));
  },[repair,data,laborRate]);

  const repairLabor=useMemo(()=>work?.laborEntries.filter(item=>item.repairId===repairId)??[],[work,repairId]);
  const repairParts=useMemo(()=>work?.usedParts.filter(item=>item.repairId===repairId)??[],[work,repairId]);

  async function post(action:string,body:Record<string,unknown>,success:string){
    setBusy(action);setMessage("");
    try{
      const response=await fetch("/api/work-orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})});
      const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok)throw new Error(payload.error||"Work order correction could not be saved.");
      setMessage(success);
      window.location.reload();
    }catch(error){setMessage(error instanceof Error?error.message:"Work order correction could not be saved.");setBusy("");}
  }

  function selectedPart(){
    if(!data)return null;
    const text=partSearch.trim().toLowerCase();
    if(!text)return null;
    const exact=data.parts.find(part=>part.partNumber.toLowerCase()===text||partLabel(part).toLowerCase()===text);
    if(exact)return exact;
    const matches=data.parts.filter(part=>`${part.partNumber} ${part.description}`.toLowerCase().includes(text));
    return matches.length===1?matches[0]:null;
  }

  async function editLabor(entry:Labor){
    const rawHours=prompt("Correct labor hours",String(entry.hours));if(rawHours===null)return;
    const rawRate=prompt("Correct labor rate per hour",String(entry.rate));if(rawRate===null)return;
    const rawNotes=prompt("Labor note",entry.notes||entry.repairIssue);if(rawNotes===null)return;
    await post("reviewUpdateLabor",{entryId:entry.id,hours:Number(rawHours),rate:Number(rawRate),notes:rawNotes},"Labor entry corrected.");
  }
  async function deleteLabor(entry:Labor){
    if(!confirm(`Remove ${entry.hours} hr labor entry for ${entry.technician}?`))return;
    await post("reviewDeleteLabor",{entryId:entry.id},"Labor entry removed.");
  }
  async function editPart(part:UsedPart){
    const rawQty=prompt(`Correct quantity for ${part.partNumber}`,String(part.quantity));if(rawQty===null)return;
    const rawCost=prompt(`Correct unit cost for ${part.partNumber}`,part.costRecorded?String(part.unitCost):"0");if(rawCost===null)return;
    await post("reviewUpdatePart",{usageId:part.usageId,quantity:Number(rawQty),unitCost:Number(rawCost)},"Part line corrected.");
  }
  async function removePart(part:UsedPart){
    if(!confirm(`Remove ${part.partNumber} x${part.quantity} from this work order and return it to its recorded warehouse?`))return;
    await post("reviewRemovePart",{usageId:part.usageId},"Part removed and returned to stock.");
  }

  if(!data||!data.canApprove)return message?<div style={notice}>{message}</div>:null;
  if(!data.reviewPackages.length)return null;

  return <section style={shell}>
    <div style={head}>
      <div><p style={eyebrow}>MANAGER CORRECTIONS</p><h2 style={title}>Correct completed work before approval</h2><p style={help}>Fix a missed part, labor hours/rate, outside cost, or repair wording. Technician notes stay unchanged and every correction is audited.</p></div>
      <select value={workId} onChange={event=>{setWorkId(event.target.value);setRepairId("");}} style={{...input,minWidth:270}}>
        {data.reviewPackages.map(item=><option key={item.id} value={item.id}>Unit {item.unit} · {item.technician||"Unassigned"} · {item.reviewed?"Reviewed":"Needs review"}</option>)}
      </select>
    </div>
    {message&&<div style={notice}>{message}</div>}

    {work?.reviewed?<div style={locked}>
      <div><strong>Approved work order</strong><span style={small}>Reviewed by {work.reviewedBy||"manager"}. Reopen it before changing costs or work details.</span></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"end"}}><label style={label}>Reason to reopen<input value={reopenReason} onChange={e=>setReopenReason(e.target.value)} placeholder="Why does this WO need correction?" style={{...input,minWidth:320}}/></label><button type="button" disabled={Boolean(busy)} onClick={()=>{if(!reopenReason.trim()){setMessage("Enter why the approved work order needs to be reopened.");return;}void post("reopenWorkOrderReview",{repairIds:work.repairIds,reason:reopenReason.trim()},"Work order reopened for corrections.");}} style={dangerButton}>REOPEN FOR CORRECTIONS</button></div>
    </div>:work&&<>
      <div style={repairBar}>
        <label style={label}>Repair in this WO<select value={repairId} onChange={e=>setRepairId(e.target.value)} style={{...input,minWidth:310}}>{work.repairs.map(item=><option key={item.id} value={item.id}>{item.id} · {item.issue}</option>)}</select></label>
        <span style={small}>Unit {work.unit} · {work.technician||"Unassigned"}</span>
      </div>

      {repair&&<div style={grid}>
        <article style={card}>
          <h3 style={cardTitle}>Repair details & outside cost</h3>
          <label style={label}>Repair description<input value={repairTitle} onChange={e=>setRepairTitle(e.target.value)} style={input}/></label>
          <button type="button" disabled={Boolean(busy)||repairTitle.trim()===repair.issue} onClick={()=>void post("reviewUpdateRepairTitle",{repairId:repair.id,title:repairTitle.trim()},"Repair description corrected.")} style={saveButton}>SAVE DESCRIPTION</button>
          <label style={{...label,marginTop:12}}>Outside / vendor cost<input type="number" min="0" step="0.01" value={outsideCost} onChange={e=>setOutsideCost(e.target.value)} style={input}/></label>
          <button type="button" disabled={Boolean(busy)} onClick={()=>void post("reviewSetOutsideCost",{repairId:repair.id,amount:Number(outsideCost)},"Outside/vendor cost corrected.")} style={saveButton}>SAVE OUTSIDE COST</button>
        </article>

        <article style={card}>
          <h3 style={cardTitle}>Labor corrections</h3>
          {repairLabor.length?repairLabor.map(entry=><div key={entry.id} style={line}><div><strong>{entry.technician}</strong><span style={small}>{entry.laborDate} · {entry.hours} hr @ {money(entry.rate)}/hr · {money(entry.amount)}</span><span style={small}>{entry.notes||entry.repairIssue}</span></div><div style={actions}><button type="button" onClick={()=>void editLabor(entry)} style={miniButton}>EDIT</button><button type="button" onClick={()=>void deleteLabor(entry)} style={miniDanger}>REMOVE</button></div></div>):<div style={empty}>No labor entries recorded.</div>}
          <div style={formRow}><label style={label}>Hours<input type="number" min="0.01" max="24" step="0.01" value={laborHours} onChange={e=>setLaborHours(e.target.value)} style={input}/></label><label style={label}>Rate / hr<input type="number" min="0" step="0.01" value={laborRate} onChange={e=>setLaborRate(e.target.value)} style={input}/></label></div>
          <label style={label}>Manager labor note<input value={laborNotes} onChange={e=>setLaborNotes(e.target.value)} placeholder="Forgotten labor / corrected time" style={input}/></label>
          <button type="button" disabled={Boolean(busy)} onClick={()=>void post("reviewAddLabor",{repairId:repair.id,technicianId:repair.technicianId,hours:Number(laborHours),rate:Number(laborRate),notes:laborNotes.trim()},"Labor correction added.")} style={saveButton}>ADD LABOR</button>
        </article>

        <article style={{...card,gridColumn:"1 / -1"}}>
          <h3 style={cardTitle}>Parts corrections</h3>
          {repairParts.length?repairParts.map(part=><div key={part.usageId} style={line}><div><strong>{part.partNumber} — {part.description}</strong><span style={small}>Qty {part.quantity} · {part.costRecorded?`${money(part.unitCost)} each · ${money(part.lineCost)}`:"historical cost missing"}</span></div><div style={actions}><button type="button" onClick={()=>void editPart(part)} style={miniButton}>EDIT QTY / COST</button><button type="button" onClick={()=>void removePart(part)} style={miniDanger}>REMOVE</button></div></div>):<div style={empty}>No parts applied.</div>}
          <div style={formRow4}>
            <label style={label}>Forgotten part<input list="wo-review-parts" value={partSearch} onChange={e=>setPartSearch(e.target.value)} placeholder="Part # or description" style={input}/></label>
            <datalist id="wo-review-parts">{data.parts.map(part=><option key={part.id} value={partLabel(part)}>{part.quantityOnHand} available · {part.location}</option>)}</datalist>
            <label style={label}>Qty<input type="number" min="0.01" step="0.01" value={partQty} onChange={e=>setPartQty(e.target.value)} style={input}/></label>
            <label style={label}>Unit cost override<input type="number" min="0" step="0.01" value={partCost} onChange={e=>setPartCost(e.target.value)} placeholder="Use inventory cost" style={input}/></label>
            <button type="button" disabled={Boolean(busy)} onClick={()=>{const part=selectedPart();if(!part){setMessage("Choose one exact part from the suggestions before adding it.");return;}void post("reviewAddPart",{repairId:repair.id,partId:part.id,quantity:Number(partQty),unitCost:partCost.trim()===""?undefined:Number(partCost)},"Forgotten part added to the work order.");}} style={saveButton}>ADD FORGOTTEN PART</button>
          </div>
        </article>
      </div>}
    </>}
  </section>;
}

const shell={marginTop:14,padding:14,border:"1px solid #cfd6db",background:"#fff",color:"#182331"} as const;
const head={display:"flex",justifyContent:"space-between",gap:14,alignItems:"end",flexWrap:"wrap"} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:10,fontWeight:900,letterSpacing:".12em"} as const;
const title={margin:"4px 0",fontSize:20} as const;
const help={margin:0,color:"#667482",fontSize:12,maxWidth:760} as const;
const repairBar={display:"flex",justifyContent:"space-between",gap:12,alignItems:"end",flexWrap:"wrap",marginTop:13,paddingTop:12,borderTop:"1px solid #e2e7eb"} as const;
const grid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(330px,1fr))",gap:12,marginTop:12} as const;
const card={padding:12,border:"1px solid #dfe5e9",background:"#fafbfc"} as const;
const cardTitle={margin:"0 0 10px",fontSize:13,textTransform:"uppercase" as const,letterSpacing:".04em"} as const;
const label={display:"grid",gap:4,fontSize:10,fontWeight:900,color:"#5b6770"} as const;
const input={minHeight:34,padding:"6px 8px",border:"1px solid #c7ced3",borderRadius:4,background:"white",color:"#263746",boxSizing:"border-box" as const,width:"100%"} as const;
const saveButton={minHeight:34,padding:"0 10px",marginTop:8,border:"1px solid #176440",borderRadius:4,background:"#176440",color:"white",fontSize:10,fontWeight:900,cursor:"pointer"} as const;
const dangerButton={...saveButton,marginTop:0,border:"1px solid #92362f",background:"#92362f"} as const;
const line={display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",padding:"8px 0",borderTop:"1px solid #e7ebee",fontSize:11} as const;
const actions={display:"flex",gap:5,flexWrap:"wrap"} as const;
const miniButton={minHeight:28,padding:"0 7px",border:"1px solid #bcc5cb",borderRadius:4,background:"white",fontSize:9,fontWeight:900,cursor:"pointer"} as const;
const miniDanger={...miniButton,border:"1px solid #c78e88",color:"#8d3029"} as const;
const small={display:"block",marginTop:2,color:"#6e7a84",fontSize:10} as const;
const formRow={display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10} as const;
const formRow4={display:"grid",gridTemplateColumns:"minmax(250px,2fr) minmax(80px,.5fr) minmax(120px,.7fr) auto",gap:8,alignItems:"end",marginTop:10} as const;
const locked={marginTop:12,padding:12,border:"1px solid #b9d8c8",background:"#f1faf5",display:"flex",justifyContent:"space-between",gap:12,alignItems:"end",flexWrap:"wrap"} as const;
const notice={marginTop:10,padding:9,border:"1px solid #f1c66d",background:"#fff8e6",color:"#5d4b22",fontSize:11} as const;
const empty={padding:"8px 0",color:"#78848d",fontSize:11} as const;
