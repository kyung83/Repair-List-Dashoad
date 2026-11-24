"use client";
import {useState} from "react";
import type {RepairSubcategory} from "@/lib/repair-subcategories";

type Props={repairTypeId:number;items:RepairSubcategory[];busy:boolean;post:(body:Record<string,unknown>)=>Promise<boolean>};
const input={minHeight:36,minWidth:0,width:"100%",boxSizing:"border-box",border:"1px solid #c9d4dd",borderRadius:8,padding:"8px 10px",background:"white",color:"#1b2421",fontSize:13} as const;
const button={padding:"9px 12px",border:"1px solid #c9d4dd",borderRadius:8,background:"white",fontWeight:800,color:"#25453b",cursor:"pointer",fontSize:12} as const;
const rowStyle={display:"grid",gridTemplateColumns:"minmax(120px,1fr) 75px auto auto",gap:8,alignItems:"end",padding:"9px 0",borderBottom:"1px solid #e4e9e6"} as const;
const label={display:"grid",gap:4,fontSize:11,fontWeight:750,color:"#53645c"} as const;
function SubcategoryRow({item,busy,post}:{item:RepairSubcategory;busy:boolean;post:Props["post"]}){
 const [name,setName]=useState(item.name),[order,setOrder]=useState(String(item.sortOrder)),[active,setActive]=useState(item.active);
 const changed=name.trim()!==item.name||Number(order)!==item.sortOrder||active!==item.active;
 return <div style={rowStyle}>
  <label style={label}>Name<input style={input} value={name} maxLength={100} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
  <label style={label}>Order<input style={input} type="number" min={0} max={100000} step={1} disabled={busy} value={order} onChange={e=>setOrder(e.target.value)}/></label>
  <label style={{...label,display:"flex",alignItems:"center",minHeight:36}}><input type="checkbox" checked={active} disabled={busy} onChange={e=>setActive(e.target.checked)}/> Active</label>
  <button style={button} disabled={busy||!changed||!name.trim()||!order||!Number.isInteger(Number(order))||Number(order)<0||Number(order)>100000} onClick={()=>void post({action:"updateSubcategory",id:item.id,repairTypeId:item.repairTypeId,name,sortOrder:Number(order),active})}>Save</button>
 </div>;
}
export default function SubcategorySettings({repairTypeId,items,busy,post}:Props){
 const [name,setName]=useState("");
 async function add(){if(!name.trim()||busy)return;if(await post({action:"createSubcategory",repairTypeId,name:name.trim()}))setName("");}
 return <section style={{borderTop:"1px solid #e0e6eb",paddingTop:14,display:"grid",gap:9}}>
  <div><h2 style={{fontSize:18,margin:"0 0 5px"}}>Subcategories</h2><p style={{fontSize:12,color:"#68746f",margin:0}}>Add more specific repair classifications under this Repair Type. Once you add an active subcategory, technicians must select one before leaving the repair. If there are no active subcategories, technicians won't see another dropdown. Retire a subcategory by unchecking Active; previous repairs keep their classification. Existing checklists are unchanged.</p></div>
  <div style={{display:"flex",flexWrap:"wrap",gap:8}}><input style={{...input,flex:"1 1 200px",width:"auto"}} aria-label="New subcategory name" placeholder="New subcategory name" value={name} maxLength={100} disabled={busy} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void add();}}}/><button style={{...button,background:"#215b4e",color:"white",borderColor:"#215b4e"}} disabled={busy||!name.trim()} onClick={()=>void add()}>+ Add subcategory</button></div>
  {!items.length?<p style={{fontSize:12,color:"#68746f"}}>No subcategories configured. The existing repair workflow stays exactly the same.</p>:items.map(item=><SubcategoryRow key={item.id+":"+item.name+":"+item.sortOrder+":"+item.active} item={item} busy={busy} post={post}/>)}
 </section>;
}
