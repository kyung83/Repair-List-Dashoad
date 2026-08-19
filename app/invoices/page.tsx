"use client";

import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import ModuleTabs from "../module-tabs";

type BillingInvoice={id:number;invoiceNumber:string;repairId:number|null;repairIds:string[];repairCount:number;invoiceDate:string;dueDate:string;status:string;billToName:string;subtotal:number;taxRate:number;taxAmount:number;total:number;unit:string;repairTitle:string};
type BillingData={laborRate:number;customers:Array<{id:number;name:string;contactName:string;email:string;phone:string;address:string}>;invoices:BillingInvoice[];updatedAt:string};
type InvoiceDetail={invoice:{id:number;invoiceNumber:string;unit:string;repairTitle:string;repairCount:number;repairIds:string[];billToName:string;billToContact:string;billToEmail:string;billToPhone:string;billToAddress:string;invoiceDate:string;dueDate:string;status:string;subtotal:number;taxRate:number;taxAmount:number;total:number;notes:string;paidAt:string};repairs:Array<{id:string;title:string;status:string}>;lines:Array<{id:number;type:string;description:string;quantity:number;unitPrice:number;amount:number}>};

type WorkOrderRepair={id:string;issue:string;status:string;laborHours:number;laborCost:number;partCost:number;outsideCost:number;totalCost:number};
type WorkOrderNote={repairId:string;repairIssue:string;id:number;technician:string;detail:string;createdAt:string};
type WorkOrderLabor={repairId:string;repairIssue:string;id:number;technician:string;laborDate:string;hours:number;rate:number;amount:number;notes:string;startedAt?:string;endedAt?:string};
type WorkOrderPart={usageId:number;repairId:string;repairIssue:string;partNumber:string;description:string;quantity:number;unitCost:number;lineCost:number;costRecorded:boolean};
type ReviewPackage={id:string;repairIds:string[];unit:string;technician:string;completionDate:string;completedAt:string;reviewed:boolean;reviewedAt:string;reviewedBy:string;reviewNote:string;repairs:WorkOrderRepair[];technicianNotes:WorkOrderNote[];laborEntries:WorkOrderLabor[];usedParts:WorkOrderPart[];missingPartCostLines:number;laborHours:number;laborCost:number;partCost:number;outsideCost:number;totalCost:number};
type WorkOrderData={reviewPackages:ReviewPackage[]};

