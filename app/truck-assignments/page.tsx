"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Assignment={
  equipmentId:number;unit:string;equipmentType:string;homeDriver:string;homeLocation:string;currentDriver:string;currentLocation:string;
  status:string;truckClass:string;flatbed:boolean;automatic:boolean;notes:string;coverageForEquipmentId:number|null;coverageForDriver:string;
  outOfService:boolean;outOfServiceReason:string;shopEta:string;openRepairCount:number;repairState:string;readyToReturn:boolean;
};
type Swap={id:number;driver:string;homeEquipmentId:number;homeUnit:string;coverageEquipmentId:number;coverageUnit:string;workingLocation:string;serviceLocation:string;reason:string;coverageReturnPool:string;openedAt:string;repairClear:boolean;readyToReturn:boolean};
type EventRow={id:number;action:string;driver:string;from_location:string;to_location:string;detail:string;created_at:string;primary_unit:string;secondary_unit:string;by_name:string};
type Payload={permissions:{canOperate:boolean;canEditMaster:boolean};assignments:Assignment[];activeSwaps:Swap[];events:EventRow[];summary:Record<string,number>;updatedAt:string;error?:string};

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
  if(row.outOfService||row.openRepairCount>0)return "In Shop";
  if(row.status==="coverage")return "Coverage Swap";
  if(row.status==="service")return row.readyToReturn?"Ready to Return":"At Clare / Service";
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
  if(s==="In Shop")return badge("#fee2e2","#b91c1c");
  if(s==="Cleaning")return badge("#ede9fe","#6d28d9");
  return badge("#ffedd5","#c2410c");
}
function dateTime(v:string){if(!v)return"—";const d=new Date(v.includes("T")?v:v.replace(" ","T")+"Z");return Number.isNaN(d.getTime())?v:d.toLocaleString();}
function same(a:string,b:string){return a.trim().toLowerCase()===b.trim().toLowerCase();}

