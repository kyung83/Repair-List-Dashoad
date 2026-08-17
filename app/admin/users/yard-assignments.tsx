"use client";

import { useEffect, useState } from "react";
import { YARD_DEFINITIONS, yardLabel, type YardSelection } from "@/lib/yards";

type Yard=YardSelection;
type YardUser={id:number;username:string;displayName:string;role:"mechanic"|"manager";active:boolean;yard:Yard};

export default function YardAssignments(){
  const[users,setUsers]=useState<YardUser[]>([]);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState<number|null>(null);

  async function load(){
    const response=await fetch('/api/admin/user-yards',{cache:'no-store'});
    const result=await response.json() as{users?:YardUser[];error?:string};
    if(!response.ok)throw new Error(result.error||'Yard assignments could not be loaded.');
    setUsers(result.users??[]);
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Yard assignments could not be loaded.'));},[]);

  function patch(id:number,yard:Yard){setUsers(current=>current.map(user=>user.id===id?{...user,yard}:user));}

  async function save(user:YardUser){
    setBusy(user.id);setMessage("");
    try{
      const response=await fetch('/api/admin/user-yards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:user.id,yard:user.yard})});
      const result=await response.json() as{ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||'Yard assignment could not be saved.');
      setMessage(`${user.displayName} is assigned to ${user.yard?yardLabel(user.yard):'no yard'}.`);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Yard assignment could not be saved.');}
    finally{setBusy(null);}
  }

  return <main style={{background:'#f3f5f7',padding:'0 42px 42px',color:'#182331'}}>
    <section style={{background:'white',border:'1px solid #dce2e7',borderRadius:12,overflow:'hidden'}}>
      <div style={{padding:18,borderBottom:'1px solid #dce2e7'}}>
        <p style={{margin:0,color:'#f47b20',fontSize:11,fontWeight:900,letterSpacing:'.14em'}}>SHOP VISIBILITY</p>
        <h2 style={{margin:'6px 0 4px'}}>Yard assignments</h2>
        <p style={{margin:0,color:'#6c7886',fontSize:13}}>Assign every technician and manager to Clare, Cadillac, GR, Taylor, or Boyne. Their My Jobs → All Open Units view will show open repairs in that yard. Assigned repairs stay assigned; only unassigned repairs can be picked up.</p>
      </div>
      {message&&<div style={{margin:14,padding:11,background:'#fff8e6',border:'1px solid #f2c66d',borderRadius:9}}>{message}</div>}
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:680}}>
        <thead><tr>{['Name','Clearance','Yard','Status','Action'].map(label=><th key={label} style={{padding:12,textAlign:'left',background:'#f7f9fa',color:'#657383',fontSize:11}}>{label}</th>)}</tr></thead>
        <tbody>{users.map(user=><tr key={user.id} style={{borderTop:'1px solid #edf0f2',opacity:user.active?1:.58}}>
          <td style={{padding:12}}><strong>{user.displayName}</strong><div style={{fontSize:11,color:'#87929c'}}>@{user.username}</div></td>
          <td style={{padding:12,textTransform:'capitalize'}}>{user.role}</td>
          <td style={{padding:12}}><select value={user.yard} onChange={event=>patch(user.id,event.target.value as Yard)} style={input}>
            <option value="">Not assigned</option>{YARD_DEFINITIONS.map(yard=><option key={yard.key} value={yard.key}>{yard.label}</option>)}
          </select></td>
          <td style={{padding:12}}>{user.active?'Active':'Inactive'}</td>
          <td style={{padding:12}}><button disabled={busy===user.id} onClick={()=>void save(user)}>{busy===user.id?'Saving…':'Save Yard'}</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}

const input={padding:9,border:'1px solid #ccd5dd',borderRadius:8,background:'white',color:'#182331',minWidth:150};
