"use client";

import { useEffect, useState } from "react";
import { YARD_DEFINITIONS, yardLabel, type YardSelection } from "@/lib/yards";

type Yard=YardSelection;
type Warehouse={id:number;code:string;name:string};
type YardUser={id:number;username:string;displayName:string;role:"mechanic"|"manager";active:boolean;yard:Yard;partsWarehouseId:number|null};

export default function YardAssignments(){
  const[users,setUsers]=useState<YardUser[]>([]);
  const[warehouses,setWarehouses]=useState<Warehouse[]>([]);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState<number|null>(null);

  async function load(){
    const response=await fetch('/api/admin/user-yards',{cache:'no-store'});
    const result=await response.json() as{users?:YardUser[];warehouses?:Warehouse[];error?:string};
    if(!response.ok)throw new Error(result.error||'Yard assignments could not be loaded.');
    setUsers(result.users??[]);setWarehouses(result.warehouses??[]);
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Yard assignments could not be loaded.'));},[]);

  function patch(id:number,updates:Partial<YardUser>){setUsers(current=>current.map(user=>user.id===id?{...user,...updates}:user));}

  async function save(user:YardUser){
    setBusy(user.id);setMessage("");
    try{
      const response=await fetch('/api/admin/user-yards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:user.id,yard:user.yard,partsWarehouseId:user.partsWarehouseId})});
      const result=await response.json() as{ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||'Yard assignment could not be saved.');
      const warehouse=warehouses.find(item=>item.id===user.partsWarehouseId);
      setMessage(`${user.displayName}: yard ${user.yard?yardLabel(user.yard):'not assigned'} · parts ${warehouse?.name??'not assigned'}.`);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Yard assignment could not be saved.');}
    finally{setBusy(null);}
  }

  return <main style={{background:'#f3f5f7',padding:'0 42px 42px',color:'#182331'}}>
    <section style={{background:'white',border:'1px solid #dce2e7',borderRadius:12,overflow:'hidden'}}>
      <div style={{padding:18,borderBottom:'1px solid #dce2e7'}}>
        <p style={{margin:0,color:'#f47b20',fontSize:11,fontWeight:900,letterSpacing:'.14em'}}>SHOP VISIBILITY</p>
        <h2 style={{margin:'6px 0 4px'}}>Yard & parts warehouse assignments</h2>
        <p style={{margin:0,color:'#6c7886',fontSize:13}}>Yard controls which open shop work they see. Parts Warehouse controls the inventory they can see, use, and request while working. The two assignments are independent.</p>
      </div>
      {message&&<div style={{margin:14,padding:11,background:'#fff8e6',border:'1px solid #f2c66d',borderRadius:9}}>{message}</div>}
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:860}}>
        <thead><tr>{['Name','Clearance','Yard','Parts Warehouse','Status','Action'].map(label=><th key={label} style={{padding:12,textAlign:'left',background:'#f7f9fa',color:'#657383',fontSize:11}}>{label}</th>)}</tr></thead>
        <tbody>{users.map(user=><tr key={user.id} style={{borderTop:'1px solid #edf0f2',opacity:user.active?1:.58}}>
          <td style={{padding:12}}><strong>{user.displayName}</strong><div style={{fontSize:11,color:'#87929c'}}>@{user.username}</div></td>
          <td style={{padding:12,textTransform:'capitalize'}}>{user.role}</td>
          <td style={{padding:12}}><select value={user.yard} onChange={event=>patch(user.id,{yard:event.target.value as Yard})} style={input}>
            <option value="">Not assigned</option>{YARD_DEFINITIONS.map(yard=><option key={yard.key} value={yard.key}>{yard.label}</option>)}
          </select></td>
          <td style={{padding:12}}><select value={user.partsWarehouseId??''} onChange={event=>patch(user.id,{partsWarehouseId:event.target.value?Number(event.target.value):null})} style={input}>
            <option value="">Not assigned</option>{warehouses.map(warehouse=><option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.code})</option>)}
          </select></td>
          <td style={{padding:12}}>{user.active?'Active':'Inactive'}</td>
          <td style={{padding:12}}><button disabled={busy===user.id} onClick={()=>void save(user)}>{busy===user.id?'Saving…':'Save Assignments'}</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}

const input={padding:9,border:'1px solid #ccd5dd',borderRadius:8,background:'white',color:'#182331',minWidth:150};
