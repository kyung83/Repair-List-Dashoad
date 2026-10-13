"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Assignment={
  equipmentId:number;unit:string;equipmentType:string;homeDriver:string;homeLocation:string;currentDriver:string;currentLocation:string;
  status:string;truckClass:string;flatbed:boolean;automatic:boolean;notes:string;coverageForEquipmentId:number|null;coverageForDriver:string;
  outOfService:boolean;outOfServiceReason:string;shopEta:string;openRepairCount:number;outsideRepairCount:number;repairState:string;readyToReturn:boolean;
  saleStatus:string;saleOffRoad:boolean;saleVersion:number;saleAskingPrice:number|null;saleNotes:string;saleListedAt:string;
};
type Swap={id:number;driver:string;homeEquipmentId:number;homeUnit:string;coverageEquipmentId:number;coverageUnit:string;workingLocation:string;serviceLocation:string;reason:string;coverageReturnPool:string;openedAt:string;repairClear:boolean;readyToReturn:boolean};
type EventRow={id:number;action:string;driver:string;from_location:string;to_location:string;detail:string;created_at:string;primary_unit:string;secondary_unit:string;by_name:string};
type SaleRecord={equipmentId:number;unit:string;status:string;askingPrice:number|null;notes:string;listedAt:string;offRoadAt:string|null;returnedToRoadAt:string|null;cancelledAt:string|null;soldAt:string|null;salePrice:number|null;buyer:string;version:number;location:string};
type SaleEvent={id:number;equipmentId:number;unit:string;action:string;from:string;to:string;details:string;driver:string;askingPrice:number|null;salePrice:number|null;buyer:string;when:string;by:string};
type Payload={permissions:{canOperate:boolean;canEditMaster:boolean};assignments:Assignment[];activeSwaps:Swap[];events:EventRow[];sales:SaleRecord[];saleEvents:SaleEvent[];summary:Record<string,number>;updatedAt:string;error?:string};
type RepairAudit={unit:string;equipmentId:number;records:Array<{id:number;title:string;status:string;kind:string;detail:string}>;truncated:boolean;error?:string};

const card:CSSProperties={background:"#fff",border:"1px solid #dbe3ea",borderRadius:14,boxShadow:"0 1px 2px rgba(15,23,42,.04)"};
const button:CSSProperties={border:"1px solid #cbd5e1",background:"#fff",color:"#0f172a",fontWeight:800,borderRadius:9,padding:"9px 13px",cursor:"pointer"};
const blue:CSSProperties={...button,background:"#0b6ff9",borderColor:"#0b6ff9",color:"#fff"};
const green:CSSProperties={...button,background:"#16a34a",borderColor:"#16a34a",color:"#fff"};
const orange:CSSProperties={...button,background:"#f97316",borderColor:"#f97316",color:"#fff"};
const input:CSSProperties={width:"100%",border:"1px solid #cbd5e1",borderRadius:9,padding:"9px 10px",fontSize:14,background:"#fff"};
const th:CSSProperties={textAlign:"left",padding:"9px 10px",fontSize:12,color:"#475569",borderBottom:"1px solid #dbe3ea",background:"#f8fafc",whiteSpace:"nowrap"};
const td:CSSProperties={padding:"9px 10px",fontSize:13,borderBottom:"1px solid #edf2f7",verticalAlign:"middle"};
const badge=(bg:string,color:string):CSSProperties=>({display:"inline-block",borderRadius:999,padding:"4px 9px",fontSize:11,fontWeight:850,background:bg,color,whiteSpace:"nowrap"});

function niceStatus(row:Assignment){
  if(row.saleOffRoad)return "Off Road";
  // Open repair records can belong to trucks still working their routes.
  // Only explicit fleet assignment state identifies a truck sent for service.
  if(row.status==="service")return row.readyToReturn?"Ready to Return":"At Service";
  if(row.outOfService)return "Out of Service";
  if(row.status==="coverage")return "Coverage Swap";
  if(row.status==="cleaning")return "Cleaning";
  if(row.status==="open")return "Open";
  if(row.status==="spare")return "Spare";
  return row.homeDriver&&row.currentDriver!==row.homeDriver?"Swapped":"Assigned";
}
function statusStyle(row:Assignment){
  const s=niceStatus(row);
  if(s==="Assigned")return badge("#dcfce7","#166534");
  if(s==="Open"||s==="Spare")return badge("#dbeafe","#1d4ed8");
  if(s==="Ready to Return")return badge("#dcfce7","#166534");
  if(s==="Out of Service"||s==="Off Road")return badge("#fee2e2","#b91c1c");
  if(s==="Cleaning")return badge("#ede9fe","#6d28d9");
  return badge("#ffedd5","#c2410c");
}
function dateTime(v:string){if(!v)return"—";const d=new Date(v.includes("T")?v:v.replace(" ","T")+"Z");return Number.isNaN(d.getTime())?v:d.toLocaleString();}
function same(a:string,b:string){return a.trim().toLowerCase()===b.trim().toLowerCase();}
function money(value:number|null){return value==null?"Not specified":value.toLocaleString("en-US",{style:"currency",currency:"USD"});}
function saleBadge(row:Assignment){
  if(row.saleOffRoad)return <span style={badge("#fee2e2","#991b1b")}>{row.saleStatus==="cancelled"?"Sale Cancelled · Still Off Road":"Off Road · Awaiting Sale"}</span>;
  if(row.saleStatus==="for_sale")return <span style={badge("#fef3c7","#92400e")}>For Sale · Still Working</span>;
  if(row.saleStatus==="cancelled")return <span style={badge("#e2e8f0","#475569")}>Sale Cancelled</span>;
  return null;
}

