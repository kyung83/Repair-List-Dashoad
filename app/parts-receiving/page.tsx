"use client";

import { useEffect, useMemo, useState } from "react";
import ModuleTabs from "../module-tabs";

type Warehouse={id:number;code:string;name:string};
type Part={id:number;partNumber:string;description:string;crossReferences?:string[]};
type InventoryData={parts:Part[];warehouses:Warehouse[];error?:string};
type ReadingLine={partNumber:string;description:string;quantity:number;unitCost:number|null;lineTotal:number|null;matchedPartId:number|null;canonicalPartNumber:string;canonicalDescription:string;matchedBy:string;matchCount:number};
type Reading={vendor:string;invoiceNumber:string;invoiceDate:string;totalAmount:number|null;lineItems:ReadingLine[];uncertain:string[]};
type ScanResult={ok?:boolean;model?:string;reading?:Reading;error?:string};
type EditableLine=ReadingLine&{receive:boolean;manual:boolean;partId:string;inventorySearch:string;quantityText:string;unitCostText:string;rememberCrossReference:boolean};
type Receipt={id:number;vendorName:string;invoiceNumber:string;invoiceDate:string;sourcePartNumber:string;sourceDescription:string;receivedQuantity:number;unitCost:number|null;createdAt:string;partNumber:string;description:string;warehouseCode:string;warehouseName:string;userName:string};
type PdfLib={GlobalWorkerOptions:{workerSrc:string};getDocument:(options:{data:Uint8Array})=>{promise:Promise<any>}};
type BrowserTools=Window&{pdfjsLib?:PdfLib};

const PDF_SCRIPT="/api/outside-work-reader/pdf.min.js";
const PDF_WORKER="/api/outside-work-reader/pdf.worker.min.js";
const MAX_PAGES=3;

function qty(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function money(value:number|null){return value==null?"—":value.toLocaleString(undefined,{style:"currency",currency:"USD"})}
function modelName(value:string){return value==="openai/gpt-5.6-sol"?"GPT-5.6 Sol":value==="@cf/qwen/qwen3.8-27b"?"Qwen fallback":value||"AI"}
function normalizePartLookup(value:string){return value.toUpperCase().replace(/[^A-Z0-9]/g,"")}
function isKnownPartReference(part:Part,value:string){const key=normalizePartLookup(value);if(!key)return false;return normalizePartLookup(part.partNumber)===key||(part.crossReferences??[]).some(reference=>normalizePartLookup(reference)===key)}

function loadPdfScript(){
  return new Promise<void>((resolve,reject)=>{
    if((window as BrowserTools).pdfjsLib){resolve();return}
    let script=document.getElementById("parts-receiving-pdfjs") as HTMLScriptElement|null;
    if(script?.dataset.failed==="1"){script.remove();script=null}
    if(!script){
      script=document.createElement("script");script.id="parts-receiving-pdfjs";script.src=PDF_SCRIPT;script.async=true;script.crossOrigin="anonymous";document.head.appendChild(script);
    }
    const target=script;let settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;window.clearTimeout(timer);target.removeEventListener("load",loaded);target.removeEventListener("error",failed);if(error){target.dataset.failed="1";reject(error)}else resolve()};
    const loaded=()=>finish(),failed=()=>finish(new Error("Invoice PDF reader could not load."));
    const timer=window.setTimeout(()=>finish(new Error("Invoice PDF reader timed out.")),20000);
    target.addEventListener("load",loaded,{once:true});target.addEventListener("error",failed,{once:true});
  });
}
function canvasBlob(canvas:HTMLCanvasElement){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Invoice page could not be prepared.")),"image/jpeg",.9))}
async function imagePage(file:File){
  const bitmap=await createImageBitmap(file);
  try{
    const scale=Math.min(1,2400/Math.max(1,bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext("2d");if(!context)throw new Error("Invoice image could not be prepared.");
    context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return await canvasBlob(canvas);
  }finally{bitmap.close()}
}
async function pdfPages(file:File){
  await loadPdfScript();
  const pdfjs=(window as BrowserTools).pdfjsLib;if(!pdfjs)throw new Error("Invoice PDF reader did not initialize.");
  pdfjs.GlobalWorkerOptions.workerSrc=PDF_WORKER;
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  try{
    const pages:Blob[]=[];const count=Math.min(Number(pdf.numPages||0),MAX_PAGES);
    if(!count)throw new Error("Invoice PDF has no readable pages.");
    for(let pageNumber=1;pageNumber<=count;pageNumber++){
      const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1}),scale=Math.min(2.25,2400/Math.max(1,base.width,base.height)),viewport=page.getViewport({scale:Math.max(1.5,scale)});
      const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
      const context=canvas.getContext("2d");if(!context)throw new Error("Invoice PDF page could not be rendered.");
      context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:context,viewport}).promise;pages.push(await canvasBlob(canvas));
    }
    return pages;
  }finally{if(typeof pdf.destroy==="function")await pdf.destroy()}
}
async function preparedPages(file:File){
  const pdf=file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf");
  return pdf?pdfPages(file):[await imagePage(file)];
}

