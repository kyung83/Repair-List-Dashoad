"use client";

import {type FormEvent,useEffect,useMemo,useState} from "react";
import ModuleTabs from "../module-tabs";

type CoreObligation={
  id:number;
  repair_id:number|null;
  quantity:number;
  issued_part_number:string;
  issued_description:string;
  core_part_number:string|null;
  core_description:string|null;
  unit:string;
  opened_at:string;
};

type Part={
  id:number;
  part_number:string;
  description:string;
  core_return_part_id:number|null;
  core_return_quantity:number;
};

type CoreData={
  ok:boolean;
  coreObligations:CoreObligation[];
  parts:Part[];
};

function when(value:string){
  const parsed=Date.parse(value.includes("T")?value:value.replace(" ","T")+"Z");
  return Number.isFinite(parsed)?new Date(parsed).toLocaleString():value;
}

function qty(value:number){
  const number=Number(value||0);
  return Number.isInteger(number)?String(number):number.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
}

export default function CoresPage(){
  const[data,setData]=useState<CoreData|null>(null);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState("");
  const[issuedPartId,setIssuedPartId]=useState("");
  const[corePartId,setCorePartId]=useState("");
  const[coreQuantity,setCoreQuantity]=useState("1");
  const[filter,setFilter]=useState("");

  async function load(){
    const response=await fetch("/api/cores",{cache:"no-store"});
    const payload=await response.json() as CoreData&{error?:string};
    if(!response.ok)throw new Error(payload.error||"Core information could not be loaded.");
    setData(payload);
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Core information could not be loaded."))},[]);

  useEffect(()=>{
    if(!data||!issuedPartId)return;
    const selected=data.parts.find(part=>part.id===Number(issuedPartId));
    if(!selected)return;
    // Most cores are the used version of the same catalog part. Default new rules
    // to that part while still allowing a different core SKU when the shop uses one.
    setCorePartId(selected.core_return_part_id==null?String(selected.id):String(selected.core_return_part_id));
    setCoreQuantity(selected.core_return_part_id==null?"1":String(selected.core_return_quantity||1));
  },[data,issuedPartId]);

  async function post(action:string,body:Record<string,unknown>,success:string){
    setBusy(action);setMessage("");
    try{
      const response=await fetch("/api/cores",{
        method:"POST",
        headers:{"content-type":"application/json","idempotency-key":`${action}:${crypto.randomUUID()}`},
        body:JSON.stringify({action,...body}),
      });
      const payload=await response.json() as {error?:string};
      if(!response.ok)throw new Error(payload.error||"Core action failed.");
      setMessage(success);
      await load();
      return true;
    }catch(error){
      setMessage(error instanceof Error?error.message:"Core action failed.");
      return false;
    }finally{setBusy("")}
  }

  async function saveRule(event:FormEvent){
    event.preventDefault();
    if(!issuedPartId){setMessage("Choose the part that creates the core obligation.");return}
    await post("configureCore",{
      partId:Number(issuedPartId),
      corePartId:corePartId?Number(corePartId):null,
      coreReturnQuantity:corePartId?Number(coreQuantity):0,
    },corePartId?"Core-return rule saved.":"Core-return rule removed.");
  }

  async function closeCore(core:CoreObligation,disposition:"returned"|"waived"){
    let note="Core physically returned";
    if(disposition==="returned"){
      if(!window.confirm(`Mark this core returned${core.unit?` for Unit ${core.unit}`:""}?`))return;
    }else{
      note=(window.prompt("Reason for waiving this core obligation?")??"").trim();
      if(!note)return;
    }
    await post("closeCore",{obligationId:core.id,disposition,note},disposition==="returned"?"Core marked returned.":"Core obligation waived with manager note.");
  }

  const configuredRules=useMemo(()=>data?.parts.filter(part=>part.core_return_part_id!=null)??[],[data]);
  const openCores=useMemo(()=>{
    const term=filter.trim().toLowerCase();
    const rows=data?.coreObligations??[];
    if(!term)return rows;
    return rows.filter(core=>`${core.unit} ${core.issued_part_number} ${core.issued_description} ${core.core_part_number??""} ${core.core_description??""} ${core.repair_id??""}`.toLowerCase().includes(term));
  },[data,filter]);

  const selectedIssuedPart=useMemo(()=>data?.parts.find(part=>part.id===Number(issuedPartId))??null,[data,issuedPartId]);
  const otherCoreParts=useMemo(()=>data?.parts.filter(part=>part.id!==Number(issuedPartId))??[],[data,issuedPartId]);

  const partName=(id:number|null)=>{
    if(id==null)return "—";
    const part=data?.parts.find(item=>item.id===id);
    return part?`${part.part_number} — ${part.description}`:`Part ${id}`;
  };

  return <main style={page}>
    <ModuleTabs module="parts"/>
    <div style={shell}>
      <header style={header}>
        <div>
          <p style={eyebrow}>PARTS OPERATIONS</p>
          <h1 style={title}>Cores</h1>
          <p style={subtitle}>Track every core that needs to come back and configure which issued parts create a core obligation.</p>
        </div>
      </header>

      {message&&<div style={notice}>{message}</div>}

      <section style={summaryGrid}>
        <div style={summaryCard}><span style={summaryLabel}>OPEN CORES</span><strong style={summaryNumber}>{data?.coreObligations.length??0}</strong><span style={summaryHelp}>Waiting to be returned or waived</span></div>
        <div style={summaryCard}><span style={summaryLabel}>CORE RULES</span><strong style={summaryNumber}>{configuredRules.length}</strong><span style={summaryHelp}>Issued parts that require a core back</span></div>
      </section>

      <section style={card}>
        <div style={sectionHeader}>
          <div><p style={sectionEyebrow}>CURRENT OBLIGATIONS</p><h2 style={sectionTitle}>Open Cores</h2><p style={sectionHelp}>These are created automatically when a configured part is issued on a repair.</p></div>
          <input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Search unit, repair, or part…" style={searchInput}/>
        </div>

        <div style={coreList}>
          {openCores.map(core=><article key={core.id} style={coreRow}>
            <div style={coreMain}>
              <div style={coreQty}>{qty(core.quantity)}×</div>
              <div style={{minWidth:0}}>
                <strong style={coreTitle}>{core.core_part_number||"Core"}{core.core_description?` — ${core.core_description}`:""}</strong>
                <div style={coreMeta}>{core.unit?`Unit ${core.unit}`:"No unit"} · Repair {core.repair_id??"—"}</div>
                <div style={coreDetail}>Issued part <strong>{core.issued_part_number}</strong>{core.issued_description?` — ${core.issued_description}`:""}</div>
                <div style={coreDate}>Opened {when(core.opened_at)}</div>
              </div>
            </div>
            <div style={actions}>
              <button type="button" disabled={!!busy} onClick={()=>void closeCore(core,"returned")} style={returnedButton}>{busy==="closeCore"?"SAVING…":"RETURN CORE"}</button>
              <button type="button" disabled={!!busy} onClick={()=>void closeCore(core,"waived")} style={waiveButton}>WAIVE</button>
            </div>
          </article>)}
          {!openCores.length&&<div style={empty}>{filter.trim()?"No open cores match that search.":"No open core obligations."}</div>}
        </div>
      </section>

      <section style={twoCol}>
        <form onSubmit={saveRule} style={card}>
          <p style={sectionEyebrow}>SETUP</p>
          <h2 style={sectionTitle}>Core Return Rule</h2>
          <p style={sectionHelp}>Choose the part being issued. The returned core can be the same part number or a different core SKU.</p>

          <label style={label}>ISSUED PART
            <select value={issuedPartId} onChange={event=>setIssuedPartId(event.target.value)} style={input}><option value="">Choose issued part…</option>{(data?.parts??[]).map(part=><option key={part.id} value={part.id}>{part.part_number} — {part.description}</option>)}</select>
          </label>
          <label style={label}>RETURNED CORE PART
            <select value={corePartId} onChange={event=>setCorePartId(event.target.value)} style={input} disabled={!issuedPartId}>
              <option value="">No core obligation</option>
              {selectedIssuedPart&&<option value={selectedIssuedPart.id}>SAME AS ISSUED — {selectedIssuedPart.part_number} — {selectedIssuedPart.description}</option>}
              {otherCoreParts.map(part=><option key={part.id} value={part.id}>{part.part_number} — {part.description}</option>)}
            </select>
          </label>
          <label style={label}>CORES REQUIRED PER ISSUED UNIT
            <input type="number" min="0.01" step="any" value={coreQuantity} onChange={event=>setCoreQuantity(event.target.value)} style={input} disabled={!corePartId}/>
          </label>
          <button type="submit" disabled={!!busy||!issuedPartId} style={saveButton}>{busy==="configureCore"?"SAVING…":corePartId?"SAVE CORE RULE":"REMOVE CORE RULE"}</button>
        </form>

        <section style={card}>
          <p style={sectionEyebrow}>CONFIGURED PARTS</p>
          <h2 style={sectionTitle}>Parts That Require Cores</h2>
          <p style={sectionHelp}>Tap a rule to load it into the editor.</p>
          <div style={ruleList}>
            {configuredRules.map(rule=><button type="button" key={rule.id} onClick={()=>setIssuedPartId(String(rule.id))} style={ruleRow}>
              <div style={{textAlign:"left",minWidth:0}}><strong>{rule.part_number}</strong><div style={ruleDescription}>{rule.description}</div><div style={ruleMeta}>Returns {qty(rule.core_return_quantity)} × {partName(rule.core_return_part_id)}</div></div><span style={editBadge}>EDIT</span>
            </button>)}
            {!configuredRules.length&&<div style={empty}>No parts have a core-return rule yet.</div>}
          </div>
        </section>
      </section>
    </div>
  </main>;
}

const page={minHeight:"100vh",background:"#f3f5f7",padding:"30px clamp(12px,3vw,34px) 80px",color:"#182331"} as const;
const shell={maxWidth:1180,margin:"0 auto"} as const;
const header={display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:16,flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".16em"} as const;
const title={margin:"6px 0 4px",fontSize:"clamp(30px,5vw,42px)",color:"#0d1b2b"} as const;
const subtitle={margin:0,maxWidth:760,color:"#687783",fontSize:14,lineHeight:1.45} as const;
const notice={marginTop:16,padding:"11px 13px",border:"1px solid #f2c66d",borderRadius:10,background:"#fff8e6",fontSize:13,fontWeight:800,color:"#5b6670"} as const;
const summaryGrid={marginTop:18,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12} as const;
const summaryCard={border:"1px solid #d9e1e7",borderRadius:12,background:"white",padding:15,display:"grid",gap:3} as const;
const summaryLabel={fontSize:10,fontWeight:950,letterSpacing:".12em",color:"#6d7b87"} as const;
const summaryNumber={fontSize:30,color:"#0d1b2b",lineHeight:1.05} as const;
const summaryHelp={fontSize:11,color:"#71808b"} as const;
const card={marginTop:18,border:"1px solid #d9e1e7",borderRadius:14,background:"white",padding:"clamp(14px,2vw,20px)",boxShadow:"0 5px 20px #13283d0a"} as const;
const sectionHeader={display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:14,flexWrap:"wrap" as const} as const;
const sectionEyebrow={margin:0,color:"#f47b20",fontSize:10,fontWeight:950,letterSpacing:".13em"} as const;
const sectionTitle={margin:"4px 0 3px",fontSize:22,color:"#13283d"} as const;
const sectionHelp={margin:0,color:"#71808b",fontSize:12,lineHeight:1.4} as const;
const searchInput={width:"min(100%,330px)",boxSizing:"border-box" as const,border:"1px solid #c8d3dc",borderRadius:9,padding:"11px 12px",fontSize:14,background:"#fbfcfd"} as const;
const coreList={marginTop:14,display:"grid",gap:9} as const;
const coreRow={border:"1px solid #dfe5ea",borderRadius:11,padding:13,display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",flexWrap:"wrap" as const,background:"#fbfcfd"} as const;
const coreMain={display:"flex",gap:11,alignItems:"flex-start",minWidth:0,flex:"1 1 420px"} as const;
const coreQty={minWidth:44,height:44,borderRadius:10,display:"grid",placeItems:"center",background:"#173a5d",color:"white",fontWeight:950,fontSize:14} as const;
const coreTitle={display:"block",fontSize:15,color:"#172a3c"} as const;
const coreMeta={marginTop:3,fontSize:12,fontWeight:850,color:"#52616d"} as const;
const coreDetail={marginTop:5,fontSize:12,color:"#667582"} as const;
const coreDate={marginTop:4,fontSize:10,color:"#87939d"} as const;
const actions={display:"flex",gap:7,flexWrap:"wrap" as const} as const;
const returnedButton={border:0,borderRadius:8,padding:"10px 13px",background:"#177245",color:"white",fontWeight:950,cursor:"pointer"} as const;
const waiveButton={border:0,borderRadius:8,padding:"10px 13px",background:"#735326",color:"white",fontWeight:950,cursor:"pointer"} as const;
const empty={padding:"18px 8px",color:"#71808b",fontSize:13} as const;
const twoCol={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:18,alignItems:"start"} as const;
const label={display:"grid",gap:5,marginTop:13,fontSize:11,fontWeight:950,color:"#52616d"} as const;
const input={width:"100%",boxSizing:"border-box" as const,padding:"11px 12px",border:"1px solid #c8d3dc",borderRadius:9,background:"white",color:"#182331",fontSize:14} as const;
const saveButton={marginTop:14,width:"100%",border:0,borderRadius:9,padding:"12px 14px",background:"#173a5d",color:"white",fontWeight:950,cursor:"pointer"} as const;
const ruleList={marginTop:12,display:"grid",gap:8,maxHeight:430,overflowY:"auto" as const} as const;
const ruleRow={width:"100%",border:"1px solid #dce3e8",borderRadius:9,padding:"11px 12px",background:"#fbfcfd",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,cursor:"pointer",color:"#182331"} as const;
const ruleDescription={marginTop:2,fontSize:11,color:"#74828d"} as const;
const ruleMeta={marginTop:4,fontSize:11,fontWeight:800,color:"#52616d"} as const;
const editBadge={borderRadius:999,padding:"5px 8px",background:"#edf4fb",color:"#173a5d",fontSize:10,fontWeight:950} as const;