export default function TruckAssignmentsPage(){
  const[data,setData]=useState<Payload|null>(null),[tab,setTab]=useState<"board"|"master"|"activity"|"sales">("board"),[q,setQ]=useState(""),[location,setLocation]=useState("All"),[filter,setFilter]=useState("All"),[selectedId,setSelectedId]=useState<number|null>(null),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  const[swapHome,setSwapHome]=useState<number|null>(null),[swapCoverage,setSwapCoverage]=useState<number|null>(null),[swapReason,setSwapReason]=useState("PM / Repair"),[swapService,setSwapService]=useState("Clare"),[swapReturn,setSwapReturn]=useState("spare");
  const[edit,setEdit]=useState<Assignment|null>(null);
  const[managedId,setManagedId]=useState<number|null>(null);
  const[driverDraft,setDriverDraft]=useState("");
  const[locationDraft,setLocationDraft]=useState("");
  const[auditUnit,setAuditUnit]=useState<string|null>(null),[audit,setAudit]=useState<RepairAudit|null>(null);
  const[auditBusy,setAuditBusy]=useState(false),[auditError,setAuditError]=useState("");
  const[saleId,setSaleId]=useState<number|null>(null),[saleError,setSaleError]=useState("");
  const[askingDraft,setAskingDraft]=useState(""),[notesDraft,setNotesDraft]=useState("");
  const[priceDraft,setPriceDraft]=useState(""),[buyerDraft,setBuyerDraft]=useState(""),[dateDraft,setDateDraft]=useState(new Date().toISOString().slice(0,10));
  const[confirmParked,setConfirmParked]=useState(false),[confirmRoadworthy,setConfirmRoadworthy]=useState(false);
  const[confirmSold,setConfirmSold]=useState(false),[saleSearch,setSaleSearch]=useState("");

  async function load(){
    const r=await fetch("/api/truck-assignments",{cache:"no-store"}),j=await r.json() as Payload;
    if(!r.ok)throw new Error(j.error||"Truck assignments could not be loaded.");
    setData(j);
    setSelectedId(current=>current??j.assignments[0]?.equipmentId??null);
  }
  useEffect(()=>{void load().catch(e=>setMsg(e instanceof Error?e.message:"Truck assignments could not be loaded."));},[]);

  const rows=data?.assignments??[];
  const selected=rows.find(x=>x.equipmentId===selectedId)??null;
  const locations=useMemo(()=>["All",...Array.from(new Set(rows.flatMap(x=>[x.homeLocation,x.currentLocation]).map(x=>x.trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))],[rows]);
  const visible=useMemo(()=>rows.filter(row=>{
    if(location!=="All"&&!same(row.homeLocation,location)&&!same(row.currentLocation,location))return false;
    if(filter!=="All"){
      const s=niceStatus(row);
      if(filter==="Needs Truck"&&(row.currentDriver||row.saleOffRoad))return false;
      else if(filter==="In Service"&&row.status!=="service")return false;
      else if(filter==="Out of Service"&&!row.outOfService)return false;
      else if(filter==="For Sale"&&row.saleStatus!=="for_sale")return false;
      else if(filter==="Off Road"&&!row.saleOffRoad)return false;
      else if(filter==="Sale Cancelled"&&row.saleStatus!=="cancelled")return false;
      else if(filter==="Active Repairs"&&row.openRepairCount===0)return false;
      else if(filter==="Outside Repairs"&&row.outsideRepairCount===0)return false;
      else if(filter==="Open"&&!["Open","Spare"].includes(s))return false;
      else if(!["Needs Truck","In Service","Out of Service","For Sale","Off Road","Sale Cancelled","Active Repairs","Outside Repairs","Open"].includes(filter)&&s!==filter)return false;
    }
    const needle=q.trim().toLowerCase();if(!needle)return true;
    return [row.unit,row.homeDriver,row.currentDriver,row.homeLocation,row.currentLocation,row.truckClass,row.notes].some(v=>String(v).toLowerCase().includes(needle));
  }),[rows,location,filter,q]);

  const pool=rows.filter(x=>["open","spare"].includes(x.status)&&!x.currentDriver&&!x.outOfService&&!x.saleOffRoad&&x.openRepairCount===0&&x.outsideRepairCount===0);
  const activeSwapByHome=new Map((data?.activeSwaps??[]).map(x=>[x.homeEquipmentId,x]));
  const managed=rows.find(x=>x.equipmentId===managedId)??null;
  const managingActiveSwap=Boolean(managed&&(data?.activeSwaps??[]).some(x=>x.homeEquipmentId===managed.equipmentId||x.coverageEquipmentId===managed.equipmentId));
  const driverSuggestions=[...new Set(rows.flatMap(row=>[row.homeDriver,row.currentDriver]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  async function act(body:Record<string,unknown>):Promise<boolean>{
    setBusy(true);setMsg("");
    try{
      const r=await fetch("/api/truck-assignments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const j=await r.json() as {ok?:boolean;error?:string};
      if(!r.ok||!j.ok)throw new Error(j.error||"Change failed.");
      await load();setMsg("Saved.");return true;
    }catch(e){setMsg(e instanceof Error?e.message:"Change failed.");return false;}
    finally{setBusy(false);}
  }

  async function inspectRepairs(row:Assignment){
    setAuditUnit(row.unit);setAudit(null);setAuditError("");setAuditBusy(true);
    try{
      const response=await fetch("/api/truck-assignments?inspectEquipmentId="+encodeURIComponent(String(row.equipmentId)),{cache:"no-store"});
      const result=await response.json() as RepairAudit;
      if(!response.ok)throw new Error(result.error||"Could not load the repair records.");
      setAudit(result);
    }catch(error){setAuditError(error instanceof Error?error.message:"Could not load the repair records.");}
    finally{setAuditBusy(false);}
  }
  function openManage(row:Assignment){
    setSelectedId(row.equipmentId);
    setManagedId(row.equipmentId);
    setDriverDraft(row.currentDriver);
    setLocationDraft(row.currentLocation||row.homeLocation);
    setMsg("");
  }
  async function saveManagedDriver(){
    if(!managed)return;
    const ok=await act({action:"changeCurrentDriver",equipmentId:managed.equipmentId,driver:driverDraft.trim(),location:locationDraft.trim()});
    if(ok)setManagedId(null);
  }
  async function markManagedOpen(clearPermanent:boolean){
    if(!managed)return;
    const explanation=clearPermanent
      ? "Remove BOTH the permanent and current driver from truck "+managed.unit+" and mark it Open? This also clears the driver in Master Equipment."
      : "Release the current driver and mark truck "+managed.unit+" Open? Its permanent home-driver assignment will remain unchanged.";
    if(!window.confirm(explanation))return;
    const ok=await act({action:"markTruckOpen",equipmentId:managed.equipmentId,clearPermanent});
    if(ok)setManagedId(null);
  }

  const saleAssignment=rows.find(row=>row.equipmentId===saleId)??null;
  const saleRecord=(data?.sales??[]).find(row=>row.equipmentId===saleId)??null;
  const saleStatus=saleRecord?.status??saleAssignment?.saleStatus??"none";
  const saleHeld=Boolean(saleAssignment?.saleOffRoad||(saleRecord?.offRoadAt&&!saleRecord?.returnedToRoadAt));

  function openSale(row:Assignment|SaleRecord){
    const record=("saleStatus" in row)?(data?.sales??[]).find(sale=>sale.equipmentId===row.equipmentId):row;
    const asking=("saleStatus" in row)?row.saleAskingPrice:row.askingPrice;
    const notes=("saleStatus" in row)?row.saleNotes:row.notes;
    setSaleId(row.equipmentId);setManagedId(null);setSaleError("");
    setAskingDraft(asking==null?"":asking.toFixed(2));setNotesDraft(notes??"");
    setPriceDraft("");setBuyerDraft("");setDateDraft(new Date().toISOString().slice(0,10));
    setConfirmParked(false);setConfirmRoadworthy(false);setConfirmSold(false);
    if(record?.salePrice!=null)setPriceDraft(record.salePrice.toFixed(2));
    if(record?.buyer)setBuyerDraft(record.buyer);
  }
  async function saveSale(action:string,warning:string){
    if(!saleAssignment)return;
    if(!window.confirm(warning))return;
    setBusy(true);setSaleError("");setMsg("");
    try{
      const body={
        action,equipmentId:saleAssignment.equipmentId,expectedVersion:saleAssignment.saleVersion,
        askingPrice:askingDraft,notes:notesDraft,
        salePrice:priceDraft,buyer:buyerDraft,saleDate:dateDraft,
        confirmDriverRelease:confirmParked,confirmRoadworthy,confirmSaleFinal:confirmSold,
      };
      const response=await fetch("/api/truck-assignments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as {ok?:boolean;error?:string;message?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Truck sale change failed.");
      await load();setSaleId(null);setMsg(result.message||"Truck sale updated.");
    }catch(error){setSaleError(error instanceof Error?error.message:"Truck sale change failed.");}
    finally{setBusy(false);}
  }

  function openSwap(home:number){setSwapHome(home);setSelectedId(home);const row=rows.find(x=>x.equipmentId===home);setSwapCoverage(pool.find(x=>x.equipmentId!==home)?.equipmentId??null);setSwapService("Clare");setSwapReason("PM / Repair");setSwapReturn("spare");}
  async function startSwap(){
    const home=rows.find(x=>x.equipmentId===swapHome),coverage=rows.find(x=>x.equipmentId===swapCoverage);
    if(!home||!coverage)return;
    await act({action:"startCoverageSwap",homeEquipmentId:home.equipmentId,coverageEquipmentId:coverage.equipmentId,driver:home.homeDriver||home.currentDriver,workingLocation:home.homeLocation||home.currentLocation,serviceLocation:swapService,reason:swapReason,coverageReturnPool:swapReturn});
    setSwapHome(null);
  }
  function editMaster(row:Assignment){setEdit({...row});}
  async function saveMaster(){
    if(!edit)return;
    const ok=await act({action:"updateMaster",equipmentId:edit.equipmentId,homeDriver:edit.homeDriver,homeLocation:edit.homeLocation,status:edit.homeDriver?"assigned":edit.status==="spare"?"spare":"open",truckClass:edit.truckClass,flatbed:edit.flatbed,automatic:edit.automatic,notes:edit.notes});
    if(ok)setEdit(null);
  }

  return <main className="easy-page"><div style={{maxWidth:1680,margin:"0 auto"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:14,flexWrap:"wrap"}}>
      <div><p className="easy-eyebrow">FLEET OPERATIONS</p><h1 className="easy-title">Truck Assignments</h1><p className="easy-subtitle">Permanent truck ownership stays intact while daily swaps, repairs, sale listings, off-road holds and sold trucks are tracked separately.</p></div>
      <a href="/repair-board" style={{...button,textDecoration:"none"}}>Open Repair Board</a>
    </header>
    {msg&&<div className="easy-notice" style={{marginTop:14}}>{msg}</div>}

    <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,marginTop:16}}>
      {[
        ["Long-Term",data?.summary.assigned??0,"#e8f5ec","#167a3e"],
        ["Open Trucks",data?.summary.open??0,"#e9f2ff","#145fd0"],
        ["Spare Trucks",data?.summary.spare??0,"#f0ebff","#6d28d9"],
        ["Active Swaps",data?.summary.coverage??0,"#fff0df","#c45a05"],
        ["In Service",data?.summary.service??0,"#fce8e8","#b42318"],
        ["Ready to Return",data?.summary.readyToReturn??0,"#e7f7ee","#15803d"],
        ["For Sale",data?.summary.forSale??0,"#fef3c7","#92400e"],
        ["Off Road",data?.summary.offRoad??0,"#fee2e2","#991b1b"],
        ["Sold",data?.summary.sold??0,"#e2e8f0","#334155"],
      ].map(([label,value,bg,color])=><div key={String(label)} style={{...card,padding:"13px 15px",background:String(bg)}}><div style={{fontSize:26,fontWeight:950,color:String(color)}}>{value}</div><div style={{fontSize:12,fontWeight:850,color:"#334155"}}>{label}</div></div>)}
    </section>

    <div style={{display:"flex",gap:8,marginTop:16,borderBottom:"1px solid #dbe3ea"}}>
      {([["board","Assignment Board"],["master","Master Assignments"],["activity","Moves & History"],["sales","Sales & History"]] as const).map(([key,label])=><button key={key} onClick={()=>setTab(key)} style={{...button,border:"none",borderRadius:"9px 9px 0 0",background:tab===key?"#0b6ff9":"transparent",color:tab===key?"#fff":"#334155"}}>{label}</button>)}
    </div>

    {tab==="board"&&<>
      <section style={{...card,padding:12,marginTop:14,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <select value={location} onChange={e=>setLocation(e.target.value)} style={{...input,width:180}}>{locations.map(x=><option key={x}>{x}</option>)}</select>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{...input,width:170}}>{["All","Assigned","Coverage Swap","In Service","Out of Service","Active Repairs","Outside Repairs","Ready to Return","Open","Needs Truck","Cleaning"].map(x=><option key={x}>{x}</option>)}</select>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search driver, truck, terminal..." style={{...input,maxWidth:360,flex:"1 1 260px"}}/>
        <button style={button} onClick={()=>void load()} disabled={busy}>Refresh</button>
      </section>

      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 360px",gap:14,marginTop:14,alignItems:"start"}}>
        <section style={{...card,overflow:"hidden"}}>
          <div style={{padding:"12px 14px",fontWeight:900,fontSize:17}}>Drivers & Truck Assignments</div>
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <thead><tr>{["Driver","Home Truck","Current Truck","Truck Location","Status","Active / Outside Repairs","Action"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{visible.map(row=>{
              const active=activeSwapByHome.get(row.equipmentId);
              return <tr key={row.equipmentId} onClick={()=>setSelectedId(row.equipmentId)} style={{background:selectedId===row.equipmentId?"#f8fbff":"#fff",cursor:"pointer"}}>
                <td style={td}><strong>{row.homeDriver||row.currentDriver||"— OPEN —"}</strong><div style={{fontSize:11,color:"#64748b"}}>{row.homeLocation||"No home terminal"}</div></td>
                <td style={td}><strong>{row.unit}</strong></td>
                <td style={td}><strong>{active?active.coverageUnit:row.currentDriver?row.unit:"—"}</strong></td>
                <td style={td}>{active?active.workingLocation:row.currentLocation||"—"}</td>
                <td style={td}><div style={{display:"grid",justifyItems:"start",gap:5}}><span style={statusStyle(row)}>{niceStatus(row)}</span>{saleBadge(row)}</div></td>
                <td style={td}><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {row.outOfService&&<span style={badge("#fee2e2","#b91c1c")}>OOS</span>}
                  {row.openRepairCount>0&&<button type="button" onClick={e=>{e.stopPropagation();void inspectRepairs(row);}} title="View Active Repairs" style={{...badge("#fff7ed","#9a3412"),border:0,cursor:"pointer"}}>{row.openRepairCount} Active</button>}
                  {row.outsideRepairCount>0&&<button type="button" onClick={e=>{e.stopPropagation();void inspectRepairs(row);}} title="View Outside Repairs" style={{...badge("#e0f2fe","#075985"),border:0,cursor:"pointer"}}>{row.outsideRepairCount} Outside</button>}
                  {!row.outOfService&&row.openRepairCount===0&&row.outsideRepairCount===0&&<span style={badge("#ecfdf5","#047857")}>Clear</span>}
                </div></td>
                <td style={td}><button style={{...button,padding:"6px 10px"}} onClick={e=>{e.stopPropagation();openManage(row);}}>Manage</button></td>
              </tr>
            })}</tbody>
          </table></div>
        </section>

        <aside style={{display:"grid",gap:12}}>
          <section style={{...card,padding:14}}>
            <h2 style={{fontSize:17,margin:"0 0 10px"}}>Quick Actions</h2>
            {!selected?<p style={{color:"#64748b"}}>Select a truck.</p>:<>
              <div style={{background:"#f8fafc",borderRadius:10,padding:11,marginBottom:10}}>
                <strong style={{fontSize:17}}>Truck {selected.unit}</strong>
                <div style={{fontSize:13,marginTop:4}}>{selected.homeDriver||"Open / no permanent driver"}</div>
                <div style={{fontSize:12,color:"#64748b",marginTop:3}}>Home: {selected.homeLocation||"—"} · Current: {selected.currentLocation||"—"}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {selected.homeDriver&&!activeSwapByHome.has(selected.equipmentId)&&<button style={blue} onClick={()=>openSwap(selected.equipmentId)} disabled={busy}>Start Coverage Swap</button>}
                {!selected.currentDriver&&["open","spare"].includes(selected.status)&&<button style={green} onClick={()=>{const d=prompt("Driver name");if(d){const l=prompt("Driver / truck location",selected.currentLocation||selected.homeLocation)||selected.currentLocation;void act({action:"assignOpenTruck",equipmentId:selected.equipmentId,driver:d,location:l});}}} disabled={busy}>Assign Truck</button>}
                <button style={button} onClick={()=>{const l=prompt("Move truck to",selected.currentLocation||selected.homeLocation);if(l)void act({action:"moveTruck",equipmentId:selected.equipmentId,toLocation:l,reason:"Dispatcher move"});}} disabled={busy}>Move Truck</button>
                <button style={button} onClick={()=>{if(!selected.currentDriver&&!selected.homeDriver)void act({action:"setPoolStatus",equipmentId:selected.equipmentId,status:"open",currentLocation:selected.currentLocation});else openManage(selected);}} disabled={busy}>Mark Open</button>
                {!selected.currentDriver&&<button style={button} onClick={()=>void act({action:"setPoolStatus",equipmentId:selected.equipmentId,status:"spare",currentLocation:selected.currentLocation})} disabled={busy}>Mark Spare</button>}
                {!selected.currentDriver&&<button style={orange} onClick={()=>void act({action:"setPoolStatus",equipmentId:selected.equipmentId,status:"cleaning",currentLocation:selected.currentLocation})} disabled={busy}>Needs Cleaning</button>}
              </div>
              {(selected.outOfService||selected.openRepairCount>0||selected.outsideRepairCount>0)&&<div style={{marginTop:10,padding:10,borderRadius:9,background:"#fff7ed",fontSize:12,color:"#92400e"}}>
                <strong>Truck repair status:</strong> {selected.outOfService?"Out of service. ":""}
                {selected.openRepairCount} Active Repair(s) · {selected.outsideRepairCount} Outside Repair(s).
                An active repair does not mean the truck is physically in the shop. These jobs must be cleared before using the truck as coverage.
              </div>}
              <button type="button" style={{...button,width:"100%",marginTop:9}} onClick={()=>void inspectRepairs(selected)}>View Active & Outside Repair Records</button>
            </>}
          </section>

          <section style={{...card,padding:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h2 style={{fontSize:17,margin:0}}>Active Swaps</h2><span style={badge("#ffedd5","#c2410c")}>{data?.activeSwaps.length??0}</span></div>
            <div style={{display:"grid",gap:8,marginTop:10}}>
              {(data?.activeSwaps??[]).slice(0,6).map(s=><div key={s.id} style={{border:"1px solid #e2e8f0",borderRadius:10,padding:10}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{s.driver}</strong><span style={s.readyToReturn?badge("#dcfce7","#166534"):badge("#ffedd5","#c2410c")}>{s.readyToReturn?"Ready to Return":"Active"}</span></div>
                <div style={{fontSize:12,marginTop:5}}>Home {s.homeUnit} → Clare/service</div><div style={{fontSize:12}}>Coverage {s.coverageUnit} → {s.workingLocation}</div>
                {s.readyToReturn
                  ? <button style={{...green,width:"100%",marginTop:8}} disabled={busy} onClick={()=>void act({action:"completeCoverageSwap",swapId:s.id})}>Return {s.homeUnit} to {s.driver}</button>
                  : s.repairClear
                    ? <button style={{...button,width:"100%",marginTop:8}} disabled={busy} onClick={()=>void act({action:"markCoverageReady",swapId:s.id})}>Mark {s.homeUnit} Ready to Return</button>
                    : <div style={{fontSize:11,color:"#b45309",marginTop:7}}>Waiting on Repair Board / OOS clearance.</div>}
              </div>)}
              {!data?.activeSwaps.length&&<div style={{fontSize:13,color:"#64748b"}}>No active coverage swaps.</div>}
            </div>
          </section>
        </aside>
      </div>

      <section style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:14,marginTop:14}}>
        <div style={{...card,overflow:"hidden"}}><div style={{padding:"11px 13px",fontWeight:900}}>Open / Spare Trucks</div><table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{pool.slice(0,7).map(x=><tr key={x.equipmentId}><td style={td}><strong>{x.unit}</strong></td><td style={td}>{x.currentLocation||x.homeLocation||"—"}</td><td style={td}><span style={badge("#dbeafe","#1d4ed8")}>{x.status}</span></td></tr>)}</tbody></table></div>
        <div style={{...card,overflow:"hidden"}}><div style={{padding:"11px 13px",fontWeight:900}}>Service / Cleaning / OOS</div><table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{rows.filter(x=>x.outOfService||x.status==="service"||x.status==="cleaning").slice(0,7).map(x=><tr key={x.equipmentId}><td style={td}><strong>{x.unit}</strong></td><td style={td}>{x.currentLocation||"—"}</td><td style={td}>{niceStatus(x)}</td></tr>)}</tbody></table></div>
        <div style={{...card,overflow:"hidden"}}><div style={{padding:"11px 13px",fontWeight:900}}>Recent Moves & Swaps</div><table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{(data?.events??[]).slice(0,7).map(x=><tr key={x.id}><td style={{...td,width:84,fontSize:11}}>{dateTime(x.created_at).split(",")[0]}</td><td style={td}>{x.detail}</td></tr>)}</tbody></table></div>
      </section>
    </>}

    {tab==="master"&&<section style={{...card,overflow:"hidden",marginTop:14}}>
      <div style={{padding:"13px 14px",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div><h2 style={{margin:0,fontSize:18}}>Master Assignments</h2><p style={{margin:"4px 0 0",fontSize:12,color:"#64748b"}}>This is the permanent truck-to-driver memory. Temporary swaps never change this list.</p></div>
        {!data?.permissions.canEditMaster&&<span style={badge("#f1f5f9","#475569")}>View only for dispatch</span>}
      </div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:1050}}><thead><tr>{["Truck","Permanent Driver","Home Terminal","Class","Auto","Flatbed","Current Driver","Current Location","Status","Notes",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{visible.map(row=><tr key={row.equipmentId}>
        <td style={td}><strong>{row.unit}</strong></td><td style={td}>{row.homeDriver||"OPEN"}</td><td style={td}>{row.homeLocation||"—"}</td><td style={td}>{row.truckClass||"—"}</td><td style={td}>{row.automatic?"Yes":"No"}</td><td style={td}>{row.flatbed?"Yes":"No"}</td><td style={td}>{row.currentDriver||"—"}</td><td style={td}>{row.currentLocation||"—"}</td><td style={td}><div style={{display:"grid",gap:3}}>{niceStatus(row)}{saleBadge(row)}</div></td><td style={{...td,maxWidth:240}}>{row.notes||"—"}</td><td style={td}>{data?.permissions.canEditMaster&&<button style={{...button,padding:"6px 9px"}} onClick={()=>editMaster(row)}>Edit</button>}</td>
      </tr>)}</tbody></table></div>
    </section>}

    {tab==="activity"&&<section style={{...card,overflow:"hidden",marginTop:14}}>
      <div style={{padding:"13px 14px"}}><h2 style={{margin:0,fontSize:18}}>Assignment History</h2><p style={{margin:"4px 0 0",fontSize:12,color:"#64748b"}}>Every permanent change, swap, move, cleaning status and return is logged.</p></div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}><thead><tr>{["When","Type","Driver","Truck(s)","Move","Details","By"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{(data?.events??[]).map(x=><tr key={x.id}><td style={td}>{dateTime(x.created_at)}</td><td style={td}>{x.action.replaceAll("_"," ")}</td><td style={td}>{x.driver||"—"}</td><td style={td}>{[x.primary_unit,x.secondary_unit].filter(Boolean).join(" / ")||"—"}</td><td style={td}>{x.from_location&&x.to_location?`${x.from_location} → ${x.to_location}`:"—"}</td><td style={td}>{x.detail}</td><td style={td}>{x.by_name}</td></tr>)}</tbody></table></div>
    </section>}


    {auditUnit!==null&&<div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.55)",display:"grid",placeItems:"center",padding:14,zIndex:1100}} onMouseDown={()=>setAuditUnit(null)}>
      <section role="dialog" aria-modal="true" aria-label={`Repair records for truck ${auditUnit}`} style={{...card,width:"min(880px,96vw)",maxHeight:"90vh",overflowY:"auto",padding:18}} onMouseDown={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
          <div><h2 style={{margin:"0 0 5px"}}>Truck {auditUnit} · Active & Outside Repairs</h2>
            <p style={{fontSize:13,color:"#64748b",margin:0}}>Only jobs from the Active Repairs and Outside Repairs queues are counted here.</p></div>
          <button type="button" style={button} onClick={()=>setAuditUnit(null)}>Close</button>
        </div>
        {auditBusy&&<p>Loading the repair records…</p>}
        {auditError&&<p role="alert" style={{color:"#b91c1c"}}>{auditError}</p>}
        {audit&&audit.records.length===0&&<p>No Active Repairs or Outside Repairs recorded for this truck. Deferred work, roadside breakdowns, and completed jobs do not count.</p>}
        {audit&&audit.records.length>0&&<div style={{overflowX:"auto",marginTop:14}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:660}}>
          <thead><tr>{["Repair #","Repair / Description","Queue","Status","Details"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{audit.records.map(record=><tr key={`${record.kind}-${record.id}`}>
            <td style={td}><strong>#{record.id}</strong></td><td style={td}>{record.title||"Untitled repair"}</td>
            <td style={td}>{record.kind}</td><td style={td}>{record.status}</td><td style={td}>{record.detail}</td>
          </tr>)}</tbody>
        </table></div>}
        {audit?.truncated&&<p style={{fontSize:12,color:"#92400e"}}>Showing the latest 100 records per repair queue.</p>}
        <div style={{display:"flex",gap:8,marginTop:16,flexWrap:"wrap"}}>
          <a style={{...button,textDecoration:"none"}} href="/repair-board">Open Active Repairs</a>
          <a style={{...button,textDecoration:"none"}} href="/outside-work">Open Outside Repairs</a>
        </div>
      </section>
    </div>}

    {managed&&<div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.54)",display:"grid",placeItems:"center",padding:14,zIndex:1000}} onMouseDown={()=>!busy&&setManagedId(null)}>
      <div role="dialog" aria-modal="true" aria-label={`Manage truck ${managed.unit}`} style={{...card,width:"min(630px,96vw)",padding:20,maxHeight:"92vh",overflowY:"auto"}} onMouseDown={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
          <div><h2 style={{margin:"0 0 4px"}}>Manage Truck {managed.unit}</h2><p style={{margin:0,fontSize:13,color:"#64748b"}}>Choose a driver change or release the truck to Open.</p></div>
          <button type="button" style={{...button,padding:"6px 11px"}} onClick={()=>setManagedId(null)} disabled={busy} aria-label="Close truck manager">✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,background:"#f8fafc",padding:12,borderRadius:10,marginTop:15}}>
          <div><div style={{fontSize:11,color:"#64748b"}}>Permanent driver</div><strong>{managed.homeDriver||"None"}</strong></div>
          <div><div style={{fontSize:11,color:"#64748b"}}>Current driver</div><strong>{managed.currentDriver||"Open / unassigned"}</strong></div>
          <div><div style={{fontSize:11,color:"#64748b"}}>Current location</div><strong>{managed.currentLocation||"—"}</strong></div>
          <div><div style={{fontSize:11,color:"#64748b"}}>Truck status</div><strong>{niceStatus(managed)}</strong></div>
        </div>
        {managingActiveSwap&&<p role="alert" style={{padding:10,background:"#fff7ed",color:"#9a3412",borderRadius:8,fontSize:13}}>This truck is in an active coverage swap. Complete that swap using the existing return process before changing the driver or marking it Open.</p>}
        <h3 style={{margin:"18px 0 8px",fontSize:16}}>Change Current Driver</h3>
        <p style={{fontSize:12,color:"#64748b",margin:"0 0 10px"}}>For temporary driver changes. The permanent home-driver assignment stays as it is.</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10}}>
          <label style={{fontSize:13,fontWeight:700}}>Current driver
            <input list="assignment-driver-suggestions" autoComplete="off" style={{...input,marginTop:5}} value={driverDraft} onChange={e=>setDriverDraft(e.target.value)} placeholder="Search or enter a driver"/>
          </label>
          <label style={{fontSize:13,fontWeight:700}}>Truck location
            <input style={{...input,marginTop:5}} value={locationDraft} onChange={e=>setLocationDraft(e.target.value)} placeholder="Current terminal"/>
          </label>
        </div>
        <datalist id="assignment-driver-suggestions">{driverSuggestions.map(driver=><option key={driver} value={driver}/>)}</datalist>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap",marginTop:10}}>
          {data?.permissions.canEditMaster&&<button type="button" style={button} disabled={busy} onClick={()=>{setManagedId(null);editMaster(managed);}}>Edit Permanent Driver</button>}
          <button type="button" style={blue} disabled={busy||managingActiveSwap||!driverDraft.trim()} onClick={()=>void saveManagedDriver()}>{busy?"Saving…":"Save Current Driver"}</button>
        </div>
        <div style={{borderTop:"1px solid #e2e8f0",marginTop:18,paddingTop:15}}>
          <h3 style={{margin:"0 0 7px",fontSize:16}}>Make This Truck Open</h3>
          <p style={{fontSize:12,color:"#64748b",margin:"0 0 10px"}}>Release a truck even when the scheduler still shows the former driver. A permanent removal also clears the driver in Master Equipment.</p>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button type="button" style={button} disabled={busy||managingActiveSwap} onClick={()=>void markManagedOpen(false)}>Release Current Driver Only</button>
            {data?.permissions.canEditMaster&&<button type="button" style={{...orange,background:"#b91c1c",borderColor:"#b91c1c"}} disabled={busy||managingActiveSwap} onClick={()=>void markManagedOpen(true)}>Remove Driver Permanently & Mark Open</button>}
          </div>
          {!data?.permissions.canEditMaster&&<p style={{fontSize:12,color:"#64748b",margin:"10px 0 0"}}>Dispatch can mark the truck Open temporarily. A manager must remove the permanent driver assignment.</p>}
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:14}}>
          <button type="button" style={button} disabled={busy} onClick={()=>setManagedId(null)}>Close</button>
        </div>
      </div>
    </div>}

    {swapHome&&<div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.48)",display:"grid",placeItems:"center",padding:18,zIndex:1000}} onMouseDown={()=>setSwapHome(null)}>
      <div style={{...card,width:"min(620px,96vw)",padding:18}} onMouseDown={e=>e.stopPropagation()}>
        <h2 style={{marginTop:0}}>Start Clare Coverage Swap</h2>
        <p style={{fontSize:13,color:"#64748b"}}>Send a coverage truck from Clare/your spare pool to the driver, bring the driver's permanent truck in for service, then return that same truck to the same driver when Repair Board work is clear.</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <label>Home truck<input value={rows.find(x=>x.equipmentId===swapHome)?.unit||""} disabled style={input}/></label>
          <label>Coverage truck<select value={swapCoverage??""} onChange={e=>setSwapCoverage(Number(e.target.value)||null)} style={input}><option value="">Choose...</option>{pool.filter(x=>x.equipmentId!==swapHome).map(x=><option value={x.equipmentId} key={x.equipmentId}>{x.unit} · {x.currentLocation||x.homeLocation||"No location"} · {x.automatic?"Auto":"Manual"}</option>)}</select></label>
          <label>Service location<input value={swapService} onChange={e=>setSwapService(e.target.value)} style={input}/></label>
          <label>Reason<input value={swapReason} onChange={e=>setSwapReason(e.target.value)} style={input}/></label>
          <label>Coverage returns to<select value={swapReturn} onChange={e=>setSwapReturn(e.target.value)} style={input}><option value="spare">Spare pool</option><option value="open">Open trucks</option></select></label>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><button style={button} onClick={()=>setSwapHome(null)}>Cancel</button><button style={blue} disabled={busy||!swapCoverage} onClick={()=>void startSwap()}>{busy?"Saving…":"Start Coverage Swap"}</button></div>
      </div>
    </div>}

    {edit&&<div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.48)",display:"grid",placeItems:"center",padding:18,zIndex:1000}} onMouseDown={()=>setEdit(null)}>
      <div style={{...card,width:"min(680px,96vw)",padding:18}} onMouseDown={e=>e.stopPropagation()}>
        <h2 style={{marginTop:0}}>Edit Master Assignment · Truck {edit.unit}</h2>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <label>Permanent driver<input value={edit.homeDriver} onChange={e=>setEdit({...edit,homeDriver:e.target.value})} style={input}/></label>
          <label>Home terminal<input value={edit.homeLocation} onChange={e=>setEdit({...edit,homeLocation:e.target.value})} style={input}/></label>
          <label>Truck class<input value={edit.truckClass} onChange={e=>setEdit({...edit,truckClass:e.target.value})} placeholder="DC / BT / other" style={input}/></label>
          <label style={{display:"flex",gap:14,alignItems:"center",paddingTop:24}}><span><input type="checkbox" checked={edit.automatic} onChange={e=>setEdit({...edit,automatic:e.target.checked})}/> Automatic</span><span><input type="checkbox" checked={edit.flatbed} onChange={e=>setEdit({...edit,flatbed:e.target.checked})}/> Flatbed</span></label>
          <label style={{gridColumn:"1 / -1"}}>Scheduler notes<textarea value={edit.notes} onChange={e=>setEdit({...edit,notes:e.target.value})} style={{...input,minHeight:88}}/></label>
        </div>
        <div style={{fontSize:12,color:"#64748b",marginTop:10}}>Changing this updates the permanent master assignment only. Active coverage swaps keep their temporary current assignment until returned.</div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}><button style={button} onClick={()=>setEdit(null)}>Cancel</button><button style={blue} disabled={busy} onClick={()=>void saveMaster()}>{busy?"Saving…":"Save Master Assignment"}</button></div>
      </div>
    </div>}
  </div></main>;
}
