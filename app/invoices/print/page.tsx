"use client";

import { useEffect, useState } from "react";

type InvoiceDetail={
  invoice:{
    id:number;invoiceNumber:string;unit:string;repairTitle:string;repairCount:number;repairIds:string[];
    billToName:string;billToContact:string;billToEmail:string;billToPhone:string;billToAddress:string;
    invoiceDate:string;dueDate:string;status:string;subtotal:number;taxRate:number;taxAmount:number;total:number;
    notes:string;paidAt:string;
  };
  repairs:Array<{id:string;title:string;status:string}>;
  lines:Array<{id:number;type:string;description:string;quantity:number;unitPrice:number;amount:number}>;
};

function money(value:number){return Number(value||0).toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:2});}
function lineType(type:string){
  if(type==="part")return "PART";
  if(type==="labor")return "LABOR";
  if(type==="outside")return "OUTSIDE";
  return "OTHER";
}
function paymentTermsLabel(invoiceDate:string,dueDate:string){
  if(!dueDate)return "Not set";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))return "Set date";
  const start=new Date(`${invoiceDate}T00:00:00Z`);
  const due=new Date(`${dueDate}T00:00:00Z`);
  if(Number.isNaN(start.getTime())||Number.isNaN(due.getTime()))return "Set date";
  const days=Math.round((due.getTime()-start.getTime())/86400000);
  if(days===0)return "Due on receipt";
  if([15,30,60,90].includes(days))return `Net ${days}`;
  return "Set date";
}

export default function InvoicePrintPage(){
  const[data,setData]=useState<InvoiceDetail|null>(null);
  const[message,setMessage]=useState("Loading invoice…");

  useEffect(()=>{
    let cancelled=false;
    const params=new URLSearchParams(window.location.search);
    const number=params.get("number")||"";
    const id=params.get("id")||"";
    const query=number?`number=${encodeURIComponent(number)}`:id?`id=${encodeURIComponent(id)}`:"";
    if(!query){setMessage("Choose an invoice from the invoice page first.");return;}
    void fetch(`/api/invoices?${query}`,{cache:"no-store"})
      .then(async response=>{
        const payload=await response.json() as InvoiceDetail&{error?:string};
        if(!response.ok)throw new Error(payload.error||"Invoice could not be loaded.");
        if(cancelled)return;
        setData(payload);setMessage("");
      })
      .catch((error:unknown)=>{if(!cancelled)setMessage(error instanceof Error?error.message:"Invoice could not be loaded.");});
    return()=>{cancelled=true;};
  },[]);

  return <main className="invoice-print-page">
    <style>{printCss}</style>
    <div className="invoice-print-controls">
      <a href="/invoices">← Back to invoices</a>
      <div>
        <strong>Professional invoice print view</strong>
        <span>The printed page contains only the customer invoice and Northern branding.</span>
      </div>
      <button type="button" disabled={!data} onClick={()=>window.print()}>PRINT INVOICE</button>
    </div>

    {message&&<div className="invoice-message">{message}</div>}
    {data&&<InvoiceSheet detail={data}/>} 
  </main>;
}

