'use client';
import {useEffect,useState} from 'react';

type Member={technicianId:number;name:string;role:string;working:boolean};
type Technician={id:number;name:string};
export default function RepairTeamPanel({repairId,editable,onChanged}:{repairId:string;editable:boolean;onChanged:()=>void}){
  const[team,setTeam]=useState<Member[]>([]);
  const[technicians,setTechnicians]=useState<Technician[]>([]);
  const[choice,setChoice]=useState('');
  const[error,setError]=useState('');
  const[busy,setBusy]=useState(false);
  const numericId=Number(repairId.replace(/^repair-/,''));
  async function load(){
    if(!editable)return;
    const response=await fetch(`/api/shop/team?repairId=${numericId}`,{cache:'no-store'});
    const body=await response.json() as {team?:Member[];technicians?:Technician[];error?:string};
    if(!response.ok)throw new Error(body.error||'Team could not be loaded.');
    setTeam(body.team||[]);setTechnicians(body.technicians||[]);
  }
  useEffect(()=>{void load().catch(e=>setError(String(e.message||e)));},[repairId,editable]);
  async function change(action:'add'|'remove',technicianId:number){
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/shop/team',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({repairId:numericId,action,technicianId})});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||'Team change failed.');
      setChoice('');await load();onChanged();
    }catch(e){setError(e instanceof Error?e.message:'Team change failed.');}
    finally{setBusy(false);}
  }
  if(!editable)return null;
  const available=technicians.filter(t=>!team.some(m=>m.technicianId===t.id));
  return <section style={{padding:14,border:'1px solid #cbd5e1',borderRadius:12,background:'#fff',display:'grid',gap:10}}>
    <strong style={{fontSize:16}}>Technicians on this work order</strong>
    <div style={{fontSize:12,color:'#64748b'}}>Each person tracks their own labor. The primary assignment stays unchanged.</div>
    {team.map(member=><div key={member.technicianId} style={{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'}}>
      <span>{member.name} — {member.role==='primary'?'Primary':'Helping'}{member.working?' · Working now':''}</span>
      {member.role==='helper'&&<button type="button" disabled={busy||member.working} onClick={()=>void change('remove',member.technicianId)}>Remove</button>}
    </div>)}
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <select aria-label="Helping technician" value={choice} onChange={e=>setChoice(e.target.value)}
        style={{flex:1,minWidth:160,padding:9,border:'1px solid #cbd5e1',borderRadius:8}}>
        <option value="">Select helping technician</option>
        {available.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button type="button" disabled={busy||!choice} onClick={()=>void change('add',Number(choice))}
        style={{padding:'10px 14px',background:'#173f37',color:'white',border:0,borderRadius:8}}>Add Helper</button>
    </div>
    {error&&<div role="alert" style={{color:'#b91c1c',fontSize:12}}>{error}</div>}
  </section>;
}
