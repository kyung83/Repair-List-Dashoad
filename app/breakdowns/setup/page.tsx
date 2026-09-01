'use client';

import { useCallback, useEffect, useState } from 'react';

type Subcategory={id:number;categoryId:number;name:string;active:boolean;sortOrder:number};
type Category={id:number;name:string;requiresPosition:boolean;requiresTireSize:boolean;active:boolean;sortOrder:number;subcategories:Subcategory[]};

type CategoryDraft={name:string;requiresPosition:boolean;requiresTireSize:boolean;active:boolean;sortOrder:number};
type SubDraft={name:string;active:boolean;sortOrder:number};

const input:React.CSSProperties={width:'100%',minHeight:42,padding:'8px 10px',border:'1px solid #cbd5e1',borderRadius:9,background:'#fff',color:'#172033',fontSize:14,boxSizing:'border-box'};
const label:React.CSSProperties={display:'grid',gap:5,fontSize:12,fontWeight:850,color:'#334155'};

export default function BreakdownSetupPage(){
  const[categories,setCategories]=useState<Category[]>([]);
  const[categoryDrafts,setCategoryDrafts]=useState<Record<number,CategoryDraft>>({});
  const[subDrafts,setSubDrafts]=useState<Record<number,SubDraft>>({});
  const[newCategory,setNewCategory]=useState<CategoryDraft>({name:'',requiresPosition:false,requiresTireSize:false,active:true,sortOrder:100});
  const[newSubcategory,setNewSubcategory]=useState<Record<number,string>>({});
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState('');
  const[message,setMessage]=useState('');

  const applyCategories=useCallback((rows:Category[])=>{
    setCategories(rows);
    setCategoryDrafts(Object.fromEntries(rows.map((row)=>[row.id,{name:row.name,requiresPosition:row.requiresPosition,requiresTireSize:row.requiresTireSize,active:row.active,sortOrder:row.sortOrder}])));
    setSubDrafts(Object.fromEntries(rows.flatMap((row)=>row.subcategories.map((sub)=>[sub.id,{name:sub.name,active:sub.active,sortOrder:sub.sortOrder}]))));
  },[]);

  const load=useCallback(async()=>{
    setLoading(true);setMessage('');
    try{
      const response=await fetch('/api/breakdown-categories?manage=1',{cache:'no-store'});
      const payload=await response.json() as {categories?:Category[];error?:string};
      if(!response.ok)throw new Error(payload.error||'Breakdown setup could not be loaded.');
      applyCategories(Array.isArray(payload.categories)?payload.categories:[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Breakdown setup could not be loaded.');}
    finally{setLoading(false);}
  },[applyCategories]);

  useEffect(()=>{void load();},[load]);

  async function post(body:Record<string,unknown>){
    const response=await fetch('/api/breakdown-categories',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const payload=await response.json() as {categories?:Category[];error?:string};
    if(!response.ok)throw new Error(payload.error||'Setup change could not be saved.');
    applyCategories(Array.isArray(payload.categories)?payload.categories:[]);
  }
  async function patch(body:Record<string,unknown>){
    const response=await fetch('/api/breakdown-categories',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const payload=await response.json() as {categories?:Category[];error?:string};
    if(!response.ok)throw new Error(payload.error||'Setup change could not be saved.');
    applyCategories(Array.isArray(payload.categories)?payload.categories:[]);
  }

  async function addCategory(){
    setBusy('new-category');setMessage('');
    try{await post({action:'add-category',...newCategory});setNewCategory({name:'',requiresPosition:false,requiresTireSize:false,active:true,sortOrder:100});setMessage('Category added. It is now available on the driver breakdown screen.');}
    catch(error){setMessage(error instanceof Error?error.message:'Category could not be added.');}
    finally{setBusy('');}
  }
  async function saveCategory(id:number){
    const draft=categoryDrafts[id];if(!draft)return;
    setBusy(`category-${id}`);setMessage('');
    try{await patch({action:'update-category',id,...draft});setMessage('Category saved.');}
    catch(error){setMessage(error instanceof Error?error.message:'Category could not be saved.');}
    finally{setBusy('');}
  }
  async function addSubcategory(categoryId:number){
    const name=String(newSubcategory[categoryId]||'').trim();if(!name){setMessage('Enter a subcategory name first.');return;}
    setBusy(`new-sub-${categoryId}`);setMessage('');
    try{await post({action:'add-subcategory',categoryId,name,sortOrder:100});setNewSubcategory((current)=>({...current,[categoryId]:''}));setMessage('Subcategory added.');}
    catch(error){setMessage(error instanceof Error?error.message:'Subcategory could not be added.');}
    finally{setBusy('');}
  }
  async function saveSubcategory(id:number){
    const draft=subDrafts[id];if(!draft)return;
    setBusy(`sub-${id}`);setMessage('');
    try{await patch({action:'update-subcategory',id,...draft});setMessage('Subcategory saved.');}
    catch(error){setMessage(error instanceof Error?error.message:'Subcategory could not be saved.');}
    finally{setBusy('');}
  }

  return <main className="easy-page"><div className="easy-page-narrow" style={{maxWidth:980}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div><p className="easy-eyebrow">ROADSIDE OPERATIONS</p><h1 className="easy-title">Breakdown Setup</h1><p className="easy-subtitle">Control the categories and issue choices drivers see when they report a roadside breakdown.</p></div>
      <a className="easy-button" href="/breakdowns">Back to Breakdowns</a>
    </div>
    {message&&<div className="easy-notice" style={{marginTop:16}}>{message}</div>}

    <section className="easy-card" style={{marginTop:18}}><div className="easy-card-body">
      <p className="easy-eyebrow">ADD CATEGORY</p>
      <div style={{display:'grid',gridTemplateColumns:'2fr 110px 1fr auto',gap:10,alignItems:'end',marginTop:10}}>
        <label style={label}>Category name<input value={newCategory.name} onChange={(e)=>setNewCategory((c)=>({...c,name:e.target.value.slice(0,120)}))} style={input} placeholder="Example: Fuel System"/></label>
        <label style={label}>Order<input value={newCategory.sortOrder} onChange={(e)=>setNewCategory((c)=>({...c,sortOrder:Number(e.target.value)||0}))} style={input} inputMode="numeric"/></label>
        <label style={{display:'flex',gap:8,alignItems:'center',minHeight:42,fontSize:13,fontWeight:800,color:'#334155'}}><input type="checkbox" checked={newCategory.requiresPosition} onChange={(e)=>setNewCategory((c)=>({...c,requiresPosition:e.target.checked}))}/> Require axle/side position</label>
        <button type="button" className="easy-button orange" disabled={busy==='new-category'||!newCategory.name.trim()} onClick={()=>void addCategory()}>{busy==='new-category'?'Adding...':'+ Add Category'}</button>
      </div>
      <p className="easy-section-copy" style={{marginTop:10}}>Use “Require axle/side position” for things such as Brake Chambers. Tire size behavior stays attached to the built-in TIRES category.</p>
    </div></section>

    {loading?<div className="easy-empty" style={{marginTop:18}}>Loading breakdown setup...</div>:<div style={{display:'grid',gap:14,marginTop:18}}>{categories.map((category)=>{
      const draft=categoryDrafts[category.id]||{name:category.name,requiresPosition:category.requiresPosition,requiresTireSize:category.requiresTireSize,active:category.active,sortOrder:category.sortOrder};
      return <section key={category.id} className="easy-card"><div className="easy-card-body">
        <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div><p className="easy-eyebrow">CATEGORY</p><strong style={{fontSize:20,color:'#172033'}}>{category.name}</strong></div><span className={`easy-badge ${draft.active?'green':''}`}>{draft.active?'Active on driver screen':'Inactive / history only'}</span></div>
        <div style={{display:'grid',gridTemplateColumns:'2fr 110px 1fr 1fr auto',gap:10,alignItems:'end',marginTop:12}}>
          <label style={label}>Name<input value={draft.name} onChange={(e)=>setCategoryDrafts((c)=>({...c,[category.id]:{...draft,name:e.target.value.slice(0,120)}}))} style={input}/></label>
          <label style={label}>Order<input value={draft.sortOrder} onChange={(e)=>setCategoryDrafts((c)=>({...c,[category.id]:{...draft,sortOrder:Number(e.target.value)||0}}))} style={input} inputMode="numeric"/></label>
          <label style={{display:'flex',gap:8,alignItems:'center',minHeight:42,fontSize:13,fontWeight:800,color:'#334155'}}><input type="checkbox" checked={draft.requiresPosition} onChange={(e)=>setCategoryDrafts((c)=>({...c,[category.id]:{...draft,requiresPosition:e.target.checked}}))}/> Require position</label>
          <label style={{display:'flex',gap:8,alignItems:'center',minHeight:42,fontSize:13,fontWeight:800,color:'#334155'}}><input type="checkbox" checked={draft.active} onChange={(e)=>setCategoryDrafts((c)=>({...c,[category.id]:{...draft,active:e.target.checked}}))}/> Active</label>
          <button type="button" className="easy-button orange" disabled={busy===`category-${category.id}`} onClick={()=>void saveCategory(category.id)}>{busy===`category-${category.id}`?'Saving...':'Save'}</button>
        </div>

        <div style={{marginTop:18,paddingTop:16,borderTop:'1px solid #e2e8f0'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div><p className="easy-eyebrow">SUBCATEGORIES / ISSUE CHOICES</p><p className="easy-section-copy" style={{marginTop:4}}>When a category has active subcategories, the driver must pick one.</p></div></div>
          {category.subcategories.length===0?<div className="easy-empty" style={{marginTop:10}}>No subcategories. The driver will only choose the main category.</div>:<div style={{display:'grid',gap:8,marginTop:10}}>{category.subcategories.map((sub)=>{
            const subDraft=subDrafts[sub.id]||{name:sub.name,active:sub.active,sortOrder:sub.sortOrder};
            return <div key={sub.id} style={{display:'grid',gridTemplateColumns:'2fr 100px 1fr auto',gap:9,alignItems:'end',padding:10,border:'1px solid #dfe6ee',borderRadius:10,background:'#f8fafc'}}>
              <label style={label}>Issue name<input value={subDraft.name} onChange={(e)=>setSubDrafts((c)=>({...c,[sub.id]:{...subDraft,name:e.target.value.slice(0,120)}}))} style={input}/></label>
              <label style={label}>Order<input value={subDraft.sortOrder} onChange={(e)=>setSubDrafts((c)=>({...c,[sub.id]:{...subDraft,sortOrder:Number(e.target.value)||0}}))} style={input} inputMode="numeric"/></label>
              <label style={{display:'flex',gap:8,alignItems:'center',minHeight:42,fontSize:13,fontWeight:800,color:'#334155'}}><input type="checkbox" checked={subDraft.active} onChange={(e)=>setSubDrafts((c)=>({...c,[sub.id]:{...subDraft,active:e.target.checked}}))}/> Active</label>
              <button type="button" className="easy-button" disabled={busy===`sub-${sub.id}`} onClick={()=>void saveSubcategory(sub.id)}>{busy===`sub-${sub.id}`?'Saving...':'Save'}</button>
            </div>})}</div>}
          <div style={{display:'flex',gap:8,alignItems:'end',marginTop:10,flexWrap:'wrap'}}><label style={{...label,flex:'1 1 280px'}}>Add issue choice<input value={newSubcategory[category.id]||''} onChange={(e)=>setNewSubcategory((c)=>({...c,[category.id]:e.target.value.slice(0,120)}))} style={input} placeholder="Example: Gladhand / Air Line"/></label><button type="button" className="easy-button" disabled={busy===`new-sub-${category.id}`} onClick={()=>void addSubcategory(category.id)}>{busy===`new-sub-${category.id}`?'Adding...':'+ Add Subcategory'}</button></div>
        </div>
      </div></section>})}</div>}
  </div></main>;
}