const input={padding:"10px 11px",border:"1px solid #cbd5e1",borderRadius:8,background:"white",boxSizing:"border-box" as const,width:"100%"};
const button={padding:"10px 14px",border:0,borderRadius:8,background:"#0d1b2b",color:"white",fontWeight:800,cursor:"pointer"} as const;
const panel={background:"white",border:"1px solid #dce2e7",borderRadius:14,padding:18} as const;
const th={textAlign:"left" as const,padding:"7px 8px",borderBottom:"1px solid #d8dee3",background:"#f3f5f7",fontSize:10,textTransform:"uppercase" as const,letterSpacing:".04em",color:"#596774"};
const td={padding:"7px 8px",borderBottom:"1px solid #edf0f2",verticalAlign:"top" as const,fontSize:11};
const fieldLabel={display:"grid",gap:5,fontSize:10,fontWeight:900,color:"#475a6c",letterSpacing:".02em"} as const;
const helpText={fontSize:9,fontWeight:500,color:"#74818c",lineHeight:1.35} as const;
const money=(v:number)=>Number(v||0).toLocaleString(undefined,{style:"currency",currency:"USD"});
const roundMoney=(v:number)=>Math.round(Number(v||0)*100)/100;
const nonNegative=(v:string)=>{const n=Number(v);return Number.isFinite(n)&&n>=0?n:0;};
function dateTime(value:string){if(!value)return"—";const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";const parsed=new Date(normalized);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
function timeOnly(value?:string){if(!value)return"";const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";const parsed=new Date(normalized);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}
function workOrderNumber(item:ReviewPackage){return item.repairIds.map(id=>id.replace(/^repair-/,"R-")).join(" / ")||item.id;}

export default function InvoicesPage(){
 const[data,setData]=useState<BillingData|null>(null);const[workOrders,setWorkOrders]=useState<ReviewPackage[]>([]);const[detail,setDetail]=useState<InvoiceDetail|null>(null);const[message,setMessage]=useState("");const[busy,setBusy]=useState(false);
 const[rate,setRate]=useState("100");const[customer,setCustomer]=useState({name:"",contactName:"",email:"",phone:"",address:""});const[workOrderSearch,setWorkOrderSearch]=useState("");
 const[form,setForm]=useState({workOrderId:"",customerId:"",billToName:"",invoiceDate:new Date().toISOString().slice(0,10),dueDate:"",taxRate:"0",partsMarkupPercent:"0",laborBillingRate:"",outsideMarkupPercent:"0",extraDescription:"",extraAmount:"",notes:""});

 async function load(){
  const[invoiceResponse,workOrderResponse]=await Promise.all([fetch('/api/invoices',{cache:'no-store'}),fetch('/api/work-orders',{cache:'no-store'})]);
  const invoicePayload=await invoiceResponse.json() as BillingData&{error?:string};
  const workOrderPayload=await workOrderResponse.json() as WorkOrderData&{error?:string};
  if(!invoiceResponse.ok)throw new Error(invoicePayload.error||'Unable to load invoices');
  if(!workOrderResponse.ok)throw new Error(workOrderPayload.error||'Unable to load completed work orders');
  setData(invoicePayload);setRate(String(invoicePayload.laborRate));setWorkOrders(workOrderPayload.reviewPackages??[]);
 }
 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:'Unable to load invoices'));},[]);

 const selected=useMemo(()=>workOrders.find(item=>item.id===form.workOrderId)??null,[workOrders,form.workOrderId]);
 const visibleWorkOrders=useMemo(()=>{
  const needle=workOrderSearch.trim().toLowerCase();
  const rows=!needle?workOrders:workOrders.filter(item=>[
    item.unit,item.technician,item.completedAt,item.reviewedBy,item.reviewNote,workOrderNumber(item),
    ...item.repairs.map(repair=>repair.issue),...item.usedParts.flatMap(part=>[part.partNumber,part.description]),
  ].join(" ").toLowerCase().includes(needle));
  return rows.slice(0,150);
 },[workOrders,workOrderSearch]);

 const pricing=useMemo(()=>{
  if(!selected)return null;
  const partsMarkup=nonNegative(form.partsMarkupPercent);
  const outsideMarkup=nonNegative(form.outsideMarkupPercent);
  const laborRateOverride=form.laborBillingRate.trim()===""?null:nonNegative(form.laborBillingRate);
  const parts=roundMoney(selected.usedParts.reduce((sum,part)=>{
    const billedUnit=roundMoney(Number(part.unitCost||0)*(1+partsMarkup/100));
    return sum+roundMoney(Number(part.quantity||0)*billedUnit);
  },0));
  const labor=roundMoney(selected.laborEntries.reduce((sum,entry)=>sum+roundMoney(Number(entry.hours||0)*(laborRateOverride??Number(entry.rate||0))),0));
  const outside=roundMoney(selected.repairs.reduce((sum,repair)=>sum+roundMoney(Number(repair.outsideCost||0)*(1+outsideMarkup/100)),0));
  const extra=form.extraDescription.trim()&&nonNegative(form.extraAmount)>0?roundMoney(nonNegative(form.extraAmount)):0;
  const subtotal=roundMoney(parts+labor+outside+extra);
  const taxRate=nonNegative(form.taxRate);
  const tax=roundMoney(subtotal*(taxRate/100));
  return{parts,labor,outside,extra,subtotal,tax,total:roundMoney(subtotal+tax),laborRateOverride};
 },[selected,form.partsMarkupPercent,form.outsideMarkupPercent,form.laborBillingRate,form.extraDescription,form.extraAmount,form.taxRate]);

 async function post(body:Record<string,unknown>){setBusy(true);try{const r=await fetch('/api/invoices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const p=await r.json() as any;if(!r.ok)throw new Error(p.error||'Action failed');await load();setMessage('Saved.');return p;}catch(e){setMessage(e instanceof Error?e.message:'Action failed');}finally{setBusy(false);}}
 async function openInvoice(id:number){const r=await fetch(`/api/invoices?id=${id}`,{cache:'no-store'});const p=await r.json() as InvoiceDetail&{error?:string};if(!r.ok)throw new Error(p.error||'Invoice could not be loaded');setDetail(p);}
 async function createInvoice(e:FormEvent){
  e.preventDefault();
  if(!selected){setMessage('Choose a completed work order first.');return;}
  const result=await post({
   action:'createInvoice',repairIds:selected.repairIds,customerId:form.customerId||null,billToName:form.billToName,
   invoiceDate:form.invoiceDate,dueDate:form.dueDate,taxRate:Number(form.taxRate),partsMarkupPercent:Number(form.partsMarkupPercent||0),
   laborBillingRate:form.laborBillingRate.trim()===''?null:Number(form.laborBillingRate),outsideMarkupPercent:Number(form.outsideMarkupPercent||0),
   extraDescription:form.extraDescription,extraAmount:Number(form.extraAmount||0),notes:form.notes,
  });
  if(result?.id)await openInvoice(result.id);
 }

 return <main style={{minHeight:'100vh',background:'#f3f5f7',padding:'34px 34px 110px',color:'#172033'}}>
  <ModuleTabs module="parts"/>
  <header><p style={{margin:0,color:'#0f766e',fontWeight:900,letterSpacing:'.14em',fontSize:12}}>SHOP BILLING</p><h1 style={{margin:'7px 0 0',fontSize:34}}>Invoices & Labor Rate</h1><p style={{color:'#64748b'}}>Open the complete finished work order, verify every repair, labor entry, part and outside charge, then create the invoice from that package.</p></header>
  {message&&<div style={{marginTop:14,padding:11,background:'#fff8e6',border:'1px solid #f2c66d',borderRadius:8}}>{message}</div>}

  <section style={{...panel,marginTop:18,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16}}>
   <form onSubmit={e=>{e.preventDefault();void post({action:'saveLaborRate',laborRate:Number(rate)})}} style={{display:'grid',gap:9}}><strong>Default shop labor rate</strong><small style={{color:'#64748b'}}>New labor entries default to this rate. Existing labor stays at its original rate.</small><Field label="Default rate ($ / hr)"><input type="number" min="0" step="0.01" value={rate} onChange={e=>setRate(e.target.value)} style={input}/></Field><button disabled={busy} style={button}>Save rate</button></form>
   <form onSubmit={e=>{e.preventDefault();void post({action:'saveCustomer',...customer}).then(()=>setCustomer({name:'',contactName:'',email:'',phone:'',address:''}))}} style={{display:'grid',gap:9}}><strong>Add invoice customer</strong><input required placeholder="Customer / company" value={customer.name} onChange={e=>setCustomer({...customer,name:e.target.value})} style={input}/><input placeholder="Contact" value={customer.contactName} onChange={e=>setCustomer({...customer,contactName:e.target.value})} style={input}/><input type="email" placeholder="Email" value={customer.email} onChange={e=>setCustomer({...customer,email:e.target.value})} style={input}/><input placeholder="Phone" value={customer.phone} onChange={e=>setCustomer({...customer,phone:e.target.value})} style={input}/><textarea placeholder="Billing address" value={customer.address} onChange={e=>setCustomer({...customer,address:e.target.value})} style={input}/><button disabled={busy} style={button}>Save customer</button></form>
  </section>

  <form onSubmit={createInvoice} style={{...panel,marginTop:18}}>
   <div><h2 style={{margin:0}}>Create invoice from completed work order</h2><small style={{color:'#64748b'}}>Select the whole work order first. The invoice snapshots all repairs, parts, labor and outside charges so later repair edits do not rewrite an existing invoice.</small></div>
   <div style={{display:'grid',gridTemplateColumns:'minmax(300px,390px) minmax(620px,1fr)',gap:14,marginTop:14,alignItems:'start'}}>
    <aside style={{border:'1px solid #d9e0e5',borderRadius:10,overflow:'hidden',background:'#fafbfc'}}>
     <div style={{padding:10,borderBottom:'1px solid #d9e0e5'}}><input value={workOrderSearch} onChange={e=>setWorkOrderSearch(e.target.value)} placeholder="Search unit, repair, technician, part..." style={input}/><div style={{fontSize:10,color:'#6c7884',marginTop:6}}>{visibleWorkOrders.length}{workOrders.length>150&&!workOrderSearch?' of ': ' '}completed work order{workOrders.length===1?'':'s'} shown</div></div>
     <div style={{maxHeight:520,overflowY:'auto'}}>{visibleWorkOrders.map(item=><button key={item.id} type="button" onClick={()=>setForm({...form,workOrderId:item.id})} style={{display:'grid',width:'100%',border:0,borderBottom:'1px solid #e4e8eb',borderLeft:item.id===form.workOrderId?'4px solid #0d1b2b':'4px solid transparent',background:item.id===form.workOrderId?'#eaf1f6':'white',padding:'10px 9px',textAlign:'left',cursor:'pointer',gap:3,color:'#263746'}}><strong style={{fontSize:13}}>Unit {item.unit||'—'}</strong><span style={{fontSize:10,color:'#65727d'}}>{dateTime(item.completedAt)}</span><span style={{fontSize:11}}>{item.technician||'Unassigned'} · {item.repairs.length} repair{item.repairs.length===1?'':'s'}</span><span style={{fontSize:10,color:'#65727d'}}>{workOrderNumber(item)} · {money(item.totalCost)}</span></button>)}{!visibleWorkOrders.length&&<div style={{padding:18,color:'#6c7884',fontSize:12}}>No completed work orders match this search.</div>}</div>
    </aside>
    <div>{selected?<WorkOrderInvoicePreview item={selected}/>:<div style={{border:'1px dashed #b8c3cb',borderRadius:10,padding:34,textAlign:'center',color:'#697681',background:'#fafbfc'}}><strong style={{display:'block',fontSize:15,color:'#334454'}}>Choose a completed work order</strong><span style={{display:'block',marginTop:5,fontSize:12}}>The complete repair package will open here before you create the invoice.</span></div>}</div>
   </div>

   <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid #dce2e7'}}>
    <h3 style={{margin:'0 0 4px'}}>Invoice price adjustments</h3>
    <p style={{margin:'0 0 10px',color:'#64748b',fontSize:11}}>Use these when customer billing needs to be higher than the recorded work-order cost. They change <strong>only this invoice</strong>; the work order, inventory cost, and technician labor history stay unchanged.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,padding:12,border:'1px solid #d6e0e7',borderRadius:10,background:'#f8fafb'}}>
     <Field label="Parts markup (%)" help="Example: 20 adds 20% to each recorded part cost."><input type="number" min="0" max="1000" step="0.01" value={form.partsMarkupPercent} onChange={e=>setForm({...form,partsMarkupPercent:e.target.value})} style={input}/></Field>
     <Field label="Labor invoice rate ($ / hr)" help={`Leave blank to use each recorded labor rate. Current shop default: ${money(data?.laborRate??0)} / hr.`}><input type="number" min="0" step="0.01" placeholder="Use recorded rates" value={form.laborBillingRate} onChange={e=>setForm({...form,laborBillingRate:e.target.value})} style={input}/></Field>
     <Field label="Outside / vendor markup (%)" help="Applied to the recorded outside or vendor charge."><input type="number" min="0" max="1000" step="0.01" value={form.outsideMarkupPercent} onChange={e=>setForm({...form,outsideMarkupPercent:e.target.value})} style={input}/></Field>
    </div>

    {selected&&pricing&&<div style={{marginTop:10,border:'1px solid #cbd7de',borderRadius:10,overflow:'hidden',background:'white'}}>
     <div style={{padding:'8px 10px',background:'#eef3f6',fontSize:10,fontWeight:950,letterSpacing:'.05em',color:'#34495a'}}>CUSTOMER BILLING PREVIEW</div>
     <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:0}}>
      <PriceBox label="Recorded work order" value={money(selected.totalCost)} note="Original cost history"/>
      <PriceBox label="Parts billed" value={money(pricing.parts)} note={`${form.partsMarkupPercent||'0'}% markup`}/>
      <PriceBox label="Labor billed" value={money(pricing.labor)} note={pricing.laborRateOverride===null?'Recorded rates':`${money(pricing.laborRateOverride)} / hr`}/>
      <PriceBox label="Outside billed" value={money(pricing.outside)} note={`${form.outsideMarkupPercent||'0'}% markup`}/>
      {pricing.extra>0&&<PriceBox label="Extra line" value={money(pricing.extra)} note={form.extraDescription||'Extra charge'}/>} 
      <PriceBox label="Subtotal" value={money(pricing.subtotal)} note="Before tax"/>
      <PriceBox label={`Tax (${form.taxRate||'0'}%)`} value={money(pricing.tax)} note="Calculated on subtotal"/>
      <PriceBox label="Estimated invoice total" value={money(pricing.total)} note="Customer total" strong/>
     </div>
    </div>}
   </div>

   <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid #dce2e7'}}>
    <h3 style={{margin:'0 0 10px'}}>Invoice details</h3>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
     <Field label="Saved customer"><select value={form.customerId} onChange={e=>{const c=data?.customers.find(x=>String(x.id)===e.target.value);setForm({...form,customerId:e.target.value,billToName:c?.name??form.billToName})}} style={input}><option value="">No saved customer</option>{(data?.customers??[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
     <Field label="Bill to name"><input required placeholder="Customer / company" value={form.billToName} onChange={e=>setForm({...form,billToName:e.target.value})} style={input}/></Field>
     <Field label="Invoice date"><input type="date" value={form.invoiceDate} onChange={e=>setForm({...form,invoiceDate:e.target.value})} style={input}/></Field>
     <Field label="Due date" help="Optional"><input type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})} style={input}/></Field>
     <Field label="Tax rate (%)" help="Enter 0 when no tax applies."><input type="number" min="0" step="0.01" value={form.taxRate} onChange={e=>setForm({...form,taxRate:e.target.value})} style={input}/></Field>
     <Field label="Extra line description" help="Optional fixed additional charge"><input placeholder="Example: Shop supplies" value={form.extraDescription} onChange={e=>setForm({...form,extraDescription:e.target.value})} style={input}/></Field>
     <Field label="Extra line amount ($)" help="Used only when a description is entered"><input type="number" min="0" step="0.01" value={form.extraAmount} onChange={e=>setForm({...form,extraAmount:e.target.value})} style={input}/></Field>
     <div style={{gridColumn:'1/-1'}}><Field label="Invoice notes" help="Optional note shown with the invoice"><textarea placeholder="Invoice notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} style={{...input,minHeight:70}}/></Field></div>
    </div>
    <div style={{marginTop:12,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><span style={{fontWeight:800}}>{pricing?`Estimated invoice total: ${money(pricing.total)}`:selected?`Work order total before adjustments: ${money(selected.totalCost)}`:'Choose a completed work order to build the invoice.'}</span><button disabled={busy||!selected} style={{...button,padding:'12px 18px'}}>{busy?'Saving...':'CREATE DRAFT INVOICE FROM WORK ORDER'}</button></div>
   </div>
  </form>

  <section style={{...panel,marginTop:18}}><h2 style={{marginTop:0}}>Invoices</h2><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:1080}}><thead><tr>{['Invoice','Date','Customer','Unit','Work order','Status','Subtotal','Tax','Total','Actions'].map(h=><th key={h} style={{textAlign:'left',padding:9,borderBottom:'1px solid #ddd'}}>{h}</th>)}</tr></thead><tbody>{(data?.invoices??[]).map(i=><tr key={i.id}><td style={{padding:9}}>{i.invoiceNumber}</td><td style={{padding:9}}>{i.invoiceDate}</td><td style={{padding:9}}>{i.billToName}</td><td style={{padding:9,fontWeight:800}}>{i.unit}</td><td style={{padding:9}}>{i.repairCount>1?<><strong>{i.repairCount} repairs</strong><small style={{display:'block',color:'#6b7781',maxWidth:320}}>{i.repairTitle}</small></>:i.repairTitle}</td><td style={{padding:9}}>{i.status}</td><td style={{padding:9}}>{money(i.subtotal)}</td><td style={{padding:9}}><strong>{money(i.taxAmount)}</strong><small style={{display:'block',color:'#6b7781'}}>{i.taxRate}%</small></td><td style={{padding:9,fontWeight:800}}>{money(i.total)}</td><td style={{padding:9,display:'flex',gap:6,flexWrap:'wrap'}}><button type="button" style={button} onClick={()=>void openInvoice(i.id)}>View</button>{['Sent','Paid','Void'].filter(status=>status!==i.status).map(status=><button key={status} type="button" style={{...button,background:'#64748b'}} onClick={()=>void post({action:'updateStatus',id:i.id,status})}>{status}</button>)}</td></tr>)}</tbody></table></div></section>

  {detail&&<section id="invoice-print" style={{...panel,marginTop:18}}><div style={{display:'flex',justifyContent:'space-between',gap:18,flexWrap:'wrap'}}><div><h2 style={{margin:0,fontSize:28}}>INVOICE</h2><strong>{detail.invoice.invoiceNumber}</strong><p>Northern Logistics Worldwide</p></div><div><strong>Bill to</strong><div>{detail.invoice.billToName}</div><div>{detail.invoice.billToContact}</div><div>{detail.invoice.billToEmail}</div><div>{detail.invoice.billToPhone}</div><div style={{whiteSpace:'pre-line'}}>{detail.invoice.billToAddress}</div></div><div><div>Date: {detail.invoice.invoiceDate}</div><div>Due: {detail.invoice.dueDate||'—'}</div><div>Status: {detail.invoice.status}</div><div>Unit: <strong>{detail.invoice.unit}</strong></div></div></div>
   <div style={{marginTop:12,padding:10,border:'1px solid #dce2e7',background:'#f8fafb'}}><strong>{detail.repairs.length>1?`${detail.repairs.length} repairs from completed work order`:'Repair'}</strong><div style={{marginTop:5,display:'grid',gap:3}}>{detail.repairs.map(repair=><div key={repair.id}><strong>{repair.id.replace(/^repair-/, 'R-')}</strong> — {repair.title}</div>)}</div></div>
   <table style={{width:'100%',borderCollapse:'collapse',marginTop:12}}><thead><tr>{['Description','Qty','Rate','Amount'].map(h=><th key={h} style={{textAlign:'left',padding:8,borderBottom:'1px solid #ddd'}}>{h}</th>)}</tr></thead><tbody>{detail.lines.map(line=><tr key={line.id}><td style={{padding:8,borderBottom:'1px solid #eee'}}>{line.description}</td><td style={{padding:8,borderBottom:'1px solid #eee'}}>{line.quantity}</td><td style={{padding:8,borderBottom:'1px solid #eee'}}>{money(line.unitPrice)}</td><td style={{padding:8,borderBottom:'1px solid #eee'}}>{money(line.amount)}</td></tr>)}</tbody></table><div style={{marginLeft:'auto',width:280,marginTop:18,display:'grid',gap:6}}><div style={{display:'flex',justifyContent:'space-between'}}><span>Subtotal</span><strong>{money(detail.invoice.subtotal)}</strong></div><div style={{display:'flex',justifyContent:'space-between'}}><span>Tax ({detail.invoice.taxRate}%)</span><strong>{money(detail.invoice.taxAmount)}</strong></div><div style={{display:'flex',justifyContent:'space-between',fontSize:20}}><span>Total</span><strong>{money(detail.invoice.total)}</strong></div></div>{detail.invoice.notes&&<p><strong>Notes:</strong> {detail.invoice.notes}</p>}<button type="button" style={{...button,marginTop:14}} onClick={()=>window.print()}>Print invoice</button>
  </section>}
 </main>;
}

