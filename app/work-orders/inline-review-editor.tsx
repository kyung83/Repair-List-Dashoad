"use client";

import {useEffect,useMemo,useState} from "react";

type PartOption={id:number;partNumber:string;description:string;quantityOnHand:number;unitCost:number|null;location:string};
type LaborEntry={repairId:string;repairIssue:string;id:number;technicianId:number|null;technician:string;laborDate:string;hours:number;rate:number;amount:number;notes:string;startedAt?:string;endedAt?:string};
type LaborSummary={key:string;repairId:string;repairIssue:string;technicianId:number|null;technician:string;laborDate:string;hours:number;rate:number;amount:number;segments:number;timeRanges:string[]};
type UsedPart={usageId:number;repairId:string;repairIssue:string;partId:number;partNumber:string;description:string;quantity:number;unitCost:number;lineCost:number;costRecorded:boolean};
type TechnicianNote={repairId:string;repairIssue:string;id:number;technicianId:number|null;technician:string;detail:string;createdAt:string};
type Repair={id:string;issue:string;status:string;technicianId:number|null;outsideCost:number;laborRate:number;reviewedAt:string};
type ReviewPackage={id:string;repairIds:string[];unit:string;technician:string;reviewed:boolean;reviewedAt:string;reviewedBy:string;reviewNote:string;repairs:Repair[];technicianNotes:TechnicianNote[];laborEntries:LaborEntry[];usedParts:UsedPart[];missingPartCostLines:number;laborCost:number;partCost:number;outsideCost:number;totalCost:number};

type Props={
  item:ReviewPackage;
  canManage:boolean;
  defaultLaborRate:number;
  parts:PartOption[];
  onChanged:()=>Promise<void>;
};

type LaborDraft={hours:string;rate:string;notes:string};
type PartDraft={quantity:string;unitCost:string};

