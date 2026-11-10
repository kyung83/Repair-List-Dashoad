"use client";

import {useEffect,useMemo,useState} from "react";

type DutyItem={id:number;section:string;text:string;required:boolean;result:"done"|"attention"|"na"|null;comment:string};
type Duty={
  id:number;templateKey:string;name:string;description:string;cadence:string;assignmentMode:string;
  periodKey:string;dueDate:string;assignedUserId:number;status:string;repairId:string|null;
  suppliesNeeded:string;notes:string;startedAt:string|null;completedAt:string|null;items:DutyItem[];
};
type ShopState={activeTimer:{repairId:string}|null};

function dueLabel(value:string){
  if(!value)return "";
  const date=new Date(value+"T12:00:00");
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
}
function progress(duty:Duty){
  const answered=duty.items.filter(item=>item.result).length;
  return duty.items.length?Math.round(answered/duty.items.length*100):0;
}

export default function ShopDutiesPanel(){
  const[duties,setDuties]=useState<Duty[]>([]);
  const[activeTimer,setActiveTimer]=useState(false);
  const[busyId,setBusyId]=useState<number|null>(null);
  const[message,setMessage]=useState("");

  async function refresh(){
    try{
      const[dutyResponse,shopResponse]=await Promise.all([
        fetch("/api/shop-duties",{cache:"no-store"}),
        fetch("/api/shop",{cache:"no-store"}),
      ]);
      if(dutyResponse.ok){
        const result=await dutyResponse.json() as{duties?:Duty[]};
        setDuties(result.duties??[]);
      }
      if(shopResponse.ok){
        const result=await shopResponse.json() as ShopState;
        setActiveTimer(Boolean(result.activeTimer));
      }
    }catch{}
  }

  useEffect(()=>{
    void refresh();
    const handler=()=>void refresh();
    window.addEventListener("shop-jobs-refresh",handler);
    return()=>window.removeEventListener("shop-jobs-refresh",handler);
  },[]);

  const open=useMemo(()=>duties.filter(duty=>duty.status==="pending"||duty.status==="in_progress"),[duties]);

  async function start(duty:Duty){
    setBusyId(duty.id);setMessage("");
    try{
      const response=await fetch("/api/shop-duties",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:duty.status==="in_progress"?"resume":"start",assignmentId:duty.id}),
      });
      const result=await response.json() as{ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Shop Duty could not be started.");
      window.dispatchEvent(new Event("shop-jobs-refresh"));
      await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Shop Duty could not be started.");}
    finally{setBusyId(null);}
  }

  if(activeTimer||!open.length)return null;

  return <section style={wrap}>
    <div style={headingRow}>
      <div><p style={eyebrow}>SHOP DUTIES</p><h2 style={heading}>Your assigned duties</h2></div>
      <span style={count}>{open.length}</span>
    </div>
    {message&&<div style={notice}>{message}</div>}
    <div style={list}>
      {open.map(duty=><article key={duty.id} style={card}>
        <div style={{minWidth:0}}>
          <div style={topline}><strong style={name}>{duty.name}</strong><span style={status}>{duty.status==="in_progress"?"IN PROGRESS":"ASSIGNED"}</span></div>
          <p style={desc}>{duty.description}</p>
          <div style={meta}><span>Due {dueLabel(duty.dueDate)}</span><span>{progress(duty)}% checklist</span></div>
        </div>
        <button type="button" style={startButton} disabled={busyId===duty.id} onClick={()=>void start(duty)}>
          {busyId===duty.id?"STARTING…":duty.status==="in_progress"?"RESUME DUTY":"START DUTY"}
        </button>
      </article>)}
    </div>
  </section>;
}

const wrap={maxWidth:1100,margin:"18px auto -3px",padding:"0 clamp(12px,3vw,30px)"} as const;
const headingRow={display:"flex",justifyContent:"space-between",alignItems:"end",gap:12,marginBottom:8} as const;
const eyebrow={margin:0,color:"#2f6f60",fontSize:10,fontWeight:950,letterSpacing:".14em"} as const;
const heading={margin:"3px 0 0",fontSize:18,color:"#173f37"} as const;
const count={minWidth:28,height:28,borderRadius:999,display:"grid",placeItems:"center",background:"#173f37",color:"white",fontSize:12,fontWeight:950} as const;
const notice={marginBottom:8,padding:9,border:"1px solid #efc16c",borderRadius:8,background:"#fff8e6",fontSize:12,fontWeight:800} as const;
const list={display:"grid",gap:8} as const;
const card={display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:14,alignItems:"center",padding:"13px 14px",background:"white",border:"2px solid #b8d0c7",borderRadius:13,boxShadow:"0 4px 16px #173f370b"} as const;
const topline={display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" as const} as const;
const name={fontSize:16,color:"#173f37"} as const;
const status={padding:"4px 7px",borderRadius:999,background:"#e9f1ed",color:"#2f6f60",fontSize:9,fontWeight:950} as const;
const desc={margin:"5px 0 0",color:"#68746f",fontSize:11,lineHeight:1.4} as const;
const meta={display:"flex",gap:12,flexWrap:"wrap" as const,marginTop:7,color:"#68746f",fontSize:10,fontWeight:850} as const;
const startButton={border:0,borderRadius:9,padding:"11px 14px",background:"#2f6f60",color:"white",fontWeight:950,cursor:"pointer",whiteSpace:"nowrap" as const} as const;