function InvoiceSheet({detail}:{detail:InvoiceDetail}){
  const invoice=detail.invoice;
  const isVoid=invoice.status==="Void";
  return <article className={`invoice-sheet${isVoid?" is-void":""}`}>
    {isVoid&&<div className="void-watermark">VOID</div>}
    <header className="invoice-header print-block">
      <div className="brand-block">
        <img src="/northern-logistics-logo-exact.svg?v=1" alt="Northern Logistics Worldwide"/>
        <div className="brand-name">NORTHERN LOGISTICS WORLDWIDE</div>
      </div>
      <div className="invoice-title-block">
        <div className="invoice-kicker">CUSTOMER BILLING</div>
        <h1>INVOICE</h1>
        <div className="invoice-number">{invoice.invoiceNumber}</div>
      </div>
    </header>

    <div className="orange-rule"/>

    <section className="top-grid print-block">
      <div className="bill-box">
        <div className="box-label">BILL TO</div>
        <strong className="bill-name">{invoice.billToName||"—"}</strong>
        {invoice.billToContact&&<div>{invoice.billToContact}</div>}
        {invoice.billToEmail&&<div>{invoice.billToEmail}</div>}
        {invoice.billToPhone&&<div>{invoice.billToPhone}</div>}
        {invoice.billToAddress&&<div className="address">{invoice.billToAddress}</div>}
      </div>
      <div className="meta-box">
        <Meta label="Invoice date" value={invoice.invoiceDate||"—"}/>
        <Meta label="Payment terms" value={paymentTermsLabel(invoice.invoiceDate,invoice.dueDate)}/>
        <Meta label="Due date" value={invoice.dueDate||"—"}/>
        <Meta label="Status" value={invoice.status||"—"} strong={isVoid}/>
        <Meta label="Unit" value={invoice.unit||"—"}/>
      </div>
    </section>

    <section className="work-order-box print-block">
      <div className="box-label">WORK ORDER / REPAIRS</div>
      <div className="repair-grid">
        {detail.repairs.length?detail.repairs.map(repair=><div key={repair.id} className="repair-row">
          <strong>{repair.id.replace(/^repair-/,"R-")}</strong><span>{repair.title}</span>
        </div>):<div className="repair-row"><span>No repair references recorded.</span></div>}
      </div>
    </section>

    <section className="line-section">
      <table className="invoice-lines">
        <thead><tr><th className="type-col">Type</th><th>Description</th><th className="num qty-col">Qty</th><th className="num rate-col">Rate</th><th className="num amount-col">Amount</th></tr></thead>
        <tbody>{detail.lines.map(line=><tr key={line.id}>
          <td><span className={`line-type type-${line.type}`}>{lineType(line.type)}</span></td>
          <td>{line.description}</td>
          <td className="num">{Number(line.quantity||0).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
          <td className="num">{money(line.unitPrice)}</td>
          <td className="num"><strong>{money(line.amount)}</strong></td>
        </tr>)}</tbody>
      </table>
    </section>

    <section className="bottom-grid print-block">
      <div className="notes-box">
        <div className="box-label">INVOICE NOTES</div>
        <div className="notes-copy">{invoice.notes||"Thank you for your business."}</div>
      </div>
      <div className="totals-box">
        <Total label="Subtotal" value={money(invoice.subtotal)}/>
        <Total label={`Tax (${invoice.taxRate}%)`} value={money(invoice.taxAmount)}/>
        <Total label="TOTAL" value={money(invoice.total)} grand/>
      </div>
    </section>

    <footer className="invoice-footer print-block">
      <span>Northern Logistics Worldwide</span>
      <span>{invoice.invoiceNumber}</span>
      <span>Unit {invoice.unit||"—"}</span>
    </footer>
  </article>;
}

function Meta({label,value,strong=false}:{label:string;value:string;strong?:boolean}){return <div className="meta-row"><span>{label}</span><strong className={strong?"void-text":""}>{value}</strong></div>;}
function Total({label,value,grand=false}:{label:string;value:string;grand?:boolean}){return <div className={grand?"total-row grand":"total-row"}><span>{label}</span><strong>{value}</strong></div>;}

const printCss=`
.invoice-print-page{min-height:100vh;background:#e9edf0;padding:26px 30px 70px;color:#182633;font-family:Arial,Helvetica,sans-serif}.invoice-print-controls{max-width:980px;margin:0 auto 18px;display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;background:white;border:1px solid #ccd5db;padding:12px 14px}.invoice-print-controls>a{color:#204b68;font-weight:800;text-decoration:none}.invoice-print-controls>div{display:grid;gap:3px}.invoice-print-controls>div span{font-size:11px;color:#657480}.invoice-print-controls button{border:0;background:#172b3e;color:white;padding:11px 16px;font-weight:900;cursor:pointer}.invoice-print-controls button:disabled{opacity:.45;cursor:not-allowed}.invoice-message{max-width:980px;margin:20px auto;padding:18px;background:#fff8e6;border:1px solid #e0bc6d}.invoice-sheet{position:relative;box-sizing:border-box;width:min(8.5in,100%);min-height:10.1in;margin:0 auto;background:white;padding:.45in .5in .36in;box-shadow:0 8px 28px rgba(25,41,54,.14);overflow:hidden}.invoice-header{display:flex;justify-content:space-between;gap:30px;align-items:flex-start}.brand-block{max-width:4.7in}.brand-block img{display:block;width:3.15in;max-width:100%;height:auto}.brand-name{margin-top:8px;font-size:10px;font-weight:900;letter-spacing:.13em;color:#536473}.invoice-title-block{text-align:right;min-width:2.25in}.invoice-kicker{font-size:9px;font-weight:900;letter-spacing:.13em;color:#e46f1a}.invoice-title-block h1{margin:3px 0 1px;font-size:34px;line-height:1;color:#172b3e;letter-spacing:.04em}.invoice-number{font-size:13px;font-weight:900;color:#536473}.orange-rule{height:4px;background:#f47b20;margin:15px 0 18px}.top-grid{display:grid;grid-template-columns:1.35fr .9fr;gap:18px}.bill-box,.meta-box,.work-order-box,.notes-box{border:1px solid #cfd8de;background:white}.bill-box{padding:12px 14px;min-height:1.3in;font-size:11px;line-height:1.5}.bill-name{display:block;font-size:14px;color:#172b3e;margin-bottom:3px}.address{white-space:pre-line;margin-top:3px}.box-label{font-size:9px;font-weight:950;letter-spacing:.11em;color:#5a6b79;margin-bottom:7px}.meta-box{padding:4px 12px}.meta-row{display:flex;justify-content:space-between;gap:18px;padding:8px 0;border-bottom:1px solid #e4e8eb;font-size:11px}.meta-row:last-child{border-bottom:0}.meta-row span{color:#657480}.meta-row strong{text-align:right}.void-text{color:#a91d2c}.work-order-box{margin-top:14px;padding:10px 12px}.repair-grid{display:grid;gap:4px}.repair-row{display:grid;grid-template-columns:72px 1fr;gap:10px;font-size:10.5px;line-height:1.35}.repair-row strong{color:#172b3e}.line-section{margin-top:16px}.invoice-lines{width:100%;border-collapse:collapse;table-layout:fixed}.invoice-lines th{background:#172b3e;color:white;text-align:left;padding:8px 7px;font-size:9px;letter-spacing:.06em;text-transform:uppercase}.invoice-lines td{padding:8px 7px;border-bottom:1px solid #dfe5e9;vertical-align:top;font-size:10px;line-height:1.35}.invoice-lines .num{text-align:right}.type-col{width:.72in}.qty-col{width:.6in}.rate-col{width:.9in}.amount-col{width:1in}.line-type{display:inline-block;padding:2px 5px;border:1px solid #cad4da;font-size:8px;font-weight:900;letter-spacing:.04em;color:#465b6b;background:#f6f8f9}.type-outside{border-color:#e6bd69;background:#fff8e6;color:#775612}.bottom-grid{display:grid;grid-template-columns:1fr 2.45in;gap:18px;align-items:start;margin-top:18px}.notes-box{padding:11px 12px;min-height:1in}.notes-copy{font-size:10.5px;line-height:1.45;white-space:pre-wrap}.totals-box{border:1px solid #c9d3da}.total-row{display:flex;justify-content:space-between;gap:15px;padding:8px 10px;border-bottom:1px solid #dfe5e9;font-size:11px}.total-row.grand{background:#172b3e;color:white;border-bottom:0;font-size:16px;padding:11px 10px}.invoice-footer{position:absolute;left:.5in;right:.5in;bottom:.22in;border-top:1px solid #d8dfe4;padding-top:7px;display:flex;justify-content:space-between;gap:12px;font-size:8px;font-weight:800;letter-spacing:.04em;color:#71808b}.void-watermark{position:absolute;left:50%;top:47%;transform:translate(-50%,-50%) rotate(-27deg);font-size:96px;font-weight:950;letter-spacing:.08em;color:rgba(155,23,40,.08);pointer-events:none;z-index:0}.invoice-sheet>*:not(.void-watermark){position:relative;z-index:1}.print-block,.invoice-lines tr{break-inside:avoid;page-break-inside:avoid}
@page{size:Letter;margin:.28in}
@media print{html,body{background:white!important}.easy-nav{display:none!important}.invoice-print-page{padding:0!important;background:white!important}.invoice-print-controls,.invoice-message{display:none!important}.invoice-sheet{width:auto!important;min-height:0!important;margin:0!important;padding:0!important;box-shadow:none!important;overflow:visible!important}.invoice-footer{position:fixed;left:0;right:0;bottom:0}.invoice-lines thead{display:table-header-group}.invoice-lines tr{break-inside:avoid;page-break-inside:avoid}.void-watermark{position:fixed}}
@media(max-width:760px){.invoice-print-page{padding:14px}.invoice-print-controls{grid-template-columns:1fr}.invoice-sheet{padding:24px}.top-grid,.bottom-grid{grid-template-columns:1fr}.invoice-header{flex-direction:column}.invoice-title-block{text-align:left}.invoice-footer{position:static;margin-top:25px}.brand-block img{width:260px}}
`;