export default function PartsReceivingPage(){
  const[data,setData]=useState<InventoryData|null>(null),[receipts,setReceipts]=useState<Receipt[]>([]);
  const[warehouseCode,setWarehouseCode]=useState(""),[vendor,setVendor]=useState(""),[invoiceNumber,setInvoiceNumber]=useState(""),[invoiceDate,setInvoiceDate]=useState("");
  const[lines,setLines]=useState<EditableLine[]>([]),[uncertain,setUncertain]=useState<string[]>([]),[model,setModel]=useState(""),[fileName,setFileName]=useState(""),[receiptGroupKey,setReceiptGroupKey]=useState("");
  const[busy,setBusy]=useState<""|"scan"|"receive">(""),[message,setMessage]=useState(""),[activeSearchIndex,setActiveSearchIndex]=useState<number|null>(null),[entryMode,setEntryMode]=useState<""|"scan"|"manual">("");

  async function load(){
    const[inventoryResponse,receiptResponse]=await Promise.all([fetch("/api/inventory",{cache:"no-store"}),fetch("/api/parts-receiving",{cache:"no-store"})]);
    const inventory=await inventoryResponse.json() as InventoryData;
    const receiptData=await receiptResponse.json() as {receipts?:Receipt[];error?:string};
    if(!inventoryResponse.ok)throw new Error(inventory.error||"Inventory could not be loaded.");
    if(!receiptResponse.ok)throw new Error(receiptData.error||"Receiving history could not be loaded.");
    setData(inventory);setReceipts(receiptData.receipts??[]);
    if(!warehouseCode){
      const preferred=inventory.warehouses.find(row=>row.code==="CLARE")??inventory.warehouses.find(row=>row.code!=="NO_WAREHOUSE");
      if(preferred)setWarehouseCode(preferred.code);
    }
  }
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Parts Receiving could not be loaded."))},[]);

  const partOptions=useMemo(()=>(data?.parts??[]).slice().sort((a,b)=>a.partNumber.localeCompare(b.partNumber,undefined,{numeric:true})),[data]);
  const partById=useMemo(()=>new Map(partOptions.map(part=>[String(part.id),part])),[partOptions]);
  function searchParts(value:string){const term=value.trim().toLowerCase();if(!term)return[];return partOptions.filter(part=>`${part.partNumber} ${part.description} ${(part.crossReferences??[]).join(" ")}`.toLowerCase().includes(term)).slice(0,8)}
  function blankManualLine():EditableLine{return{partNumber:"",description:"",quantity:1,unitCost:null,lineTotal:null,matchedPartId:null,canonicalPartNumber:"",canonicalDescription:"",matchedBy:"",matchCount:0,receive:true,manual:true,partId:"",inventorySearch:"",quantityText:"1",unitCostText:"",rememberCrossReference:false}}
  function startManual(){setBusy("");setMessage("Manual receiving started. Enter the vendor/source name, invoice or packing slip number, and the parts received.");setEntryMode("manual");setFileName("");setModel("");setUncertain([]);setReceiptGroupKey(crypto.randomUUID());setVendor("");setInvoiceNumber("");setInvoiceDate("");setLines([blankManualLine()]);setActiveSearchIndex(null)}
  function addManualLine(){setLines(current=>[...current,blankManualLine()])}
  function removeLine(index:number){setLines(current=>current.filter((_,i)=>i!==index));setActiveSearchIndex(null)}

  async function readInvoice(file:File|null){
    if(!file)return;
    setBusy("scan");setMessage("");setEntryMode("scan");setFileName(file.name);setLines([]);setUncertain([]);setModel("");
    try{
      const pages=await preparedPages(file);
      const form=new FormData();pages.forEach((page,index)=>form.append("image",page,`parts-invoice-${index+1}.jpg`));
      const response=await fetch("/api/parts-receiving/ai-read",{method:"POST",body:form,cache:"no-store"});
      const result=await response.json() as ScanResult;
      if(!response.ok||!result.ok||!result.reading)throw new Error(result.error||"Invoice could not be read.");
      const reading=result.reading;
      setVendor(reading.vendor);setInvoiceNumber(reading.invoiceNumber);setInvoiceDate(reading.invoiceDate);setUncertain(reading.uncertain);setModel(result.model??"");
      setReceiptGroupKey(crypto.randomUUID());
      setLines(reading.lineItems.map(line=>({
        ...line,receive:true,manual:false,partId:line.matchedPartId?String(line.matchedPartId):"",inventorySearch:line.matchedPartId?`${line.canonicalPartNumber} — ${line.canonicalDescription}`:"",quantityText:String(line.quantity),unitCostText:line.unitCost==null?"":String(line.unitCost),
        rememberCrossReference:!line.matchedPartId&&Boolean(line.partNumber),
      })));
      const matched=reading.lineItems.filter(line=>line.matchedPartId).length;
      setMessage(`${modelName(result.model??"")} found ${reading.lineItems.length} parts line${reading.lineItems.length===1?"":"s"}; ${matched} matched inventory automatically. Review before receiving.`);
    }catch(error){setMessage(error instanceof Error?error.message:"Invoice could not be read.")}
    finally{setBusy("")}
  }

  function updateLine(index:number,patch:Partial<EditableLine>){setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line))}

  async function receive(){
    const chosen=lines.filter(line=>line.receive);
    if(!chosen.length){setMessage("Select at least one line to receive.");return}
    if(!warehouseCode){setMessage("Choose the receiving warehouse.");return}
    if(!vendor.trim()){setMessage("Vendor / source name is required so the receiving record can be found later.");return}
    if(!invoiceNumber.trim()){setMessage("Invoice / packing slip number is required so the receiving record can be found later.");return}
    if(chosen.some(line=>!line.partId)){setMessage("Every selected invoice line needs an inventory match.");return}
    if(chosen.some(line=>!Number.isFinite(Number(line.quantityText))||Number(line.quantityText)<=0)){setMessage("Every selected line needs a positive quantity.");return}
    setBusy("receive");setMessage("");
    try{
      const response=await fetch("/api/parts-receiving",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        receiptGroupKey:receiptGroupKey||crypto.randomUUID(),warehouseCode,vendorName:vendor,invoiceNumber,invoiceDate,
        lines:chosen.map(line=>({partId:Number(line.partId),quantity:Number(line.quantityText),unitCost:line.unitCostText===""?null:Number(line.unitCostText),sourcePartNumber:line.partNumber,sourceDescription:line.description,rememberCrossReference:line.rememberCrossReference})),
      })});
      const result=await response.json() as {ok?:boolean;received?:unknown[];error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Parts could not be received.");
      setMessage(`Received ${chosen.length} invoice line${chosen.length===1?"":"s"} into ${warehouseCode}. Inventory and on-order quantities were updated.`);
      setLines([]);setUncertain([]);setFileName("");setReceiptGroupKey("");setVendor("");setInvoiceNumber("");setInvoiceDate("");setModel("");setEntryMode("");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Parts could not be received.")}
    finally{setBusy("")}
  }

  return <main style={{minHeight:"100vh",background:"#f3f5f7",padding:"38px 34px 100px",color:"#182331"}}>
    <ModuleTabs module="parts"/>
    <header style={{display:"flex",justifyContent:"space-between",gap:18,alignItems:"end",flexWrap:"wrap"}}>
      <div><p style={eyebrow}>PARTS OPERATIONS</p><h1 style={{margin:"7px 0 5px",fontSize:34,color:"#0d1b2b"}}>Parts Receiving</h1><p style={muted}>Scan an invoice or enter a receipt manually. Vendor/source name, invoice number, who received it, and every received part stay in the receiving record.</p></div>
      <label style={warehouseLabel}>RECEIVING WAREHOUSE<select value={warehouseCode} onChange={event=>setWarehouseCode(event.target.value)} style={input}><option value="">Choose warehouse…</option>{(data?.warehouses??[]).filter(row=>row.code!=="NO_WAREHOUSE").map(row=><option key={row.code} value={row.code}>{row.name}</option>)}</select></label>
    </header>
    {message&&<div style={notice}>{message}</div>}

    <section style={panel}>
      <div style={panelHead}><div><p style={eyebrow}>STEP 1</p><h2 style={title}>Start receiving</h2><p style={muted}>Scan a PDF/photo or choose Manual Entry. Up to {MAX_PAGES} invoice pages are read per scan.</p></div>{fileName&&<span style={pill}>{fileName}</span>}</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <label style={darkButton}>📷 TAKE PHOTO<input type="file" accept="image/*" capture="environment" hidden disabled={Boolean(busy)} onChange={event=>{const file=event.target.files?.[0]??null;void readInvoice(file);event.target.value=""}}/></label>
        <label style={lightButton}>UPLOAD INVOICE<input type="file" accept="image/*,application/pdf" hidden disabled={Boolean(busy)} onChange={event=>{const file=event.target.files?.[0]??null;void readInvoice(file);event.target.value=""}}/></label>
        <button type="button" style={manualButton} disabled={Boolean(busy)} onClick={startManual}>MANUAL ENTRY</button>
        {busy==="scan"&&<strong style={{alignSelf:"center"}}>Reading invoice…</strong>}
      </div>
    </section>

    {lines.length>0&&<section style={panel}>
      <div style={panelHead}><div><p style={eyebrow}>STEP 2</p><h2 style={title}>{entryMode==="manual"?"Enter receiving details":"Verify invoice and matches"}</h2></div><span style={pill}>{entryMode==="manual"?"MANUAL":modelName(model)}</span></div>
      <div style={invoiceGrid}>
        <label style={label}>VENDOR / SOURCE NAME — REQUIRED<input required value={vendor} onChange={event=>setVendor(event.target.value)} placeholder="Vendor, supplier, transfer source…" style={input}/></label>
        <label style={label}>INVOICE / PACKING SLIP # — REQUIRED<input required value={invoiceNumber} onChange={event=>setInvoiceNumber(event.target.value)} placeholder="Invoice or packing slip number" style={input}/></label>
        <label style={label}>INVOICE DATE<input type="date" value={invoiceDate} onChange={event=>setInvoiceDate(event.target.value)} style={input}/></label>
      </div>
      {uncertain.length>0&&<div style={warning}><strong>VERIFY FROM ORIGINAL:</strong>{uncertain.map((item,index)=><span key={index}>• {item}</span>)}</div>}

      <div style={{overflowX:"auto",marginTop:14}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:1100}}>
          <thead><tr>{["Receive","Invoice part","Description","Inventory match","Qty","Unit cost","Cross-ref","Status"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{lines.map((line,index)=>{
            const chosen=partById.get(line.partId);
            const autoSelected=Boolean(line.matchedPartId&&line.partId===String(line.matchedPartId));
            const needsAlias=Boolean(line.partNumber&&chosen&&!isKnownPartReference(chosen,line.partNumber));
            const searchResults=activeSearchIndex===index&&!line.partId?searchParts(line.inventorySearch):[];
            return <tr key={index} style={{borderTop:"1px solid #e8edf1",background:line.receive?"white":"#f7f8f9"}}>
              <td style={td}><input type="checkbox" checked={line.receive} onChange={event=>updateLine(index,{receive:event.target.checked})}/></td>
              <td style={td}>{line.manual?<input value={line.partNumber} onChange={event=>updateLine(index,{partNumber:event.target.value,rememberCrossReference:false})} placeholder="Vendor / invoice part #" style={{...input,width:150}}/>:<><b>{line.partNumber||"—"}</b>{line.matchCount>1&&<small style={small}>Multiple matches — choose manually</small>}</>}</td>
              <td style={td}>{line.manual?<input value={line.description} onChange={event=>updateLine(index,{description:event.target.value})} placeholder="Description (optional)" style={{...input,minWidth:170,width:"100%"}}/>:(line.description||"—")}</td>
              <td style={td}><div style={partSearchWrap}>
                <input
                  value={line.inventorySearch}
                  disabled={!line.receive}
                  placeholder="Search part #, cross-ref or description…"
                  onFocus={()=>setActiveSearchIndex(index)}
                  onBlur={()=>window.setTimeout(()=>setActiveSearchIndex(current=>current===index?null:current),120)}
                  onChange={event=>{setActiveSearchIndex(index);updateLine(index,{inventorySearch:event.target.value,partId:"",rememberCrossReference:false})}}
                  style={{...input,minWidth:245,width:"100%"}}
                />
                {searchResults.length>0&&<div style={partSearchResults}>{searchResults.map(part=><button
                  key={part.id}
                  type="button"
                  onMouseDown={event=>event.preventDefault()}
                  onClick={()=>{updateLine(index,{partId:String(part.id),inventorySearch:`${part.partNumber} — ${part.description}`,rememberCrossReference:Boolean(line.partNumber&&!isKnownPartReference(part,line.partNumber))});setActiveSearchIndex(null)}}
                  style={partSearchResult}
                ><span><b>{part.partNumber}</b> — {part.description}{(part.crossReferences??[]).length>0&&<small style={small}>Cross: {(part.crossReferences??[]).join(" · ")}</small>}</span></button>)}</div>}
              </div>
              {autoSelected&&line.canonicalPartNumber&&<small style={matchNote}>{line.matchedBy===line.canonicalPartNumber?"Exact part match":`Cross-reference ${line.matchedBy}`} → {line.canonicalPartNumber}</small>}
              {chosen&&!autoSelected&&<small style={matchNote}>Selected → {chosen.partNumber}</small>}</td>
              <td style={td}><input type="number" min="0.01" step="any" value={line.quantityText} disabled={!line.receive} onChange={event=>updateLine(index,{quantityText:event.target.value})} style={{...input,width:90}}/></td>
              <td style={td}><input type="number" min="0" step="0.0001" value={line.unitCostText} disabled={!line.receive} onChange={event=>updateLine(index,{unitCostText:event.target.value})} placeholder="Optional" style={{...input,width:110}}/></td>
              <td style={td}>{needsAlias?<label style={{display:"flex",gap:6,alignItems:"center",fontSize:11,fontWeight:800}}><input type="checkbox" checked={line.rememberCrossReference} onChange={event=>updateLine(index,{rememberCrossReference:event.target.checked})}/>Remember {line.partNumber}</label>:autoSelected&&line.matchedBy!==line.canonicalPartNumber?<span style={good}>KNOWN</span>:"—"}</td>
              <td style={td}>{line.partId?<span style={good}>READY</span>:<span style={needsReview}>MATCH NEEDED</span>}{line.manual&&lines.length>1&&<button type="button" onClick={()=>removeLine(index)} style={removeButton}>REMOVE</button>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginTop:14,flexWrap:"wrap"}}>{entryMode==="manual"?<button type="button" disabled={Boolean(busy)} onClick={addManualLine} style={lightButton}>+ ADD ANOTHER PART</button>:<span/>}<button type="button" disabled={Boolean(busy)||!vendor.trim()||!invoiceNumber.trim()} onClick={()=>void receive()} style={orangeButton}>{busy==="receive"?"Receiving…":`RECEIVE ${lines.filter(line=>line.receive).length} LINE${lines.filter(line=>line.receive).length===1?"":"S"}`}</button></div>
    </section>}

    <section style={panel}>
      <div style={panelHead}><div><p style={eyebrow}>RECEIVING RECORDS</p><h2 style={title}>Parts received</h2><p style={muted}>Vendor/source name, invoice or packing slip number, warehouse, received-by user, quantity and cost remain attached to each receipt.</p></div><span style={muted}>{receipts.length} lines shown</span></div>
      {!receipts.length?<div style={empty}>No invoice receipts recorded yet.</div>:<div style={{display:"grid",gap:7}}>{receipts.slice(0,50).map(row=><article key={row.id} style={receiptRow}>
        <div><b>{row.partNumber}</b><small style={small}>{row.description}{row.sourcePartNumber&&row.sourcePartNumber!==row.partNumber?` · Invoice # ${row.sourcePartNumber}`:""}</small></div>
        <div><b>{qty(row.receivedQuantity)} received</b><small style={small}>{row.warehouseName} · {money(row.unitCost)}</small></div>
        <div><b>{row.vendorName||"Vendor not captured"}</b><small style={small}>{row.invoiceNumber?`Invoice / slip ${row.invoiceNumber}`:"No invoice #"}{row.invoiceDate?` · ${row.invoiceDate}`:""}</small></div>
        <small style={small}>Received {row.createdAt}{row.userName?` · by ${row.userName}`:""}</small>
      </article>)}</div>}
    </section>
  </main>
}

const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".14em"} as const;
const title={margin:"5px 0 6px",fontSize:22,color:"#0d1b2b"} as const;
const muted={margin:"3px 0 8px",color:"#667482",fontSize:12} as const;
const panel={marginTop:18,padding:18,border:"1px solid #dce2e7",borderRadius:13,background:"white"} as const;
const panelHead={display:"flex",justifyContent:"space-between",gap:12,alignItems:"end",flexWrap:"wrap" as const} as const;
const notice={marginTop:16,padding:12,border:"1px solid #efc16c",borderRadius:9,background:"#fff8e6",fontWeight:750} as const;
const warehouseLabel={display:"grid",gap:5,minWidth:230,fontSize:11,fontWeight:900,color:"#52616d"} as const;
const input={boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #cbd5dd",borderRadius:8,background:"white"} as const;
const label={display:"grid",gap:5,fontSize:11,fontWeight:900,color:"#52616d"} as const;
const invoiceGrid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10} as const;
const darkButton={display:"inline-block",border:0,borderRadius:8,padding:"11px 14px",background:"#0d1b2b",color:"white",fontWeight:950,cursor:"pointer"} as const;
const lightButton={...darkButton,border:"1px solid #aebac4",background:"white",color:"#173a5d"} as const;
const manualButton={...darkButton,border:"1px solid #173a5d",background:"#eaf2f8",color:"#173a5d"} as const;
const orangeButton={...darkButton,background:"#f47b20"} as const;
const pill={padding:"6px 10px",borderRadius:999,background:"#eaf2f8",color:"#173a5d",fontSize:12,fontWeight:950} as const;
const warning={marginTop:12,padding:10,border:"1px solid #efc16c",borderRadius:8,background:"#fff8e6",display:"grid",gap:4,fontSize:12} as const;
const th={padding:"10px 9px",textAlign:"left" as const,background:"#f7f9fa",color:"#657383",fontSize:10,whiteSpace:"nowrap" as const} as const;
const td={padding:"10px 9px",verticalAlign:"top" as const,fontSize:12} as const;
const small={display:"block",marginTop:3,fontSize:10,color:"#6c7886",fontWeight:600} as const;
const matchNote={display:"block",marginTop:4,fontSize:10,color:"#176448",fontWeight:800} as const;
const good={display:"inline-block",padding:"4px 7px",borderRadius:999,background:"#eaf7ef",color:"#155f3d",fontSize:10,fontWeight:950} as const;
const needsReview={display:"inline-block",padding:"4px 7px",borderRadius:999,background:"#fff0d7",color:"#9a5a05",fontSize:10,fontWeight:950} as const;
const removeButton={display:"block",marginTop:7,padding:"4px 7px",border:"1px solid #d7a3a3",borderRadius:6,background:"white",color:"#8a2f2f",fontSize:9,fontWeight:900,cursor:"pointer"} as const;
const partSearchWrap={position:"relative" as const,minWidth:245} as const;
const partSearchResults={position:"absolute" as const,left:0,right:0,top:"calc(100% + 4px)",zIndex:20,maxHeight:260,overflowY:"auto" as const,border:"1px solid #cbd5dd",borderRadius:8,background:"white",boxShadow:"0 8px 24px rgba(18,35,52,.16)"} as const;
const partSearchResult={display:"block",width:"100%",padding:"9px 10px",border:0,borderBottom:"1px solid #edf0f2",background:"white",textAlign:"left" as const,cursor:"pointer",fontSize:12,color:"#243341"} as const;
const receiptRow={display:"grid",gridTemplateColumns:"minmax(180px,1.3fr) minmax(140px,.8fr) minmax(190px,1fr) minmax(150px,.7fr)",gap:12,alignItems:"center",padding:"10px 11px",border:"1px solid #e5e9ed",borderRadius:9,background:"#fbfcfd"} as const;
const empty={padding:20,textAlign:"center" as const,color:"#71808e",border:"1px dashed #d2d9df",borderRadius:9} as const;