function WorkOrderInvoicePreview({item}:{item:ReviewPackage}){
 return <section style={{border:'1px solid #ccd5db',borderRadius:10,overflow:'hidden',background:'white'}}>
  <header style={{padding:'12px 14px',background:'#172b3e',color:'white',display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',flexWrap:'wrap'}}><div><span style={{display:'block',fontSize:9,fontWeight:900,letterSpacing:'.1em',color:'#f7a55e'}}>WORK ORDER SELECTED FOR BILLING</span><strong style={{display:'block',fontSize:22,marginTop:2}}>Unit {item.unit||'—'}</strong><span style={{fontSize:10,opacity:.82}}>{workOrderNumber(item)}</span></div><div style={{textAlign:'right',fontSize:11}}><strong style={{display:'block'}}>{item.technician||'Unassigned'}</strong><span>{dateTime(item.completedAt)}</span><span style={{display:'block',marginTop:3,fontWeight:900,color:item.reviewed?'#a7f3d0':'#fde68a'}}>{item.reviewed?'MANAGER REVIEWED':'NEEDS MANAGER REVIEW'}</span></div></header>
  {!item.reviewed&&<div style={{padding:'8px 10px',background:'#fff7d6',borderBottom:'1px solid #e6c96f',fontSize:11,fontWeight:800,color:'#7a5600'}}>This completed work order has not been manager-reviewed yet. You can see the full package before deciding whether to invoice it.</div>}

  <PreviewSection title="Repairs completed"><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:720}}><thead><tr><th style={th}>Repair</th><th style={th}>Description</th><th style={th}>Labor</th><th style={th}>Parts</th><th style={th}>Outside</th><th style={th}>Total</th></tr></thead><tbody>{item.repairs.map(repair=><tr key={repair.id}><td style={td}><strong>{repair.id.replace(/^repair-/,"R-")}</strong></td><td style={td}>{repair.issue}<small style={{display:'block',color:'#71808b'}}>{repair.status}</small></td><td style={{...td,textAlign:'right'}}>{repair.laborHours.toFixed(2)} hr<br/><strong>{money(repair.laborCost)}</strong></td><td style={{...td,textAlign:'right'}}>{money(repair.partCost)}</td><td style={{...td,textAlign:'right'}}>{money(repair.outsideCost)}</td><td style={{...td,textAlign:'right',fontWeight:900}}>{money(repair.totalCost)}</td></tr>)}</tbody></table></div></PreviewSection>

  <PreviewSection title="Technician repair notes">{item.technicianNotes.length?<div>{item.technicianNotes.map(note=><div key={note.id} style={{padding:'7px 9px',borderBottom:'1px solid #edf0f2',display:'grid',gridTemplateColumns:'155px 1fr',gap:9,fontSize:11}}><div><strong>{note.technician||'Technician'}</strong><small style={{display:'block',color:'#74808a'}}>{dateTime(note.createdAt)}</small><small style={{display:'block',color:'#74808a'}}>{note.repairId.replace(/^repair-/,"R-")}</small></div><div style={{whiteSpace:'pre-wrap'}}>{note.detail}</div></div>)}</div>:<Empty text="No technician repair notes recorded."/>}</PreviewSection>

  <PreviewSection title="Labor"><div style={{overflowX:'auto'}}>{item.laborEntries.length?<table style={{width:'100%',borderCollapse:'collapse',minWidth:760}}><thead><tr><th style={th}>Repair</th><th style={th}>Technician</th><th style={th}>Date / time</th><th style={th}>Hours</th><th style={th}>Rate</th><th style={th}>Amount</th><th style={th}>Note</th></tr></thead><tbody>{item.laborEntries.map(entry=>{const start=timeOnly(entry.startedAt);const end=timeOnly(entry.endedAt);const range=start&&end?`${start}–${end}`:start?`Started ${start}`:end?`Ended ${end}`:'';return <tr key={entry.id}><td style={td}>{entry.repairId.replace(/^repair-/,"R-")}</td><td style={td}><strong>{entry.technician||'—'}</strong></td><td style={td}>{entry.laborDate}{range&&<small style={{display:'block',color:'#74808a'}}>{range}</small>}</td><td style={{...td,textAlign:'right'}}>{Number(entry.hours||0).toFixed(2)}</td><td style={{...td,textAlign:'right'}}>{money(entry.rate)}</td><td style={{...td,textAlign:'right',fontWeight:800}}>{money(entry.amount)}</td><td style={td}>{entry.notes||entry.repairIssue||'—'}</td></tr>})}</tbody></table>:<Empty text="No labor entries recorded."/>}</div></PreviewSection>

  <PreviewSection title="Parts applied"><div style={{overflowX:'auto'}}>{item.usedParts.length?<table style={{width:'100%',borderCollapse:'collapse',minWidth:680}}><thead><tr><th style={th}>Repair</th><th style={th}>Part</th><th style={th}>Description</th><th style={th}>Qty</th><th style={th}>Unit cost</th><th style={th}>Line total</th></tr></thead><tbody>{item.usedParts.map(part=><tr key={part.usageId}><td style={td}>{part.repairId.replace(/^repair-/,"R-")}</td><td style={td}><strong>{part.partNumber}</strong></td><td style={td}>{part.description}</td><td style={{...td,textAlign:'right'}}>{part.quantity}</td><td style={{...td,textAlign:'right'}}>{part.costRecorded?money(part.unitCost):'Cost missing'}</td><td style={{...td,textAlign:'right',fontWeight:800}}>{part.costRecorded?money(part.lineCost):'—'}</td></tr>)}</tbody></table>:<Empty text="No parts were recorded on this work order."/>}</div>{item.missingPartCostLines>0&&<div style={{padding:'7px 9px',background:'#fff4d8',fontSize:11,fontWeight:800,color:'#7c5900'}}>{item.missingPartCostLines} part line{item.missingPartCostLines===1?' is':'s are'} missing recorded cost.</div>}</PreviewSection>

  <div style={{display:'grid',gridTemplateColumns:'1fr 330px',gap:12,padding:12,background:'#f8fafb',borderTop:'1px solid #d7dfe4'}}><div><strong style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.05em'}}>Manager review</strong><div style={{marginTop:5,fontSize:11,whiteSpace:'pre-wrap'}}>{item.reviewNote||'No manager review note recorded.'}</div>{item.reviewed&&<small style={{display:'block',marginTop:5,color:'#687680'}}>Reviewed by {item.reviewedBy||'Manager'} · {dateTime(item.reviewedAt)}</small>}<a href={`/work-orders/print?id=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer" style={{...button,display:'inline-block',textDecoration:'none',marginTop:9,padding:'7px 10px',fontSize:10}}>OPEN FULL WORK ORDER PRINT VIEW</a></div><div style={{border:'1px solid #cbd4da',background:'white'}}><Total label="Labor" value={`${item.laborHours.toFixed(2)} hr · ${money(item.laborCost)}`}/><Total label="Parts" value={money(item.partCost)}/><Total label="Outside" value={money(item.outsideCost)}/><Total label="WORK ORDER TOTAL" value={money(item.totalCost)} grand/></div></div>
 </section>;
}

