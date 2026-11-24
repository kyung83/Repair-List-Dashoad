"use client";
import IndirectLaborCategoriesPanel from "./settings-panel";

export default function IndirectLaborCategoriesPage(){
 return <main style={{minHeight:"100vh",background:"#f4f6f4",padding:"30px clamp(12px,3vw,38px) 80px",color:"#1d332d"}}>
   <a href="/repair-types?type=indirect" style={{color:"#245c51",fontWeight:800,fontSize:13}}>← Repair Types</a>
   <header style={{maxWidth:1040,margin:"20px auto 22px"}}>
    <p style={{fontSize:11,fontWeight:900,letterSpacing:2,color:"#397666"}}>MAINTENANCE SETUP</p>
    <h1 style={{fontSize:32,margin:"7px 0"}}>Indirect Labor Categories</h1>
    <p style={{fontSize:14,color:"#62776e",lineHeight:1.6}}>Manage the same catalog shown under INDIRECT LABOR-OTHER in Repair Types. Existing work orders, hours and productivity history are preserved.</p>
   </header>
   <div style={{maxWidth:1040,margin:"0 auto"}}><IndirectLaborCategoriesPanel/></div>
 </main>;
}
