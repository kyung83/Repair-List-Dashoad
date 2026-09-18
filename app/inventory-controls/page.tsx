"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import ModuleTabs from "../module-tabs";

type Warehouse={id:number;code:string;name:string};
type Stock={warehouseCode:string;warehouseName:string;quantityOnHand:number;available?:number;physicalOnHand?:number;reserved?:number};
type Part={id:number;partNumber:string;description:string;quantityOnHand:number;available?:number;crossReferences?:string[];warehouseStocks?:Stock[]};
type InventoryData={parts:Part[];warehouses:Warehouse[]};
type TransferRow={id:number;transferKind:string;destinationLabel:string;quantity:number;notes:string;createdAt:string;partNumber:string;description:string;sourceWarehouseCode:string;sourceWarehouseName:string;destinationWarehouseCode:string;destinationWarehouseName:string;userName:string};

function qty(value:number|undefined){const n=Number(value??0);return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function splitRefs(value:string){return value.split(/[\n,;]+/).map(v=>v.trim()).filter(Boolean)}

export default function InventoryControlsPage(){
  const[data,setData]=useState<InventoryData|null>(null),[transfers,setTransfers]=useState<TransferRow[]>([]);
  const[query,setQuery]=useState(""),[selectedId,setSelectedId]=useState<number|null>(null),[refsText,setRefsText]=useState("");
  const[source,setSource]=useState(""),[kind,setKind]=useState<"terminal"|"outside"|"remove">("terminal"),[destination,setDestination]=useState(""),[destinationLabel,setDestinationLabel]=useState(""),[quantity,setQuantity]=useState("1"),[notes,setNotes]=useState("");
  const[busy,setBusy]=useState(""),[message,setMessage]=useState("");

  async function load(){
    const[inventoryResponse,transferResponse]=await Promise.all([
      fetch("/api/inventory",{cache:"no-store"}),
      fetch("/api/inventory/transfer",{cache:"no-store"}),
    ]);
    const inventory=await inventoryResponse.json() as InventoryData&{error?:string};
    const transferData=await transferResponse.json() as {transfers?:TransferRow[];error?:string};
    if(!inventoryResponse.ok)throw new Error(inventory.error||"Inventory could not be loaded.");
    if(!transferResponse.ok)throw new Error(transferData.error||"Transfers could not be loaded.");
    setData(inventory);setTransfers(transferData.transfers??[]);
  }
  useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Inventory controls could not be loaded."))},[]);

  const matches=useMemo(()=>{
    const q=query.trim().toLowerCase();
    if(!q)return[];
    return(data?.parts??[]).filter(part=>[
      part.partNumber,part.description,...(part.crossReferences??[])
    ].join(" ").toLowerCase().includes(q)).slice(0,25);
  },[data,query]);
  const selected=(data?.parts??[]).find(part=>part.id===selectedId)??null;

  function choose(part:Part){
    setSelectedId(part.id);
    setQuery(`${part.partNumber} — ${part.description}`);
    setRefsText((part.crossReferences??[]).join("\n"));
    const stocks=(part.warehouseStocks??[]).filter(stock=>Number(stock.available??stock.quantityOnHand)>0);
    setSource(stocks[0]?.warehouseCode??"");
    setKind("terminal");setDestination("");setDestinationLabel("");setQuantity("1");setNotes("");setMessage("");
  }

  async function saveCrossReferences(){
    if(!selected)return;
    setBusy("refs");setMessage("");
    try{
      const response=await fetch("/api/inventory/cross-references",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({partId:selected.id,crossReferences:splitRefs(refsText)})});
      const result=await response.json() as {ok?:boolean;error?:string;crossReferences?:string[]};
      if(!response.ok||!result.ok)throw new Error(result.error||"Cross references could not be saved.");
      setRefsText((result.crossReferences??[]).join("\n"));
      setMessage("Cross references saved. Technicians can search any of these numbers now.");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Cross references could not be saved.")}
    finally{setBusy("")}
  }

  async function submitTransfer(event:FormEvent){
    event.preventDefault();
    if(!selected)return;
    if(!notes.trim()){setMessage("Transfer notes are required.");return}
    setBusy("transfer");setMessage("");
    try{
      const operationKey=`inventory-transfer:${crypto.randomUUID()}`;
      const response=await fetch("/api/inventory/transfer",{method:"POST",headers:{"content-type":"application/json","idempotency-key":operationKey},body:JSON.stringify({
        operationKey,partId:selected.id,sourceWarehouseCode:source,transferKind:kind,
        destinationWarehouseCode:kind==="terminal"?destination:null,
        destinationLabel:kind==="outside"?destinationLabel:null,
        quantity:Number(quantity),notes,
      })});
      const result=await response.json() as {ok?:boolean;error?:string;destinationLabel?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Transfer failed.");
      setMessage(`${selected.partNumber}: ${qty(Number(quantity))} transferred from ${source} to ${result.destinationLabel||"destination"}.`);
      setQuantity("1");setNotes("");setDestination("");setDestinationLabel("");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Transfer failed.")}
    finally{setBusy("")}
  }

  const sourceStocks=(selected?.warehouseStocks??[]).filter(stock=>Number(stock.available??stock.quantityOnHand)>0);
  const otherWarehouses=(data?.warehouses??[]).filter(warehouse=>warehouse.code!==source&&warehouse.code!=="NO_WAREHOUSE");

  return <main style={{minHeight:"100vh",background:"#f3f5f7",padding:"38px 34px 100px",color:"#182331"}}>
    <ModuleTabs module="parts"/>
    <header>
      <p style={eyebrow}>PARTS OPERATIONS</p>
      <h1 style={{margin:"7px 0 5px",fontSize:34,color:"#0d1b2b"}}>Transfers & Cross References</h1>
      <p style={muted}>One place to tie interchange numbers to your stocked part and move inventory to another terminal, outside, or out of inventory.</p>
    </header>
    {message&&<div style={notice}>{message}</div>}

    <section style={panel}>
      <div style={panelHead}><div><p style={eyebrow}>FIND A PART</p><h2 style={title}>Search inventory or any cross-reference</h2></div>{selected&&<span style={pill}>{selected.partNumber}</span>}</div>
      <input value={query} onChange={event=>{setQuery(event.target.value);setSelectedId(null)}} placeholder="Part number, cross-reference, or description…" style={search}/>
      {matches.length>0&&!selected&&<div style={results}>{matches.map(part=><button key={part.id} type="button" style={resultButton} onClick={()=>choose(part)}>
        <span><strong>{part.partNumber}</strong> — {part.description}{(part.crossReferences??[]).length>0&&<small style={small}>Cross: {(part.crossReferences??[]).join(" · ")}</small>}</span>
        <b>{qty(part.available??part.quantityOnHand)} available</b>
      </button>)}</div>}
    </section>

    {selected&&<div style={twoCol}>
      <section style={panel}>
        <p style={eyebrow}>CROSS REFERENCES</p><h2 style={title}>Other part numbers that equal {selected.partNumber}</h2>
        <p style={muted}>Enter one number per line. Techs can type any of these in Current Work and still pull the one inventory part: <b>{selected.partNumber}</b>.</p>
        <textarea value={refsText} onChange={event=>setRefsText(event.target.value)} rows={9} placeholder={"Example:\nBD7153\nP553000\n57744"} style={textarea}/>
        <button type="button" disabled={Boolean(busy)} onClick={()=>void saveCrossReferences()} style={darkButton}>{busy==="refs"?"Saving…":"SAVE CROSS REFERENCES"}</button>
      </section>

      <section style={panel}>
        <p style={eyebrow}>TRANSFER</p><h2 style={title}>Move or remove inventory</h2>
        <form onSubmit={submitTransfer} style={{display:"grid",gap:11}}>
          <label style={label}>FROM
            <select required value={source} onChange={event=>setSource(event.target.value)} style={input}>
              <option value="">Choose warehouse…</option>
              {sourceStocks.map(stock=><option key={stock.warehouseCode} value={stock.warehouseCode}>{stock.warehouseName} — {qty(stock.available??stock.quantityOnHand)} available</option>)}
            </select>
          </label>
          <label style={label}>TRANSFER TO
            <select value={kind} onChange={event=>{setKind(event.target.value as typeof kind);setDestination("");setDestinationLabel("")}} style={input}>
              <option value="terminal">Another terminal</option>
              <option value="outside">Outside / other location</option>
              <option value="remove">Remove from inventory</option>
            </select>
          </label>
          {kind==="terminal"&&<label style={label}>DESTINATION TERMINAL
            <select required value={destination} onChange={event=>setDestination(event.target.value)} style={input}><option value="">Choose terminal…</option>{otherWarehouses.map(warehouse=><option key={warehouse.code} value={warehouse.code}>{warehouse.name}</option>)}</select>
          </label>}
          {kind==="outside"&&<label style={label}>OUTSIDE DESTINATION <span style={{fontWeight:500}}>(optional)</span>
            <input value={destinationLabel} onChange={event=>setDestinationLabel(event.target.value)} placeholder="Vendor, machine shop, driver, etc." style={input}/>
          </label>}
          <label style={label}>QUANTITY
            <input required type="number" min="0.01" step="any" value={quantity} onChange={event=>setQuantity(event.target.value)} style={input}/>
          </label>
          <label style={label}>TRANSFER NOTES — REQUIRED
            <textarea required value={notes} onChange={event=>setNotes(event.target.value)} rows={4} placeholder="Why it is moving, where it went, who requested it, etc." style={textarea}/>
          </label>
          <button disabled={Boolean(busy)||!source||!notes.trim()||(kind==="terminal"&&!destination)} style={orangeButton}>{busy==="transfer"?"Transferring…":"TRANSFER"}</button>
        </form>
      </section>
    </div>}

    <section style={panel}>
      <div style={panelHead}><div><p style={eyebrow}>AUDIT TRAIL</p><h2 style={title}>Recent transfers</h2></div><span style={muted}>{transfers.length} shown</span></div>
      {!transfers.length?<div style={empty}>No transfers recorded yet.</div>:<div style={{display:"grid",gap:8}}>{transfers.map(row=><article key={row.id} style={historyRow}>
        <div><b>{row.partNumber}</b><small style={small}>{row.description}</small></div>
        <div><b>{qty(row.quantity)}</b><small style={small}>{row.sourceWarehouseName} → {row.destinationWarehouseName||row.destinationLabel}</small></div>
        <div><span style={kindPill}>{row.transferKind.toUpperCase()}</span><small style={small}>{row.notes}</small></div>
        <small style={small}>{row.createdAt}{row.userName?` · ${row.userName}`:""}</small>
      </article>)}</div>}
    </section>
  </main>
}

const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".14em"} as const;
const title={margin:"5px 0 7px",fontSize:22,color:"#0d1b2b"} as const;
const muted={margin:"3px 0 12px",color:"#667482",fontSize:12} as const;
const panel={marginTop:18,padding:18,border:"1px solid #dce2e7",borderRadius:13,background:"white"} as const;
const panelHead={display:"flex",justifyContent:"space-between",gap:12,alignItems:"end",flexWrap:"wrap" as const} as const;
const notice={marginTop:16,padding:12,border:"1px solid #efc16c",borderRadius:9,background:"#fff8e6",fontWeight:750} as const;
const search={width:"100%",boxSizing:"border-box" as const,padding:"12px 13px",border:"1px solid #cbd5dd",borderRadius:9,fontSize:15} as const;
const results={display:"grid",gap:7,marginTop:10,maxHeight:360,overflowY:"auto" as const} as const;
const resultButton={display:"flex",justifyContent:"space-between",gap:14,textAlign:"left" as const,padding:"10px 11px",border:"1px solid #dce2e7",borderRadius:9,background:"#fbfcfd",cursor:"pointer"} as const;
const small={display:"block",marginTop:3,fontSize:10,color:"#6c7886",fontWeight:600} as const;
const pill={padding:"6px 10px",borderRadius:999,background:"#eaf2f8",color:"#173a5d",fontSize:12,fontWeight:950} as const;
const twoCol={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(330px,1fr))",gap:16} as const;
const textarea={width:"100%",boxSizing:"border-box" as const,padding:11,border:"1px solid #cbd5dd",borderRadius:9,resize:"vertical" as const,fontSize:14} as const;
const input={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #cbd5dd",borderRadius:8,background:"white"} as const;
const label={display:"grid",gap:5,fontSize:11,fontWeight:900,color:"#52616d"} as const;
const darkButton={marginTop:10,border:0,borderRadius:8,padding:"11px 13px",background:"#0d1b2b",color:"white",fontWeight:950,cursor:"pointer"} as const;
const orangeButton={...darkButton,marginTop:0,background:"#f47b20"} as const;
const empty={padding:20,textAlign:"center" as const,color:"#71808e",border:"1px dashed #d2d9df",borderRadius:9} as const;
const historyRow={display:"grid",gridTemplateColumns:"minmax(180px,1.3fr) minmax(170px,1fr) minmax(220px,1.5fr) minmax(150px,.8fr)",gap:12,alignItems:"center",padding:"10px 11px",border:"1px solid #e5e9ed",borderRadius:9,background:"#fbfcfd"} as const;
const kindPill={display:"inline-block",padding:"4px 7px",borderRadius:999,background:"#edf2f6",fontSize:10,fontWeight:950} as const;