export default function TruckAssignmentsPage(){
  const[data,setData]=useState<Payload|null>(null),[tab,setTab]=useState<"board"|"master"|"activity">("board"),[q,setQ]=useState(""),[location,setLocation]=useState("All"),[filter,setFilter]=useState("All"),[selectedId,setSelectedId]=useState<number|null>(null),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  const[swapHome,setSwapHome]=useState<number|null>(null),[swapCoverage,setSwapCoverage]=useState<number|null>(null),[swapReason,setSwapReason]=useState("PM / Repair"),[swapService,setSwapService]=useState("Clare"),[swapReturn,setSwapReturn]=useState("spare");
  const[edit,setEdit]=useState<Assignment|null>(null);

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
      if(filter==="Needs Truck"&&row.currentDriver)return false;
      else if(filter==="In Shop"&&s!=="In Shop"&&s!=="At Clare / Service"&&s!=="Ready to Return")return false;
      else if(filter==="Open"&&!["Open","Spare"].includes(s))return false;
      else if(!["Needs Truck","In Shop","Open"].includes(filter)&&s!==filter)return false;
    }
    const needle=q.trim().toLowerCase();if(!needle)return true;
    return [row.unit,row.homeDriver,row.currentDriver,row.homeLocation,row.currentLocation,row.truckClass,row.notes].some(v=>String(v).toLowerCase().includes(needle));
  }),[rows,location,filter,q]);

  const pool=rows.filter(x=>["open","spare"].includes(x.status)&&!x.currentDriver&&!x.outOfService&&x.openRepairCount===0);
  const activeSwapByHome=new Map((data?.activeSwaps??[]).map(x=>[x.homeEquipmentId,x]));
  async function act(body:Record<string,unknown>){
    setBusy(true);setMsg("");
    try{
      const r=await fetch("/api/truck-assignments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const j=await r.json() as {ok?:boolean;error?:string};
      if(!r.ok||!j.ok)throw new Error(j.error||"Change failed.");
      await load();setMsg("Saved.");
    }catch(e){setMsg(e instanceof Error?e.message:"Change failed.");}
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
    await act({action:"updateMaster",equipmentId:edit.equipmentId,homeDriver:edit.homeDriver,homeLocation:edit.homeLocation,status:edit.homeDriver?"assigned":edit.status==="spare"?"spare":"open",truckClass:edit.truckClass,flatbed:edit.flatbed,automatic:edit.automatic,notes:edit.notes});
    setEdit(null);
  }

  return <main className="easy-page"><div style={{maxWidth:1680,margin:"0 auto"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:14,flexWrap:"wrap"}}>
      <div><p className="easy-eyebrow">FLEET OPERATIONS</p><h1 className="easy-title">Truck Assignments</h1><p className="easy-subtitle">Permanent truck ownership stays intact while daily swaps, moves, repair coverage, cleaning and open trucks are handled separately.</p></div>
      <a href="/repair-board" style={{...button,textDecoration:"none"}}>Open Repair Board</a>
    </header>
    {msg&&<div className="easy-notice" style={{marginTop:14}}>{msg}</div>}

    <section style={{display:"grid",gridTemplateColumns:"repeat(6,minmax(130px,1fr))",gap:10,marginTop:16}}>
      {[
        ["Long-Term",data?.summary.assigned??0,"#e8f5ec","#167a3e"],
        ["Open Trucks",data?.summary.open??0,"#e9f2ff","#145fd0"],
        ["Spare Trucks",data?.summary.spare??0,"#f0ebff","#6d28d9"],
        ["Active Swaps",data?.summary.coverage??0,"#fff0df","#c45a05"],
        ["In Service",data?.summary.service??0,"#fce8e8","#b42318"],
        ["Ready to Return",data?.summary.readyToReturn??0,"#e7f7ee","#15803d"],
      ].map(([label,value,bg,color])=><div key={String(label)} style={{...card,padding:"13px 15px",background:String(bg)}}><div style={{fontSize:26,fontWeight:950,color:String(color)}}>{value}</div><div style={{fontSize:12,fontWeight:850,color:"#334155"}}>{label}</div></div>)}
    </section>

    <div style={{display:"flex",gap:8,marginTop:16,borderBottom:"1px solid #dbe3ea"}}>
      {([["board","Assignment Board"],["master","Master Assignments"],["activity","Moves & History"]] as const).map(([key,label])=><button key={key} onClick={()=>setTab(key)} style={{...button,border:"none",borderRadius:"9px 9px 0 0",background:tab===key?"#0b6ff9":"transparent",color:tab===key?"#fff":"#334155"}}>{label}</button>)}
    </div>

    {tab==="board"&&<>
      <section style={{...card,padding:12,marginTop:14,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <select value={location} onChange={e=>setLocation(e.target.value)} style={{...input,width:180}}>{locations.map(x=><option key={x}>{x}</option>)}</select>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{...input,width:170}}>{["All","Assigned","Coverage Swap","In Shop","Ready to Return","Open","Needs Truck","Cleaning"].map(x=><option key={x}>{x}</option>)}</select>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search driver, truck, terminal..." style={{...input,maxWidth:360,flex:"1 1 260px"}}/>
        <button style={button} onClick={()=>void load()} disabled={busy}>Refresh</button>
      </section>

      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 360px",gap:14,marginTop:14,alignItems:"start"}}>
        <section style={{...card,overflow:"hidden"}}>
          <div style={{padding:"12px 14px",fontWeight:900,fontSize:17}}>Drivers & Truck Assignments</div>
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <thead><tr>{["Driver","Home Truck","Current Truck","Truck Location","Status","Repair Board","Action"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{visible.map(row=>{
              const active=activeSwapByHome.get(row.equipmentId);
              return <tr key={row.equipmentId} onClick={()=>setSelectedId(row.equipmentId)} style={{background:selectedId===row.equipmentId?"#f8fbff":"#fff",cursor:"pointer"}}>
                <td style={td}><strong>{row.homeDriver||row.currentDriver||"— OPEN —"}</strong><div style={{fontSize:11,color:"#64748b"}}>{row.homeLocation||"No home terminal"}</div></td>
                <td style={td}><strong>{row.unit}</strong></td>
                <td style={td}><strong>{active?active.coverageUnit:row.currentDriver?row.unit:"—"}</strong></td>
                <td style={td}>{active?active.workingLocation:row.currentLocation||"—"}</td>
                <td style={td}><span style={statusStyle(row)}>{niceStatus(row)}</span></td>
                <td style={td}>{row.outOfService||row.openRepairCount>0?<span style={badge("#fee2e2","#b91c1c")}>{row.outOfService?"OOS":`${row.openRepairCount} open job${row.openRepairCount===1?"":"s"}`}</span>:<span style={badge("#ecfdf5","#047857")}>Clear</span>}</td>
                <td style={td}><button style={{...button,padding:"6px 10px"}} onClick={e=>{e.stopPropagation();setSelectedId(row.equipmentId);}}>Manage</button></td>
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
                {!selected.currentDriver&&<button style={button} onClick={()=>void act({action:"setPoolStatus",equipmentId:selected.equipmentId,status:"open",currentLocation:selected.currentLocation})} disabled={busy}>Mark Open</button>}
                {!selected.currentDriver&&<button style={button} onClick={()=>void act({action:"setPoolStatus",equipmentId:selected.equipmentId,status:"spare",currentLocation:selected.currentLocation})} disabled={busy}>Mark Spare</button>}
                {!selected.currentDriver&&<button style={orange} onClick={()=>void act({action:"setPoolStatus",equipmentId:selected.equipmentId,status:"cleaning",currentLocation:selected.currentLocation})} disabled={busy}>Needs Cleaning</button>}
              </div>
              {(selected.outOfService||selected.openRepairCount>0)&&<div style={{marginTop:10,padding:10,borderRadius:9,background:"#fff1f2",fontSize:12,color:"#9f1239"}}><strong>Repair Board:</strong> {selected.outOfServiceReason||`${selected.openRepairCount} open repair job(s)`}. This truck cannot be used as coverage until cleared.</div>}
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
        <div style={{...card,overflow:"hidden"}}><div style={{padding:"11px 13px",fontWeight:900}}>In Shop / Cleaning</div><table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{rows.filter(x=>x.outOfService||x.openRepairCount>0||x.status==="service"||x.status==="cleaning").slice(0,7).map(x=><tr key={x.equipmentId}><td style={td}><strong>{x.unit}</strong></td><td style={td}>{x.currentLocation||"—"}</td><td style={td}>{niceStatus(x)}</td></tr>)}</tbody></table></div>
        <div style={{...card,overflow:"hidden"}}><div style={{padding:"11px 13px",fontWeight:900}}>Recent Moves & Swaps</div><table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{(data?.events??[]).slice(0,7).map(x=><tr key={x.id}><td style={{...td,width:84,fontSize:11}}>{dateTime(x.created_at).split(",")[0]}</td><td style={td}>{x.detail}</td></tr>)}</tbody></table></div>
      </section>
    </>}

    {tab==="master"&&<section style={{...card,overflow:"hidden",marginTop:14}}>
      <div style={{padding:"13px 14px",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div><h2 style={{margin:0,fontSize:18}}>Master Assignments</h2><p style={{margin:"4px 0 0",fontSize:12,color:"#64748b"}}>This is the permanent truck-to-driver memory. Temporary swaps never change this list.</p></div>
        {!data?.permissions.canEditMaster&&<span style={badge("#f1f5f9","#475569")}>View only for dispatch</span>}
      </div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:1050}}><thead><tr>{["Truck","Permanent Driver","Home Terminal","Class","Auto","Flatbed","Current Driver","Current Location","Status","Notes",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{visible.map(row=><tr key={row.equipmentId}>
        <td style={td}><strong>{row.unit}</strong></td><td style={td}>{row.homeDriver||"OPEN"}</td><td style={td}>{row.homeLocation||"—"}</td><td style={td}>{row.truckClass||"—"}</td><td style={td}>{row.automatic?"Yes":"No"}</td><td style={td}>{row.flatbed?"Yes":"No"}</td><td style={td}>{row.currentDriver||"—"}</td><td style={td}>{row.currentLocation||"—"}</td><td style={td}>{niceStatus(row)}</td><td style={{...td,maxWidth:240}}>{row.notes||"—"}</td><td style={td}>{data?.permissions.canEditMaster&&<button style={{...button,padding:"6px 9px"}} onClick={()=>editMaster(row)}>Edit</button>}</td>
      </tr>)}</tbody></table></div>
    </section>}

    {tab==="activity"&&<section style={{...card,overflow:"hidden",marginTop:14}}>
      <div style={{padding:"13px 14px"}}><h2 style={{margin:0,fontSize:18}}>Assignment History</h2><p style={{margin:"4px 0 0",fontSize:12,color:"#64748b"}}>Every permanent change, swap, move, cleaning status and return is logged.</p></div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}><thead><tr>{["When","Type","Driver","Truck(s)","Move","Details","By"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{(data?.events??[]).map(x=><tr key={x.id}><td style={td}>{dateTime(x.created_at)}</td><td style={td}>{x.action.replaceAll("_"," ")}</td><td style={td}>{x.driver||"—"}</td><td style={td}>{[x.primary_unit,x.secondary_unit].filter(Boolean).join(" / ")||"—"}</td><td style={td}>{x.from_location&&x.to_location?`${x.from_location} → ${x.to_location}`:"—"}</td><td style={td}>{x.detail}</td><td style={td}>{x.by_name}</td></tr>)}</tbody></table></div>
    </section>}

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
