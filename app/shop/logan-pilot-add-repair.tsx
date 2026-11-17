"use client";
import {useState} from "react";
import RepairBoardAddRepair from "../repair-board/add-repair-form";

type Equipment={id:number;unit:string;equipmentType:string;driver:string;location:string};
type Technician={id:number;name:string};
type BoardResponse={equipment?:Equipment[];technicians?:Technician[];error?:string};
type Props={onSaved:()=>Promise<void>|void};

export default function LoganPilotAddRepair({onSaved}:Props){
  const[open,setOpen]=useState(false);
  const[loading,setLoading]=useState(false);
  const[message,setMessage]=useState("");
  const[equipment,setEquipment]=useState<Equipment[]>([]);
  const[technicians,setTechnicians]=useState<Technician[]>([]);
  async function openForm(){
    if(open){setOpen(false);return;}
    setLoading(true);setMessage("");
    try{
      const response=await fetch("/api/repair-board",{cache:"no-store"});
      const board=await response.json() as BoardResponse;
      if(!response.ok)throw new Error(board.error||"The unit list could not be loaded.");
      setEquipment(board.equipment??[]);
      setTechnicians(board.technicians??[]);
      setOpen(true);
    }catch(error){setMessage(error instanceof Error?error.message:"Cannot open Add Repair.")}
    finally{setLoading(false);}
  }
  return <section style={{display:"grid",gap:9}} aria-label="Logan pilot add repair different unit">
    <button type="button" disabled={loading} onClick={()=>void openForm()}
      style={{width:"100%",padding:"12px 14px",background:"#fff",color:"#173f37",
        border:"2px solid #75a69b",borderRadius:11,fontWeight:900,fontSize:14,cursor:"pointer"}}>
      {loading?"LOADING UNITS…":open?"CLOSE ADD REPAIR":"+ ADD REPAIR — DIFFERENT UNIT"}
    </button>
    {message&&<div role="alert" style={{padding:10,background:"#fff7e8",borderRadius:8}}>{message}</div>}
    {open&&<div style={{minWidth:0}}>
      <RepairBoardAddRepair equipment={equipment} technicians={technicians}
        initialEquipmentId={null} allowTechnicianAssignment={false}
        allowSelfAssignment allowNewEquipment={false} allowPullThru={false}
        onClose={()=>setOpen(false)} onSaved={onSaved}/>
      <p style={{fontSize:12,color:"#607080",marginTop:6}}>
        This creates a repair on the selected unit. It will not stop or switch the repair you are working on.
      </p>
    </div>}
  </section>;
}
