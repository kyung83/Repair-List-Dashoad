"use client";

import {useEffect,useState} from "react";

type Data={signed:boolean;brakeNotes:string;comments:string;tireData:Record<string,string>;error?:string};
type Props={repairId:string;canWork:boolean;locked?:boolean;tiresOnly?:boolean};

const axles=[
  {label:"Axle 1 (Steer)",positions:[["Left","a1_l"],["Right","a1_r"]]},
  {label:"Axle 2 (Drive)",positions:[["Outside Left","a2_ol"],["Inside Left","a2_il"],["Inside Right","a2_ir"],["Outside Right","a2_or"]]},
  {label:"Axle 3 (Drive)",positions:[["Outside Left","a3_ol"],["Inside Left","a3_il"],["Inside Right","a3_ir"],["Outside Right","a3_or"]]},
] as const;

export default function PmSheetDetails({repairId,canWork,locked=false,tiresOnly=false}:Props){
  const[brakes,setBrakes]=useState("");
  const[comments,setComments]=useState("");
  const[tires,setTires]=useState<Record<string,string>>({});
  const[signed,setSigned]=useState(false);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState("");

  useEffect(()=>{
    void fetch(`/api/maintenance-signature?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"})
      .then(async r=>{
        const p=await r.json() as Data;
        if(!r.ok)throw new Error(p.error||"PM details could not be loaded.");
        setBrakes(p.brakeNotes||"");
        setComments(p.comments||"");
        setTires(p.tireData||{});
        setSigned(Boolean(p.signed));
      })
      .catch(e=>setMessage(e instanceof Error?e.message:"PM details could not be loaded."));
  },[repairId]);

  function tire(key:string,value:string){
    setTires(v=>({...v,[key]:value.replace(/[^0-9.]/g,"").slice(0,6)}));
  }

  async function save(){
    setBusy(true);
    setMessage("");
    try{
      const r=await fetch("/api/maintenance-signature",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"details",repairId,brakeNotes:brakes,comments,tireData:tires}),
      });
      const p=await r.json() as Data&{ok?:boolean};
      if(!r.ok||!p.ok)throw new Error(p.error||"PM details could not be saved.");
      setMessage(tiresOnly?"Tire tread depths and pressures saved.":"PM sheet details saved.");
    }catch(e){
      setMessage(e instanceof Error?e.message:"PM details could not be saved.");
    }finally{
      setBusy(false);
    }
  }

  const disabled=!canWork||busy||signed||locked;
  const tireFields=<div style={{marginTop:12,display:"grid",gap:10}}>
    {axles.map(axle=><div key={axle.label} style={{border:"1px solid #d8e0e6",borderRadius:10,padding:10,background:"#fff"}}>
      <strong style={{display:"block",marginBottom:8,color:"#17283a"}}>{axle.label}</strong>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
        {axle.positions.map(([label,key])=><div key={key} style={{border:"1px solid #e5eaee",borderRadius:9,padding:8}}>
          <b style={{display:"block",fontSize:12,marginBottom:6,color:"#52616e"}}>{label}</b>
          <label style={{display:"grid",gap:4,fontSize:11,fontWeight:850,color:"#52616e"}}>Tread depth (32nds)
            <input className="easy-search-input" placeholder="Example: 12" inputMode="decimal" value={tires[`${key}_tread`]||""} disabled={disabled} onChange={e=>tire(`${key}_tread`,e.target.value)}/>
          </label>
          <label style={{display:"grid",gap:4,fontSize:11,fontWeight:850,color:"#52616e",marginTop:7}}>Tire pressure (PSI)
            <input className="easy-search-input" placeholder="Example: 105" inputMode="decimal" value={tires[`${key}_psi`]||""} disabled={disabled} onChange={e=>tire(`${key}_psi`,e.target.value)}/>
          </label>
        </div>)}
      </div>
    </div>)}
  </div>;

  if(tiresOnly){
    return <section className="easy-card easy-card-body" style={{marginTop:12,border:"2px solid #f2a044",background:"#fffaf3"}}>
      <p className="easy-eyebrow">PM ITEM 39 · TIRE MEASUREMENTS</p>
      <h4 style={{margin:"6px 0",fontSize:20}}>Record tread depth and tire pressure now</h4>
      <p className="easy-section-copy">Enter the actual tread depth in 32nds and PSI for every tire while you are checking them. These values carry forward to the final PM sheet.</p>
      {message&&<div className="easy-notice">{message}</div>}
      {tireFields}
      {canWork&&!signed&&!locked&&<div className="easy-actions" style={{marginTop:10}}><button className="easy-button orange" disabled={busy} onClick={()=>void save()}>{busy?"Saving...":"Save Tire Measurements"}</button></div>}
      {(signed||locked)&&<div className="easy-notice" style={{marginTop:10}}>Tire measurements are locked by the technician signature.</div>}
    </section>;
  }

  return <section className="easy-card easy-card-body" style={{marginTop:18}}>
    <p className="easy-eyebrow">PM SHEET DETAILS</p>
    <h4 style={{margin:"6px 0",fontSize:20}}>Brake notes, comments, tire tread & PSI</h4>
    <p className="easy-section-copy">The tire measurements entered at PM item 39 are shown here again for final review. Save any final changes before signing.</p>
    {message&&<div className="easy-notice">{message}</div>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:10,marginTop:10}}>
      <label style={{display:"grid",gap:5,fontWeight:850}}>Brake Notes<textarea className="easy-note" value={brakes} disabled={disabled} onChange={e=>setBrakes(e.target.value)}/></label>
      <label style={{display:"grid",gap:5,fontWeight:850}}>Comments<textarea className="easy-note" value={comments} disabled={disabled} onChange={e=>setComments(e.target.value)}/></label>
    </div>
    {tireFields}
    {canWork&&!signed&&!locked&&<div className="easy-actions" style={{marginTop:10}}><button className="easy-button" disabled={busy} onClick={()=>void save()}>{busy?"Saving...":"Save PM Sheet Details"}</button></div>}
    {locked&&<div className="easy-notice" style={{marginTop:10}}>PM sheet details are locked by the technician signature.</div>}
  </section>;
}
