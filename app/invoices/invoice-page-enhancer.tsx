"use client";

import { useEffect } from "react";

const invoicePattern=/^INV-\d{4}-\d+$/i;
const baseButton="border:0;border-radius:8px;padding:10px 12px;font-weight:800;cursor:pointer;font-size:11px;";
const paymentTerms=[
  {value:"manual",label:"Set exact due date",days:null},
  {value:"receipt",label:"Due on receipt",days:0},
  {value:"net15",label:"Net 15",days:15},
  {value:"net30",label:"Net 30",days:30},
  {value:"net60",label:"Net 60",days:60},
  {value:"net90",label:"Net 90",days:90},
] as const;

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

function addDays(dateValue:string,days:number){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateValue))return "";
  const date=new Date(`${dateValue}T12:00:00Z`);
  if(Number.isNaN(date.getTime()))return "";
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function daysBetween(start:string,end:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return null;
  const startDate=new Date(`${start}T00:00:00Z`);
  const endDate=new Date(`${end}T00:00:00Z`);
  if(Number.isNaN(startDate.getTime())||Number.isNaN(endDate.getTime()))return null;
  return Math.round((endDate.getTime()-startDate.getTime())/86400000);
}

function inferPaymentTerm(invoiceDate:string,dueDate:string){
  if(!dueDate)return "manual";
  const difference=daysBetween(invoiceDate,dueDate);
  if(difference===0)return "receipt";
  if(difference===15)return "net15";
  if(difference===30)return "net30";
  if(difference===60)return "net60";
  if(difference===90)return "net90";
  return "manual";
}

function setReactInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  if(setter)setter.call(input,value);else input.value=value;
  input.dispatchEvent(new Event("input",{bubbles:true}));
  input.dispatchEvent(new Event("change",{bubbles:true}));
}

function fieldLabel(labelText:string){
  return Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(label=>{
    const firstSpan=label.querySelector("span");
    return (firstSpan?.textContent||"").trim()===labelText;
  })||null;
}

export default function InvoicePageEnhancer(){
  useEffect(()=>{
    if(window.location.pathname!=="/invoices")return;
    let stopped=false;
    let selectedPaymentTerm="manual";
    let paymentTermInitialized=false;

    function openPrint(invoiceNumber:string){
      window.open(professionalPrintUrl(invoiceNumber),"_blank","noopener,noreferrer");
    }

    function wirePaymentTerms(){
      const invoiceDateLabel=fieldLabel("Invoice date");
      const dueDateLabel=fieldLabel("Due date");
      const invoiceDateInput=invoiceDateLabel?.querySelector<HTMLInputElement>('input[type="date"]')||null;
      const dueDateInput=dueDateLabel?.querySelector<HTMLInputElement>('input[type="date"]')||null;
      const parent=dueDateLabel?.parentElement||null;
      if(!invoiceDateInput||!dueDateInput||!dueDateLabel||!parent)return;

      if(!paymentTermInitialized){
        selectedPaymentTerm=inferPaymentTerm(invoiceDateInput.value,dueDateInput.value);
        paymentTermInitialized=true;
      }

      let select=document.querySelector<HTMLSelectElement>('select[data-payment-terms-select="1"]');
      if(!select){
        const wrapper=document.createElement("label");
        wrapper.setAttribute("data-payment-terms-field","1");
        wrapper.setAttribute("style","display:grid;gap:5px;font-size:10px;font-weight:900;color:#475a6c;letter-spacing:.02em");
        const title=document.createElement("span");
        title.textContent="Payment terms";
        select=document.createElement("select");
        select.setAttribute("data-payment-terms-select","1");
        select.setAttribute("style","padding:10px 11px;border:1px solid #cbd5e1;border-radius:8px;background:white;box-sizing:border-box;width:100%");
        for(const term of paymentTerms){
          const option=document.createElement("option");
          option.value=term.value;
          option.textContent=term.label;
          select.appendChild(option);
        }
        const help=document.createElement("span");
        help.textContent="Choose a Net term to calculate the due date automatically, or Set exact due date to pick the date yourself.";
        help.setAttribute("style","font-size:9px;font-weight:500;color:#74818c;line-height:1.35");
        wrapper.append(title,select,help);
        parent.insertBefore(wrapper,dueDateLabel);

        select.addEventListener("change",()=>{
          selectedPaymentTerm=select?.value||"manual";
          const term=paymentTerms.find(item=>item.value===selectedPaymentTerm);
          if(!term||term.days===null)return;
          const nextDate=addDays(invoiceDateInput.value,term.days);
          if(!nextDate)return;
          dueDateInput.dataset.paymentTermsAuto="1";
          setReactInputValue(dueDateInput,nextDate);
          delete dueDateInput.dataset.paymentTermsAuto;
        });
      }
      select.value=selectedPaymentTerm;

      if(invoiceDateInput.dataset.paymentTermsWired!=="1"){
        invoiceDateInput.dataset.paymentTermsWired="1";
        invoiceDateInput.addEventListener("change",()=>{
          const active=document.querySelector<HTMLSelectElement>('select[data-payment-terms-select="1"]');
          const term=paymentTerms.find(item=>item.value===(active?.value||selectedPaymentTerm));
          if(!term||term.days===null)return;
          const currentDue=fieldLabel("Due date")?.querySelector<HTMLInputElement>('input[type="date"]');
          if(!currentDue)return;
          const nextDate=addDays(invoiceDateInput.value,term.days);
          if(!nextDate)return;
          currentDue.dataset.paymentTermsAuto="1";
          setReactInputValue(currentDue,nextDate);
          delete currentDue.dataset.paymentTermsAuto;
        });
      }

      if(dueDateInput.dataset.paymentTermsWired!=="1"){
        dueDateInput.dataset.paymentTermsWired="1";
        dueDateInput.addEventListener("change",()=>{
          if(dueDateInput.dataset.paymentTermsAuto==="1")return;
          selectedPaymentTerm="manual";
          const active=document.querySelector<HTMLSelectElement>('select[data-payment-terms-select="1"]');
          if(active)active.value="manual";
        });
      }
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
      wirePaymentTerms();
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