function Field({label,help,children}:{label:string;help?:string;children:ReactNode}){return <label style={fieldLabel}><span>{label}</span>{children}{help&&<small style={helpText}>{help}</small>}</label>;}
function PriceBox({label,value,note,strong=false}:{label:string;value:string;note:string;strong?:boolean}){return <div style={{padding:'10px 11px',borderRight:'1px solid #e0e6ea',borderBottom:'1px solid #e0e6ea',background:strong?'#172b3e':'white',color:strong?'white':'#293b4b'}}><span style={{display:'block',fontSize:9,fontWeight:900,textTransform:'uppercase',letterSpacing:'.04em',opacity:strong ? .85 : 1}}>{label}</span><strong style={{display:'block',fontSize:strong?18:14,marginTop:3}}>{value}</strong><small style={{display:'block',marginTop:2,fontSize:9,opacity:.72}}>{note}</small></div>;}
function PreviewSection({title,children}:{title:string;children:ReactNode}){return <section style={{borderTop:'1px solid #dbe2e7'}}><div style={{padding:'6px 9px',fontSize:10,fontWeight:900,letterSpacing:'.05em',textTransform:'uppercase',background:'#eef2f4',color:'#334555'}}>{title}</div>{children}</section>;}
function Empty({text}:{text:string}){return <div style={{padding:'10px',color:'#71808b',fontSize:11,fontStyle:'italic'}}>{text}</div>;}
function Total({label,value,grand=false}:{label:string;value:string;grand?:boolean}){return <div style={{display:'flex',justifyContent:'space-between',gap:10,padding:grand?'8px':'6px 8px',borderBottom:grand?0:'1px solid #e1e5e8',background:grand?'#172b3e':'white',color:grand?'white':'#293946',fontSize:grand?12:11}}><span>{label}</span><strong>{value}</strong></div>;}
