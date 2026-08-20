"use client";

import { useEffect } from "react";

const invoicePattern=/^INV-\d{4}-\d+$/i;
const baseButton="border:0;border-radius:8px;padding:10px 12px;font-weight:800;cursor:pointer;font-size:11px;";

function professionalPrintUrl(invoiceNumber:string){
  return `/invoices/print?number=${encodeURIComponent(invoiceNumber)}`;
}

function invoiceNumberFromDetail(section:HTMLElement){
  const candidates=Array.from(section.querySelectorAll("strong"));
  return candidates.map(node=>(node.textContent||"").trim()).find(text=>invoicePattern.test(text))||"";
}

function makeButton(label:string,background:string){
  const button=document.createElement("button");
  button.type="button";
  button.textContent=label;
  button.setAttribute("style",`${baseButton}background:${background};color:white;`);
  return button;
}

export default function InvoicePageEnhancer(){
  useEffect(()=>{
    if(window.location.pathname!=="/invoices")return;
    let stopped=false;

    function openPrint(invoiceNumber:string){
      window.open(professionalPrintUrl(invoiceNumber),"_blank","noopener,noreferrer");
    }

    function wireDetailPrint(){
      const section=document.getElementById("invoice-print");
      if(!section)return;
      const invoiceNumber=invoiceNumberFromDetail(section);
      if(!invoiceNumber)return;
      const buttons=Array.from(section.querySelectorAll("button"));
      const printButton=buttons.find(button=>(button.textContent||"").trim().toLowerCase()==="print invoice");
      if(!printButton||printButton.getAttribute("data-professional-print")==="1")return;
      printButton.setAttribute("data-professional-print","1");
      printButton.textContent="OPEN PROFESSIONAL INVOICE";
      printButton.addEventListener("click",event=>{
        event.preventDefault();
        event.stopPropagation();
        if("stopImmediatePropagation" in event)event.stopImmediatePropagation();
        openPrint(invoiceNumber);
      },true);
    }

    function wireInvoiceRows(){
      const tables=Array.from(document.querySelectorAll("table"));
      const table=tables.find(candidate=>{
        const headings=Array.from(candidate.querySelectorAll("thead th")).map(th=>(th.textContent||"").trim());
        return headings[0]==="Invoice"&&headings.includes("Status")&&headings.includes("Actions");
      });
      if(!table)return;

      const headings=Array.from(table.querySelectorAll("thead th")).map(th=>(th.textContent||"").trim());
      const statusIndex=headings.indexOf("Status");
      const rows=Array.from(table.querySelectorAll("tbody tr"));
      for(const row of rows){
        const cells=Array.from(row.querySelectorAll("td"));
        if(!cells.length||statusIndex<0||statusIndex>=cells.length)continue;
        const invoiceNumber=(cells[0].textContent||"").trim();
        if(!invoicePattern.test(invoiceNumber))continue;
        const status=(cells[statusIndex].textContent||"").trim();
        const actions=cells[cells.length-1] as HTMLTableCellElement;

        if(!actions.querySelector(`[data-invoice-print="${invoiceNumber}"]`)){
          const print=makeButton("Print","#1f5d7a");
          print.setAttribute("data-invoice-print",invoiceNumber);
          print.addEventListener("click",()=>openPrint(invoiceNumber));
          actions.appendChild(print);
        }

        if(status==="Void"&&!actions.querySelector(`[data-delete-void-invoice="${invoiceNumber}"]`)){
          const remove=makeButton("Delete Void","#9a3341");
          remove.setAttribute("data-delete-void-invoice",invoiceNumber);
          remove.title="Remove this void invoice from the working list. A deletion audit snapshot is retained.";
          remove.addEventListener("click",async()=>{
            const confirmed=window.confirm(`Delete void invoice ${invoiceNumber}?\n\nIt will be removed from the invoice list. A deletion audit snapshot will be retained.`);
            if(!confirmed)return;
            remove.disabled=true;
            remove.textContent="Deleting…";
            try{
              const response=await fetch("/api/invoices",{
                method:"POST",
                headers:{"content-type":"application/json"},
                body:JSON.stringify({action:"deleteVoidedInvoice",invoiceNumber}),
              });
              const payload=await response.json() as {ok?:boolean;error?:string};
              if(!response.ok||!payload.ok)throw new Error(payload.error||"Void invoice could not be deleted.");
              window.location.reload();
            }catch(error){
              window.alert(error instanceof Error?error.message:"Void invoice could not be deleted.");
              remove.disabled=false;
              remove.textContent="Delete Void";
            }
          });
          actions.appendChild(remove);
        }
      }
    }

    function wire(){
      if(stopped)return;
      wireDetailPrint();
      wireInvoiceRows();
    }

    wire();
    const observer=new MutationObserver(()=>wire());
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{stopped=true;observer.disconnect();};
  },[]);

  return null;
}
