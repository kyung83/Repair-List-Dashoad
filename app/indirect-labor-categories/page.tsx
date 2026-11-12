"use client";

import {useEffect,useState} from "react";

type Category={id:number;name:string;active:boolean;sortOrder:number};
type Result={ok?:boolean;categories?:Category[];canManage?:boolean;error?:string};
const input={width:"100%",boxSizing:"border-box" as const,padding:"10px 12px",border:"1px solid #bacbc6",borderRadius:8,fontSize:14,background:"white",color:"#192b27"} as const;
const button={padding:"10px 16px",border:0,borderRadius:8,background:"#173f37",color:"white",fontWeight:800,cursor:"pointer"} as const;
export default function IndirectLaborCategoriesPage(){
  const[categories,setCategories]=useState<Category[]>([]);
  const[edits,setEdits]=useState<Record<number,Category>>({});
  const[newName,setNewName]=useState("");
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  const[notice,setNotice]=useState("");
  const[canManage,setCanManage]=useState(false);

  async function load(){
    const r=await fetch("/api/indirect-labor-categories",{cache:"no-store"});
    const payload=await r.json() as Result;
    if(!r.ok)throw new Error(payload.error||"Categories could not be loaded.");
    setCategories(payload.categories??[]);
    setEdits(Object.fromEntries((payload.categories??[]).map(item=>[item.id,{...item}])));
    setCanManage(Boolean(payload.canManage));
  }
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"Categories could not be loaded."))},[]);
  function patch(id:number,changes:Partial<Category>){setEdits(current=>({...current,[id]:{...current[id],...changes}}))}
  async function save(body:Record<string,unknown>,success:string){
    setBusy(true);setError("");setNotice("");
    try{
      const r=await fetch("/api/indirect-labor-categories",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await r.json() as Result;
      if(!r.ok||!result.ok)throw new Error(result.error||"Save failed.");
      await load();setNotice(success);
    }catch(e){setError(e instanceof Error?e.message:"Save failed.");}
    finally{setBusy(false);}
  }
  async function add(){if(!newName.trim())return setError("Enter a category name.");await save({action:"create",name:newName},"Category added.");setNewName("");}
  async function update(item:Category){
    const next=edits[item.id];
    if(!next)return;
    if(item.active&&!next.active&&!window.confirm(`Disable "${item.name}"? Technicians will no longer be able to start new indirect labor under this category. Existing work history stays unchanged.`))return;
    await save({action:"update",id:item.id,name:next.name,active:next.active,sortOrder:next.sortOrder},"Category saved.");
  }
  return <main style={{minHeight:"100vh",background:"#f4f6f4",padding:"30px clamp(12px,3vw,38px) 80px",color:"#1d332d"}}>
    <a href="/setup-center" style={{color:"#245c51",fontWeight:800,fontSize:13}}>← Setup Home</a>
    <header style={{maxWidth:1040,margin:"20px auto 22px"}}>
      <p style={{fontSize:11,fontWeight:900,letterSpacing:2,color:"#397666"}}>MAINTENANCE SETUP</p>
      <h1 style={{fontSize:32,margin:"7px 0"}}>Indirect Labor Categories</h1>
      <p style={{fontSize:14,color:"#62776e",lineHeight:1.6}}>Manage the choices under My Jobs → Start Indirect Labor. Rename, reorder, add or disable categories without changing existing work orders, saved hours, or productivity history.</p>
    </header>
    <section style={{maxWidth:1040,margin:"0 auto",display:"grid",gap:14}}>
      {error&&<div role="alert" style={{padding:13,background:"#fff1ea",border:"1px solid #d38e75",borderRadius:9}}>{error}</div>}
      {notice&&<div role="status" style={{padding:13,background:"#ebf6ee",border:"1px solid #b9d9c6",borderRadius:9}}>{notice}</div>}
      {!canManage&&!error&&<p>Loading categories…</p>}
      {canManage&&<div style={{padding:17,border:"1px solid #d7ded9",borderRadius:12,background:"white"}}>
        <h2 style={{margin:"0 0 12px",fontSize:18}}>Add category</h2>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <input aria-label="New category name" style={{...input,flex:"1 1 240px"}} maxLength={100} placeholder="e.g. Yard maintenance" value={newName} onChange={e=>setNewName(e.target.value)}/>
          <button type="button" style={button} disabled={busy||!newName.trim()} onClick={()=>void add()}>+ Add Category</button>
        </div>
      </div>}
      {canManage&&categories.map(item=>{
        const draft=edits[item.id]??item;
        const changed=draft.name!==item.name||draft.active!==item.active||draft.sortOrder!==item.sortOrder;
        return <article key={item.id} style={{padding:16,border:"1px solid #d7ded9",borderRadius:12,background:"white",opacity:draft.active?1:.74}}>
          <div style={{display:"grid",gridTemplateColumns:"minmax(160px,2fr) minmax(110px,.6fr) auto auto",gap:12,alignItems:"end"}}>
            <label style={{display:"grid",gap:5,fontWeight:750,fontSize:12}}>Category name
              <input style={input} maxLength={100} value={draft.name} disabled={busy} onChange={e=>patch(item.id,{name:e.target.value})}/>
            </label>
            <label style={{display:"grid",gap:5,fontWeight:750,fontSize:12}}>Display order
              <input style={input} type="number" min={0} max={100000} value={draft.sortOrder} disabled={busy} onChange={e=>patch(item.id,{sortOrder:Number(e.target.value)})}/>
            </label>
            <label style={{display:"flex",alignItems:"center",gap:7,fontWeight:750,fontSize:13,paddingBottom:11}}>
              <input type="checkbox" checked={draft.active} disabled={busy} onChange={e=>patch(item.id,{active:e.target.checked})}/> Active
            </label>
            <button type="button" style={{...button,opacity:changed?1:.5}} disabled={busy||!changed||!draft.name.trim()} onClick={()=>void update(item)}>Save</button>
          </div>
          {!draft.active&&<small style={{display:"block",marginTop:7,color:"#7b5a29"}}>Disabled — hidden from technician selection, history retained</small>}
        </article>;
      })}
    </section>
  </main>;
}