function money(value:number){return Number(value||0).toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:2});}
function dateTime(value:string){if(!value)return "—";const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";const parsed=new Date(normalized);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
function timeOnly(value:string){if(!value)return"";const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";const parsed=new Date(normalized);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}
function laborRange(entry:LaborEntry){const start=timeOnly(entry.startedAt||"");const end=timeOnly(entry.endedAt||"");if(start&&end)return`${start}–${end}`;if(start)return`Started ${start}`;if(end)return`Ended ${end}`;return"";}
function partLabel(part:PartOption){return `${part.partNumber} — ${part.description}`;}
function summarizeLabor(entries:LaborEntry[]){
  const grouped=new Map<string,LaborSummary>();
  for(const entry of entries){
    const technicianKey=entry.technicianId===null?entry.technician:`tech-${entry.technicianId}`;
    const key=`${entry.repairId}|${technicianKey}|${entry.laborDate}|${Number(entry.rate).toFixed(4)}`;
    const range=laborRange(entry);
    const current=grouped.get(key);
    if(current){
      current.hours+=Number(entry.hours||0);
      current.amount+=Number(entry.amount||0);
      current.segments+=1;
      if(range)current.timeRanges.push(range);
    }else{
      grouped.set(key,{key,repairId:entry.repairId,repairIssue:entry.repairIssue,technicianId:entry.technicianId,technician:entry.technician,laborDate:entry.laborDate,hours:Number(entry.hours||0),rate:Number(entry.rate||0),amount:Number(entry.amount||0),segments:1,timeRanges:range?[range]:[]});
    }
  }
  return [...grouped.values()].sort((a,b)=>a.laborDate.localeCompare(b.laborDate)||a.repairIssue.localeCompare(b.repairIssue)||a.technician.localeCompare(b.technician));
}

export default function InlineWorkOrderReviewEditor({item,canManage,defaultLaborRate,parts,onChanged}:Props){
  const editable=canManage&&!item.reviewed;
  const[busy,setBusy]=useState("");
  const[message,setMessage]=useState("");
  const[repairTitles,setRepairTitles]=useState<Record<string,string>>({});
  const[outsideCosts,setOutsideCosts]=useState<Record<string,string>>({});
  const[laborDrafts,setLaborDrafts]=useState<Record<number,LaborDraft>>({});
  const[partDrafts,setPartDrafts]=useState<Record<number,PartDraft>>({});
  const[newLaborRepair,setNewLaborRepair]=useState("");
  const[newLaborHours,setNewLaborHours]=useState("");
  const[newLaborRate,setNewLaborRate]=useState("");
  const[newLaborNotes,setNewLaborNotes]=useState("");
  const[newPartRepair,setNewPartRepair]=useState("");
  const[partSearch,setPartSearch]=useState("");
  const[partQty,setPartQty]=useState("1");
  const[partCost,setPartCost]=useState("");
  const[reopenReason,setReopenReason]=useState("");

  useEffect(()=>{
    setRepairTitles(Object.fromEntries(item.repairs.map(repair=>[repair.id,repair.issue])));
    setOutsideCosts(Object.fromEntries(item.repairs.map(repair=>[repair.id,String(Number(repair.outsideCost||0))])));
    setLaborDrafts(Object.fromEntries(item.laborEntries.map(entry=>[entry.id,{hours:String(entry.hours),rate:String(entry.rate),notes:entry.notes||entry.repairIssue}])));
    setPartDrafts(Object.fromEntries(item.usedParts.map(part=>[part.usageId,{quantity:String(part.quantity),unitCost:part.costRecorded?String(part.unitCost):""}])));
    const firstRepair=item.repairs[0]?.id??"";
    setNewLaborRepair(current=>item.repairs.some(repair=>repair.id===current)?current:firstRepair);
    setNewPartRepair(current=>item.repairs.some(repair=>repair.id===current)?current:firstRepair);
    setNewLaborRate(current=>current||String(Number(item.repairs[0]?.laborRate||defaultLaborRate||0)));
  },[item,defaultLaborRate]);

  async function post(key:string,action:string,body:Record<string,unknown>,success:string){
    setBusy(key);setMessage("");
    try{
      const response=await fetch("/api/work-orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})});
      const payload=await response.json() as {error?:string};
      if(!response.ok)throw new Error(payload.error||"Work order correction could not be saved.");
      setMessage(success);
      await onChanged();
    }catch(error){setMessage(error instanceof Error?error.message:"Work order correction could not be saved.");}
    finally{setBusy("");}
  }

  function selectedPart(){
    const text=partSearch.trim().toLowerCase();
    if(!text)return null;
    const exact=parts.find(part=>part.partNumber.toLowerCase()===text||partLabel(part).toLowerCase()===text);
    if(exact)return exact;
    const matches=parts.filter(part=>`${part.partNumber} ${part.description}`.toLowerCase().includes(text));
    return matches.length===1?matches[0]:null;
  }

  const selectedLaborRepair=useMemo(()=>item.repairs.find(repair=>repair.id===newLaborRepair)??item.repairs[0]??null,[item.repairs,newLaborRepair]);
  const laborSummaries=useMemo(()=>summarizeLabor(item.laborEntries),[item.laborEntries]);
  const datalistId=`wo-review-parts-${item.id.replace(/[^a-z0-9_-]/gi,"-")}`;

  return <>
    {message&&<div style={noticeStyle}>{message}</div>}

    <div style={{marginTop:12,border:"1px solid #dfe5e9",background:"white"}}>
      <div style={subheadStyle}><span>Repairs completed in this work order</span>{editable&&<span style={editHintStyle}>EDIT DESCRIPTION INLINE</span>}</div>
      {item.repairs.map(repair=>{
        const title=repairTitles[repair.id]??repair.issue;
        return <div key={repair.id} style={{display:"grid",gridTemplateColumns:editable?"110px minmax(320px,1fr) 110px":"110px 1fr 110px",gap:8,padding:"8px 10px",borderTop:"1px solid #edf0f2",fontSize:11,alignItems:"center"}}>
          <strong>{repair.id}</strong>
          {editable?<div style={{display:"flex",gap:6,alignItems:"center"}}><input value={title} onChange={event=>setRepairTitles(current=>({...current,[repair.id]:event.target.value}))} style={{...inputStyle,flex:1}}/><button type="button" disabled={Boolean(busy)||!title.trim()||title.trim()===repair.issue} onClick={()=>void post(`repair-${repair.id}`,"reviewUpdateRepairTitle",{repairId:repair.id,title:title.trim()},"Repair description updated.")} style={saveMiniStyle}>SAVE</button></div>:<span>{repair.issue}</span>}
          <span>{repair.status}</span>
        </div>;
      })}
    </div>

    <div style={{marginTop:12,display:"grid",gridTemplateColumns:"minmax(300px,1fr) minmax(560px,1.65fr)",gap:12}}>
      <div style={panelStyle}>
        <div style={subheadStyle}>Technician repair notes</div>
        {item.technicianNotes.length?item.technicianNotes.map(note=><div key={note.id} style={{padding:"8px 10px",borderTop:"1px solid #edf0f2",fontSize:11}}><div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{note.technician}</strong><span style={{color:"#7a858d"}}>{dateTime(note.createdAt)}</span></div><div style={{marginTop:4,color:"#263746",whiteSpace:"pre-wrap"}}>{note.detail}</div><small style={{display:"block",marginTop:4,color:"#7a858d"}}>{note.repairIssue}</small></div>):<div style={emptyStyle}>No technician repair notes were recorded.</div>}
      </div>

      <div style={panelStyle}>
        <div style={subheadStyle}><span>Labor by repair</span>{editable&&<span style={editHintStyle}>TIMER SEGMENTS KEPT BELOW FOR AUDIT / EDITING</span>}</div>
        {laborSummaries.length?laborSummaries.map(summary=><div key={summary.key} style={{display:"grid",gridTemplateColumns:"minmax(170px,1.3fr) 125px minmax(210px,1.25fr) 76px 88px 92px",gap:7,padding:"8px 9px",borderTop:"1px solid #edf0f2",fontSize:11,alignItems:"center"}}>
          <span><strong>{summary.repairIssue}</strong><small style={{display:"block",marginTop:2,color:"#7a858d"}}>{summary.repairId}{summary.segments>1?` · ${summary.segments} timer segments combined`:""}</small></span>
          <strong>{summary.technician}</strong><span><strong>{summary.laborDate}</strong><small style={{display:"block",marginTop:2,color:"#64748b"}}>{summary.timeRanges.length?summary.timeRanges.join(" · "):"No timer timestamp"}</small></span><span>{summary.hours.toFixed(2)} hr</span><span>{money(summary.rate)}/hr</span><strong>{money(summary.amount)}</strong>
        </div>):<div style={emptyStyle}>No labor entries recorded.</div>}

        {editable&&<>
          <div style={{...subheadStyle,borderTop:"1px solid #d8dee3"}}><span>Timer segments / audit detail</span><span style={editHintStyle}>EDIT HOURS / RATE / NOTE</span></div>
          {item.laborEntries.length?item.laborEntries.map(entry=>{
            const draft=laborDrafts[entry.id]??{hours:String(entry.hours),rate:String(entry.rate),notes:entry.notes||entry.repairIssue};
            const amount=Number(draft.hours||0)*Number(draft.rate||0);
            const changed=Number(draft.hours)!==Number(entry.hours)||Number(draft.rate)!==Number(entry.rate)||draft.notes!==(entry.notes||entry.repairIssue);
            const range=laborRange(entry);
            return <div key={`${entry.repairId}-${entry.id}`} style={{display:"grid",gridTemplateColumns:"150px 125px 72px 88px 92px minmax(150px,1fr) 116px",gap:7,padding:"7px 9px",borderTop:"1px solid #edf0f2",fontSize:11,alignItems:"center"}}>
              <span>{entry.laborDate}<small style={{display:"block",marginTop:2,color:"#64748b"}}>{range||"Manual / no timer timestamp"}</small></span><strong>{entry.technician}</strong>
              <input type="number" min="0.01" max="24" step="0.01" value={draft.hours} onChange={event=>setLaborDrafts(current=>({...current,[entry.id]:{...draft,hours:event.target.value}}))} style={compactInputStyle}/>
              <input type="number" min="0" step="0.01" value={draft.rate} onChange={event=>setLaborDrafts(current=>({...current,[entry.id]:{...draft,rate:event.target.value}}))} style={compactInputStyle}/>
              <strong>{money(amount)}</strong>
              <input value={draft.notes} onChange={event=>setLaborDrafts(current=>({...current,[entry.id]:{...draft,notes:event.target.value}}))} style={compactInputStyle}/>
              <div style={{display:"flex",gap:4}}><button type="button" disabled={Boolean(busy)||!changed} onClick={()=>void post(`labor-${entry.id}`,"reviewUpdateLabor",{entryId:entry.id,hours:Number(draft.hours),rate:Number(draft.rate),notes:draft.notes},"Labor entry updated.")} style={saveMiniStyle}>SAVE</button><button type="button" disabled={Boolean(busy)} onClick={()=>{if(confirm(`Remove ${entry.hours} hr labor entry for ${entry.technician}?`))void post(`labor-delete-${entry.id}`,"reviewDeleteLabor",{entryId:entry.id},"Labor entry removed.");}} style={dangerMiniStyle}>REMOVE</button></div>
            </div>;
          }):<div style={emptyStyle}>No timer segments recorded.</div>}

          <div style={addRowStyle}>
            <select value={newLaborRepair} onChange={event=>{setNewLaborRepair(event.target.value);const repair=item.repairs.find(row=>row.id===event.target.value);setNewLaborRate(String(Number(repair?.laborRate||defaultLaborRate||0)));}} style={inputStyle}>{item.repairs.map(repair=><option key={repair.id} value={repair.id}>{repair.id} — {repair.issue}</option>)}</select>
            <input type="number" min="0.01" max="24" step="0.01" value={newLaborHours} onChange={event=>setNewLaborHours(event.target.value)} placeholder="Hours" style={inputStyle}/>
            <input type="number" min="0" step="0.01" value={newLaborRate} onChange={event=>setNewLaborRate(event.target.value)} placeholder="Rate/hr" style={inputStyle}/>
            <input value={newLaborNotes} onChange={event=>setNewLaborNotes(event.target.value)} placeholder="Forgotten labor / manager note" style={inputStyle}/>
            <button type="button" disabled={Boolean(busy)||!selectedLaborRepair} onClick={()=>void post("add-labor","reviewAddLabor",{repairId:newLaborRepair,technicianId:selectedLaborRepair?.technicianId,hours:Number(newLaborHours),rate:Number(newLaborRate),notes:newLaborNotes.trim()},"Labor entry added.")} style={addButtonStyle}>+ ADD LABOR</button>
          </div>
        </>}
      </div>
    </div>

    <div style={{marginTop:12,display:"grid",gridTemplateColumns:"minmax(620px,2fr) minmax(320px,1fr)",gap:12}}>
      <div style={panelStyle}>
        <div style={subheadStyle}><span>Parts applied</span>{editable&&<span style={editHintStyle}>EDIT QTY / COST OR ADD MISSED PART</span>}</div>
        {item.usedParts.length?item.usedParts.map(part=>{
          const draft=partDrafts[part.usageId]??{quantity:String(part.quantity),unitCost:part.costRecorded?String(part.unitCost):""};
          const lineCost=Number(draft.quantity||0)*Number(draft.unitCost||0);
          const changed=Number(draft.quantity)!==Number(part.quantity)||Number(draft.unitCost||0)!==Number(part.unitCost||0)||(!part.costRecorded&&draft.unitCost!=="");
          return <div key={part.usageId} style={{display:"grid",gridTemplateColumns:editable?"105px minmax(190px,1fr) 76px 105px 100px 126px":"105px 1fr 60px 120px 100px",gap:8,padding:"7px 9px",borderTop:"1px solid #edf0f2",fontSize:11,alignItems:"center"}}>
            <strong>{part.partNumber}</strong><span>{part.description}<small style={{display:"block",color:"#7a858d"}}>{part.repairIssue}</small></span>
            {editable?<input type="number" min="0.01" step="0.01" value={draft.quantity} onChange={event=>setPartDrafts(current=>({...current,[part.usageId]:{...draft,quantity:event.target.value}}))} style={compactInputStyle}/>:<span>× {part.quantity}</span>}
            {editable?<input type="number" min="0" step="0.01" value={draft.unitCost} onChange={event=>setPartDrafts(current=>({...current,[part.usageId]:{...draft,unitCost:event.target.value}}))} placeholder="Unit cost" style={compactInputStyle}/>:<span>{part.costRecorded?`${money(part.unitCost)} ea.`:"Cost not recorded"}</span>}
            <strong>{part.costRecorded||draft.unitCost!==""?money(lineCost):"—"}</strong>
            {editable&&<div style={{display:"flex",gap:4}}><button type="button" disabled={Boolean(busy)||!changed} onClick={()=>void post(`part-${part.usageId}`,"reviewUpdatePart",{usageId:part.usageId,quantity:Number(draft.quantity),unitCost:Number(draft.unitCost)},"Part line updated.")} style={saveMiniStyle}>SAVE</button><button type="button" disabled={Boolean(busy)} onClick={()=>{if(confirm(`Remove ${part.partNumber} x${part.quantity} and return it to its recorded warehouse?`))void post(`part-delete-${part.usageId}`,"reviewRemovePart",{usageId:part.usageId},"Part removed and returned to stock.");}} style={dangerMiniStyle}>REMOVE</button></div>}
          </div>;
        }):<div style={emptyStyle}>No parts applied.</div>}

        {editable&&<div style={{...addRowStyle,gridTemplateColumns:"110px minmax(240px,1fr) 90px 120px 150px"}}>
          <select value={newPartRepair} onChange={event=>setNewPartRepair(event.target.value)} style={inputStyle}>{item.repairs.map(repair=><option key={repair.id} value={repair.id}>{repair.id}</option>)}</select>
          <div><input list={datalistId} value={partSearch} onChange={event=>setPartSearch(event.target.value)} placeholder="Forgotten part # or description" style={inputStyle}/><datalist id={datalistId}>{parts.map(part=><option key={part.id} value={partLabel(part)}>{part.quantityOnHand} available · {part.location}</option>)}</datalist></div>
          <input type="number" min="0.01" step="0.01" value={partQty} onChange={event=>setPartQty(event.target.value)} placeholder="Qty" style={inputStyle}/>
          <input type="number" min="0" step="0.01" value={partCost} onChange={event=>setPartCost(event.target.value)} placeholder="Unit cost" style={inputStyle}/>
          <button type="button" disabled={Boolean(busy)} onClick={()=>{const part=selectedPart();if(!part){setMessage("Choose one exact catalog part from the suggestions.");return;}void post("add-part","reviewAddPart",{repairId:newPartRepair,partId:part.id,quantity:Number(partQty),unitCost:partCost.trim()===""?undefined:Number(partCost)},"Forgotten part added.");}} style={addButtonStyle}>+ ADD PART</button>
        </div>}
      </div>

      <div style={panelStyle}>
        <div style={subheadStyle}><span>Cost summary</span>{editable&&<span style={editHintStyle}>OUTSIDE COST EDITABLE</span>}</div>
        <CostRow label="Labor" value={item.laborCost}/><CostRow label="Parts recorded" value={item.partCost}/>
        {editable?item.repairs.map(repair=>{
          const value=outsideCosts[repair.id]??String(Number(repair.outsideCost||0));
          const changed=Number(value)!==Number(repair.outsideCost||0);
          return <div key={repair.id} style={{display:"grid",gridTemplateColumns:"minmax(120px,1fr) 100px 55px",gap:6,alignItems:"center",padding:"7px 10px",borderTop:"1px solid #edf0f2",fontSize:11}}><span>Outside · {repair.id}</span><input type="number" min="0" step="0.01" value={value} onChange={event=>setOutsideCosts(current=>({...current,[repair.id]:event.target.value}))} style={compactInputStyle}/><button type="button" disabled={Boolean(busy)||!changed} onClick={()=>void post(`outside-${repair.id}`,"reviewSetOutsideCost",{repairId:repair.id,amount:Number(value)},"Outside/vendor cost updated.")} style={saveMiniStyle}>SAVE</button></div>;
        }):<CostRow label="Outside" value={item.outsideCost}/>} 
        <CostRow label={item.missingPartCostLines?"RECORDED TOTAL":"TOTAL"} value={item.totalCost} strong/>
        {item.missingPartCostLines>0&&<div style={{padding:10,borderTop:"1px solid #f2c66d",background:"#fff8e6",fontSize:10,color:"#8a5a00"}}>{item.missingPartCostLines} legacy part line{item.missingPartCostLines===1?" has":"s have"} no captured historical unit cost and are excluded from the recorded total.</div>}
      </div>
    </div>

    {item.reviewed&&<div style={reviewedStyle}>
      <div><strong>Reviewed by {item.reviewedBy||"manager"}</strong> · {dateTime(item.reviewedAt)}{item.reviewNote&&<div style={{marginTop:4}}>{item.reviewNote}</div>}</div>
      {canManage&&<div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}><input value={reopenReason} onChange={event=>setReopenReason(event.target.value)} placeholder="Reason to reopen for correction" style={{...inputStyle,minWidth:300}}/><button type="button" disabled={Boolean(busy)||!reopenReason.trim()} onClick={()=>void post("reopen","reopenWorkOrderReview",{repairIds:item.repairIds,reason:reopenReason.trim()},"Work order reopened for corrections.")} style={dangerButtonStyle}>REOPEN FOR CORRECTIONS</button></div>}
    </div>}
  </>;
}

function CostRow({label,value,strong=false}:{label:string;value:number;strong?:boolean}){return <div style={{display:"flex",justifyContent:"space-between",gap:10,padding:"8px 10px",borderTop:"1px solid #edf0f2",fontSize:11,fontWeight:strong?900:500}}><span>{label}</span><span>{money(value)}</span></div>;}

const inputStyle={minHeight:32,padding:"5px 7px",border:"1px solid #c7ced3",borderRadius:3,background:"white",color:"#263746",boxSizing:"border-box" as const,width:"100%"} as const;
const compactInputStyle={...inputStyle,minHeight:28,padding:"3px 5px"} as const;
const saveMiniStyle={minHeight:27,padding:"0 7px",border:"1px solid #176440",borderRadius:3,background:"#176440",color:"white",fontSize:9,fontWeight:900} as const;
const dangerMiniStyle={...saveMiniStyle,border:"1px solid #a0443c",background:"white",color:"#8a2f29"} as const;
const addButtonStyle={minHeight:32,padding:"0 9px",border:"1px solid #176440",borderRadius:3,background:"#176440",color:"white",fontSize:9,fontWeight:900} as const;
const dangerButtonStyle={minHeight:32,padding:"0 9px",border:"1px solid #92362f",borderRadius:3,background:"#92362f",color:"white",fontSize:9,fontWeight:900} as const;
const subheadStyle={padding:"7px 9px",background:"#eef1f2",color:"#59656e",fontSize:9,fontWeight:900,textTransform:"uppercase" as const,letterSpacing:".04em",display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"} as const;
const editHintStyle={fontSize:8,color:"#176440"} as const;
const panelStyle={border:"1px solid #e0e5e8",background:"white"} as const;
const emptyStyle={padding:10,borderTop:"1px solid #edf0f2",color:"#7a858d",fontSize:11} as const;
const addRowStyle={display:"grid",gridTemplateColumns:"minmax(180px,1.35fr) 85px 95px minmax(180px,1fr) 120px",gap:7,alignItems:"end",padding:"9px",borderTop:"1px solid #d9e5dc",background:"#f5faf7"} as const;
const noticeStyle={marginTop:10,padding:"8px 10px",border:"1px solid #e0c47a",background:"#fffaf0",fontSize:11} as const;
const reviewedStyle={marginTop:12,padding:10,border:"1px solid #b9d8c8",background:"#f1faf5",fontSize:11,display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"} as const;