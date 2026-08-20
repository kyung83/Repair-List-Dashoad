"use client";

import { useEffect } from "react";

type BillingView="invoices"|"ready"|"settings";

function viewFromUrl():BillingView{
  const value=new URLSearchParams(window.location.search).get('view');
  return value==='ready'||value==='settings'?value:'invoices';
}

function hasText(element:Element,text:string){return (element.textContent||'').includes(text);}
function setVisible(element:HTMLElement|null,visible:boolean){if(!element)return;element.hidden=!visible;}
function setText(element:HTMLElement|null,value:string){if(element&&element.textContent!==value)element.textContent=value;}

export default function BillingViewEnhancer(){
  useEffect(()=>{
    if(window.location.pathname!=="/invoices")return;
    let stopped=false;

    function apply(){
      if(stopped)return;
      const main=Array.from(document.querySelectorAll<HTMLElement>('main')).find(node=>hasText(node,'Invoices & Labor Rate')||hasText(node,'Create invoice from completed work order'))||null;
      if(!main)return;
      const view=viewFromUrl();
      const children=Array.from(main.children) as HTMLElement[];
      const settings=children.find(node=>node.tagName==='SECTION'&&hasText(node,'Default shop labor rate')&&hasText(node,'Add invoice customer'))||null;
      const ready=children.find(node=>node.tagName==='FORM'&&hasText(node,'Create invoice from completed work order'))||null;
      const invoices=children.find(node=>node.tagName==='SECTION'&&node.querySelector('h2')?.textContent?.trim()==='Invoices')||null;
      const detail=main.querySelector<HTMLElement>('#invoice-print');

      setVisible(settings,view==='settings');
      setVisible(ready,view==='ready');
      setVisible(invoices,view==='invoices');
      setVisible(detail,view==='invoices');

      const heading=main.querySelector<HTMLElement>('header h1');
      const subtitle=main.querySelector<HTMLElement>('header p:last-child');
      setText(heading,view==='ready'?'Ready to Bill':view==='settings'?'Customers & Rates':'Invoices');
      setText(subtitle,view==='ready'
        ?'Choose a completed work order, verify the charges, and create the customer invoice.'
        :view==='settings'
          ?'Manage the shop billing rate and saved invoice customers without digging through the invoice workflow.'
          :'Review existing invoices, open details, print, and update invoice status.');
    }

    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{stopped=true;observer.disconnect();};
  },[]);

  return null;
}
