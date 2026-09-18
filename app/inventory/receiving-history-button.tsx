"use client";

import {useState} from "react";

type Receipt={
  id:number;
  vendorName:string;
  invoiceNumber:string;
  invoiceDate:string;
  sourcePartNumber:string;
  sourceDescription:string;
  receivedQuantity:number;
  unitCost:number|null;
  createdAt:string;
  partNumber:string;
  description:string;
  warehouseCode:string;
  warehouseName:string;
  userName:string;
};

function qty(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function money(value:number|null){return value==null?"—":value.toLocaleString(undefined,{style:"currency",currency:"USD"})}

export default function ReceivingHistoryButton({partId,partNumber,description}:{partId:number;partNumber:string;description:string}){
  const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[rows,setRows]=useState<Receipt[]>([]);

  async function show(){
    setOpen(true);setBusy(true);setError("");
    try{
      const response=await fetch(`/api/parts-receiving?partId=${partId}`,{cache:"no-store"});
      const result=await response.json() as {receipts?:Receipt[];error?:string};
      if(!response.ok)throw new Error(result.error||"Receiving history could not be loaded.");
      setRows(result.receipts??[]);
    }catch(error){setError(error instanceof Error?error.message:"Receiving history could not be loaded.")}
    finally{setBusy(false)}
  }

  return <>
    <button type="button" onClick={()=>void show()} style={{marginRight:6}}>Receiving History</button>
    {open&&<div style={backdrop} onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
      <section style={modal}>
        <div style={head}>
          <div><p style={eyebrow}>RECEIVING HISTORY</p><h2 style={{margin:"5px 0 3px"}}>{partNumber}</h2><p style={muted}>{description}</p></div>
          <button type="button" onClick={()=>setOpen(false)} style={close}>CLOSE</button>
        </div>
        {busy&&<div style={empty}>Loading receiving records…</div>}
        {error&&<div style={errorBox}>{error}</div>}
        {!busy&&!error&&rows.length===0&&<div style={empty}>No receiving records have been saved for this part yet.</div>}
        {!busy&&!error&&rows.length>0&&<div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:920}}>
            <thead><tr>{["Received","Vendor / source","Invoice / slip #","Invoice part #","Qty","Unit cost","Warehouse","Received by"].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
            <tbody>{rows.map(row=><tr key={row.id} style={{borderTop:"1px solid #e6ebef"}}>
              <td style={td}>{row.invoiceDate||row.createdAt}</td>
              <td style={td}><b>{row.vendorName||"—"}</b></td>
              <td style={td}>{row.invoiceNumber||"—"}</td>
              <td style={td}>{row.sourcePartNumber||row.partNumber}</td>
              <td style={td}>{qty(row.receivedQuantity)}</td>
              <td style={td}>{money(row.unitCost)}</td>
              <td style={td}>{row.warehouseName||row.warehouseCode}</td>
              <td style={td}>{row.userName||"—"}<small style={small}>{row.createdAt}</small></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
    </div>}
  </>;
}

const backdrop={position:"fixed" as const,inset:0,zIndex:10000,background:"rgba(8,20,32,.58)",display:"grid",placeItems:"center",padding:18};
const modal={width:"min(1180px,96vw)",maxHeight:"88vh",overflowY:"auto" as const,background:"white",borderRadius:14,padding:20,boxShadow:"0 24px 70px rgba(0,0,0,.30)"};
const head={display:"flex",justifyContent:"space-between",gap:16,alignItems:"start",marginBottom:12};
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".14em"} as const;
const muted={margin:"2px 0 0",color:"#667482",fontSize:12} as const;
const close={border:"1px solid #aebac4",borderRadius:8,padding:"8px 11px",background:"white",fontWeight:900,cursor:"pointer"} as const;
const empty={padding:22,textAlign:"center" as const,color:"#71808e",border:"1px dashed #d2d9df",borderRadius:9};
const errorBox={padding:12,border:"1px solid #e0a3a3",borderRadius:8,background:"#fff0f0",color:"#8a2f2f",fontWeight:700};
const th={padding:"10px 9px",textAlign:"left" as const,background:"#f7f9fa",color:"#657383",fontSize:10,whiteSpace:"nowrap" as const};
const td={padding:"10px 9px",verticalAlign:"top" as const,fontSize:12};
const small={display:"block",marginTop:3,fontSize:10,color:"#6c7886"} as const;
