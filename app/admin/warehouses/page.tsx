"use client";

import {FormEvent,useEffect,useState} from "react";

type Warehouse={
  id:number;
  code:string;
  name:string;
  active:boolean;
  assignedUsers:number;
  stockRows:number;
  stockUnits:number;
  onOrderUnits:number;
  openRepairRequests:number;
  historicalReferences:number;
  canArchive:boolean;
  canDelete:boolean;
};

export default function WarehousesPage(){
  const[warehouses,setWarehouses]=useState<Warehouse[]>([]);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState<number|string|null>(null);
  const[newWarehouse,setNewWarehouse]=useState({code:"",name:""});

  async function load(){
    const response=await fetch("/api/admin/warehouses",{cache:"no-store"});
    if(response.status===401){window.location.assign("/login?returnTo=/admin/warehouses");return}
    const result=await response.json() as{warehouses?:Warehouse[];error?:string};
    if(!response.ok)throw new Error(result.error||"Warehouses could not be loaded.");
    setWarehouses(result.warehouses??[]);
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Warehouses could not be loaded."));},[]);

  async function action(body:Record<string,unknown>,busyKey:number|string){
    setBusy(busyKey);setMessage("");
    try{
      const response=await fetch("/api/admin/warehouses",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as{ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Warehouse action failed.");
      await load();
      return true;
    }catch(error){
      setMessage(error instanceof Error?error.message:"Warehouse action failed.");
      return false;
    }finally{setBusy(null)}
  }

  async function create(event:FormEvent){
    event.preventDefault();
    const code=newWarehouse.code.trim().toUpperCase();
    const name=newWarehouse.name.trim();
    if(!code||!name)return;
    if(await action({action:"create",code,name},"create")){
      setNewWarehouse({code:"",name:""});
      setMessage(`${name} added as an active parts warehouse.`);
    }
  }

  async function rename(warehouse:Warehouse){
    const name=window.prompt("Warehouse name",warehouse.name)?.trim();
    if(!name||name===warehouse.name)return;
    if(await action({action:"rename",id:warehouse.id,name},warehouse.id))setMessage(`${warehouse.code} renamed to ${name}.`);
  }

  async function archive(warehouse:Warehouse){
    if(!window.confirm(`Archive ${warehouse.name}? It will disappear from receiving, inventory, transfers, and technician/manager assignments, but its history will stay intact.`))return;
    if(await action({action:"archive",id:warehouse.id},warehouse.id))setMessage(`${warehouse.name} archived.`);
  }

  async function restore(warehouse:Warehouse){
    if(await action({action:"restore",id:warehouse.id},warehouse.id))setMessage(`${warehouse.name} restored.`);
  }

  async function remove(warehouse:Warehouse){
    const typed=window.prompt(`Permanent delete is only available for unused warehouses. Type ${warehouse.code} to delete it.`);
    if(typed?.trim().toUpperCase()!==warehouse.code)return;
    if(await action({action:"delete",id:warehouse.id},warehouse.id))setMessage(`${warehouse.name} permanently deleted.`);
  }

  const active=warehouses.filter(item=>item.active);
  const archived=warehouses.filter(item=>!item.active);

  return <main style={page}>
    <header style={header}>
      <div>
        <p style={eyebrow}>PARTS SETUP</p>
        <h1 style={h1}>Parts Warehouses</h1>
        <p style={sub}>Only active warehouses appear in Inventory, Receiving, Transfers, and user parts assignments. Archive preserves history. Permanent Delete is only allowed for an unused warehouse.</p>
      </div>
      <a href="/admin/users" style={link}>User warehouse assignments →</a>
    </header>

    {message&&<div style={notice}>{message}</div>}

    <section style={card}>
      <div style={sectionHead}>
        <div><h2 style={h2}>Add warehouse</h2><p style={hint}>Example: code <b>CLARE</b>, name <b>Clare shop</b>.</p></div>
      </div>
      <form onSubmit={create} style={form}>
        <label style={field}>Warehouse code
          <input required maxLength={20} value={newWarehouse.code} onChange={event=>setNewWarehouse(current=>({...current,code:event.target.value.toUpperCase().replace(/\s+/g,"_")}))} placeholder="CLARE" style={input}/>
        </label>
        <label style={field}>Warehouse name
          <input required maxLength={80} value={newWarehouse.name} onChange={event=>setNewWarehouse(current=>({...current,name:event.target.value}))} placeholder="Clare shop" style={input}/>
        </label>
        <button disabled={busy!==null} type="submit" style={addButton}>{busy==="create"?"Adding…":"+ Add Warehouse"}</button>
      </form>
    </section>

    <section style={card}>
      <div style={sectionHead}><div><h2 style={h2}>Active warehouses</h2><p style={hint}>{active.length} active. These are the only warehouses available for day-to-day parts work.</p></div></div>
      <WarehouseTable rows={active} busy={busy} onRename={rename} onArchive={archive} onRestore={restore} onDelete={remove}/>
    </section>

    <section style={card}>
      <div style={sectionHead}><div><h2 style={h2}>Archived warehouses</h2><p style={hint}>Historical records remain available, but archived warehouses cannot be used for new parts activity.</p></div></div>
      <WarehouseTable rows={archived} busy={busy} onRename={rename} onArchive={archive} onRestore={restore} onDelete={remove}/>
    </section>
  </main>;
}

function WarehouseTable(props:{
  rows:Warehouse[];
  busy:number|string|null;
  onRename:(warehouse:Warehouse)=>void;
  onArchive:(warehouse:Warehouse)=>void;
  onRestore:(warehouse:Warehouse)=>void;
  onDelete:(warehouse:Warehouse)=>void;
}){
  if(!props.rows.length)return <div style={empty}>None.</div>;
  return <div style={{overflowX:"auto"}}><table style={table}>
    <thead><tr>{["Warehouse","Users","Physical stock","On order","Open requests","History","Actions"].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
    <tbody>{props.rows.map(warehouse=><tr key={warehouse.id} style={tr}>
      <td style={td}><strong>{warehouse.name}</strong><div style={code}>{warehouse.code}</div></td>
      <td style={td}>{warehouse.assignedUsers}</td>
      <td style={td}>{formatQty(warehouse.stockUnits)}</td>
      <td style={td}>{formatQty(warehouse.onOrderUnits)}</td>
      <td style={td}>{warehouse.openRepairRequests}</td>
      <td style={td}>{warehouse.historicalReferences}</td>
      <td style={{...td,whiteSpace:"nowrap"}}>
        <button disabled={props.busy===warehouse.id} onClick={()=>props.onRename(warehouse)} style={smallButton}>Rename</button>
        {warehouse.active
          ? <button disabled={props.busy===warehouse.id||!warehouse.canArchive} onClick={()=>props.onArchive(warehouse)} style={archiveButton} title={!warehouse.canArchive?"Clear assignments, stock, on-order quantities, and open requests first.":"Archive warehouse"}>Archive</button>
          : <button disabled={props.busy===warehouse.id} onClick={()=>props.onRestore(warehouse)} style={restoreButton}>Restore</button>}
        <button disabled={props.busy===warehouse.id||!warehouse.canDelete} onClick={()=>props.onDelete(warehouse)} style={deleteButton} title={!warehouse.canDelete?"Warehouse has setup/history. Archive it instead.":"Permanently delete unused warehouse"}>Delete</button>
      </td>
    </tr>)}</tbody>
  </table></div>;
}

function formatQty(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}

const page={minHeight:"100vh",background:"#f3f5f7",padding:"42px",color:"#182331",display:"grid",gap:18} as const;
const header={display:"flex",justifyContent:"space-between",gap:20,alignItems:"flex-end",flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".14em"} as const;
const h1={margin:"7px 0 0",fontSize:34,color:"#0d1b2b"} as const;
const sub={margin:"8px 0 0",maxWidth:850,color:"#657383",fontSize:13,lineHeight:1.5} as const;
const link={color:"#173f65",fontWeight:900,textDecoration:"none"} as const;
const notice={padding:12,border:"1px solid #f2c66d",borderRadius:9,background:"#fff8e6",fontSize:13,fontWeight:800} as const;
const card={background:"white",border:"1px solid #dce2e7",borderRadius:12,padding:18} as const;
const sectionHead={display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",marginBottom:14} as const;
const h2={margin:0,fontSize:20} as const;
const hint={margin:"5px 0 0",color:"#6c7886",fontSize:12} as const;
const form={display:"grid",gridTemplateColumns:"minmax(160px,.65fr) minmax(220px,1.35fr) auto",gap:10,alignItems:"end"} as const;
const field={display:"grid",gap:5,fontSize:11,fontWeight:900,color:"#52616d"} as const;
const input={padding:11,border:"1px solid #bdc9d3",borderRadius:8,background:"white",fontSize:14,color:"#182331"} as const;
const addButton={border:0,borderRadius:8,padding:"12px 16px",background:"#173f65",color:"white",fontWeight:950,cursor:"pointer"} as const;
const table={width:"100%",borderCollapse:"collapse" as const,minWidth:880} as const;
const th={padding:"10px 11px",textAlign:"left" as const,background:"#f7f9fa",color:"#657383",fontSize:10,letterSpacing:".04em"} as const;
const tr={borderTop:"1px solid #edf0f2"} as const;
const td={padding:"12px 11px",fontSize:12} as const;
const code={marginTop:3,color:"#7c8994",fontSize:10,fontWeight:900,letterSpacing:".06em"} as const;
const smallButton={marginRight:6,border:"1px solid #9aa8b3",borderRadius:7,padding:"6px 8px",background:"white",color:"#364554",fontSize:10,fontWeight:900,cursor:"pointer"} as const;
const archiveButton={...smallButton,borderColor:"#a56a00",color:"#8a5a00"} as const;
const restoreButton={...smallButton,borderColor:"#176448",color:"#176448"} as const;
const deleteButton={...smallButton,borderColor:"#b42318",color:"#b42318"} as const;
const empty={padding:18,border:"1px dashed #cbd4db",borderRadius:9,color:"#6c7886",fontSize:12,textAlign:"center" as const} as const;
