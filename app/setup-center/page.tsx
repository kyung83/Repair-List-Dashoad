"use client";

import {useEffect,useMemo,useState} from "react";

type Role="viewer"|"mechanic"|"dispatch"|"manager"|"admin";
type User={displayName:string;role:Role};
type SetupLink={label:string;href:string;description:string;adminOnly?:boolean};
type SetupGroup={title:string;description:string;links:SetupLink[]};

const groups:SetupGroup[]=[
  {
    title:"Maintenance Setup",
    description:"PM, Annual, repair types, checklists, and recurring maintenance programs.",
    links:[
      {label:"PM Schedule Setup",href:"/pm-schedules",description:"Mileage and time-based PM schedules."},
      {label:"Custom PM Builder",href:"/maintenance-programs",description:"Build custom and rotational maintenance programs."},
      {label:"PM & Annual Checklists",href:"/maintenance-checklists",description:"Inspection templates and required checklist items."},
      {label:"Annual Schedule Setup",href:"/annual-schedules",description:"Annual inspection scheduling rules."},
      {label:"PM Kits",href:"/pm-kits",description:"Standard parts kits for PM work."},
      {label:"Repair Types",href:"/repair-types",description:"Repair categories and repair-specific checklist behavior."},
    ],
  },
  {
    title:"Parts Setup",
    description:"Warehouse structure used by Inventory, Receiving, Transfers, and Current Work.",
    links:[
      {label:"Parts Warehouses",href:"/admin/warehouses",description:"Add, archive, restore, and manage parts warehouses.",adminOnly:true},
      {label:"Inventory",href:"/inventory",description:"Part catalog, minimums, vendors, and warehouse stock."},
      {label:"Transfers & Cross-Refs",href:"/inventory-transfer",description:"Cross-reference numbers and warehouse transfers."},
    ],
  },
  {
    title:"Breakdown & Operations",
    description:"Breakdown workflow rules, yard integrations, email, and texting.",
    links:[
      {label:"Breakdown Setup",href:"/breakdowns/setup",description:"Breakdown categories and workflow configuration."},
      {label:"Yard Check API",href:"/admin/yard-check-api",description:"Manage Yard Check API access and integration."},
      {label:"Breakdown Email",href:"/admin/gmail",description:"Breakdown email connection and settings.",adminOnly:true},
      {label:"Breakdown Texting",href:"/admin/twilio",description:"SMS/Twilio configuration.",adminOnly:true},
    ],
  },
  {
    title:"Users & Fleet Connections",
    description:"User access plus Geotab identity, mileage, and device connections.",
    links:[
      {label:"Users & Access",href:"/admin/users",description:"Roles, yard visibility, and assigned parts warehouse.",adminOnly:true},
      {label:"Fleet / Geotab Health",href:"/admin/geotab-review/health",description:"Connection health and structured fleet coverage.",adminOnly:true},
      {label:"Device Assignments",href:"/admin/geotab-review/assignments",description:"Review Geotab device-to-unit assignments.",adminOnly:true},
      {label:"Identity & Mileage",href:"/admin/geotab-review",description:"Resolve unit identity and mileage issues.",adminOnly:true},
      {label:"Geotab Connection",href:"/admin/geotab-review/connection",description:"Geotab credentials and connection state.",adminOnly:true},
    ],
  },
  {
    title:"Billing Setup",
    description:"Customers, billing rates, and invoice configuration.",
    links:[
      {label:"Customers & Rates",href:"/invoices?view=settings",description:"Customer records, rates, and invoice settings."},
      {label:"Ready to Bill",href:"/invoices?view=ready",description:"Review completed work that is ready for billing."},
    ],
  },
  {
    title:"Advanced Admin",
    description:"Occasional administrative and data-maintenance tools.",
    links:[
      {label:"Duplicate Units",href:"/admin/equipment-merge",description:"Review and merge duplicate equipment records.",adminOnly:true},
      {label:"History Import",href:"/admin/history-import",description:"Import historical maintenance and repair records.",adminOnly:true},
      {label:"Go-Live Cutover",href:"/admin/go-live-cutover",description:"Production cutover and deployment checks.",adminOnly:true},
    ],
  },
];

export default function SetupCenterPage(){
  const[user,setUser]=useState<User|null>(null);
  const[message,setMessage]=useState("");

  useEffect(()=>{
    void fetch("/api/auth/me",{cache:"no-store"})
      .then(async response=>{
        if(response.status===401){window.location.assign("/login?returnTo=/setup-center");return null;}
        const payload=await response.json() as{user?:User;error?:string};
        if(!response.ok||!payload.user)throw new Error(payload.error||"Setup could not be loaded.");
        if(payload.user.role!=="manager"&&payload.user.role!=="admin")throw new Error("Setup requires manager or admin access.");
        return payload.user;
      })
      .then(result=>{if(result)setUser(result);})
      .catch(error=>setMessage(error instanceof Error?error.message:"Setup could not be loaded."));
  },[]);

  const visibleGroups=useMemo(()=>groups
    .map(group=>({...group,links:group.links.filter(link=>!link.adminOnly||user?.role==="admin")}))
    .filter(group=>group.links.length>0),[user?.role]);

  return <main style={page}>
    <header style={header}>
      <div>
        <p style={eyebrow}>SETUP</p>
        <h1 style={h1}>Setup Home</h1>
        <p style={subtitle}>Configuration lives here instead of filling the main sidebar. Pick the area you need, then work inside that setup screen.</p>
      </div>
      {user&&<span style={rolePill}>{user.role==="admin"?"Administrator":"Manager"} setup</span>}
    </header>

    {message&&<div style={notice}>{message}</div>}

    {!user&&!message&&<div style={loading}>Loading setup…</div>}

    {user&&<section style={grid}>
      {visibleGroups.map(group=><article key={group.title} style={card}>
        <div>
          <h2 style={title}>{group.title}</h2>
          <p style={description}>{group.description}</p>
        </div>
        <div style={linkList}>
          {group.links.map(link=><a key={link.href} href={link.href} style={linkRow}>
            <span><strong style={linkTitle}>{link.label}</strong><small style={linkDescription}>{link.description}</small></span>
            <b style={arrow}>›</b>
          </a>)}
        </div>
      </article>)}
    </section>}
  </main>;
}

const page={minHeight:"100vh",background:"#f3f5f7",padding:"38px 34px 100px",color:"#182331"} as const;
const header={display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:18,flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".14em"} as const;
const h1={margin:"7px 0 5px",fontSize:34,color:"#0d1b2b"} as const;
const subtitle={margin:0,maxWidth:760,color:"#667482",fontSize:13,lineHeight:1.5} as const;
const rolePill={padding:"7px 11px",borderRadius:999,background:"#e8eef5",color:"#29435d",fontSize:11,fontWeight:900,textTransform:"uppercase" as const,letterSpacing:".05em"} as const;
const notice={marginTop:16,padding:12,border:"1px solid #efc16c",borderRadius:9,background:"#fff8e6",fontWeight:750} as const;
const loading={marginTop:18,padding:22,border:"1px solid #dce2e7",borderRadius:12,background:"white",color:"#667482"} as const;
const grid={marginTop:20,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(330px,1fr))",gap:16,alignItems:"start"} as const;
const card={background:"white",border:"1px solid #dce2e7",borderRadius:13,padding:18,boxShadow:"0 5px 22px rgba(19,37,55,.05)",display:"grid",gap:14} as const;
const title={margin:0,fontSize:20,color:"#0d1b2b"} as const;
const description={margin:"5px 0 0",color:"#6a7784",fontSize:12,lineHeight:1.45} as const;
const linkList={display:"grid",gap:7} as const;
const linkRow={display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"10px 11px",border:"1px solid #e3e8ec",borderRadius:9,background:"#fbfcfd",textDecoration:"none",color:"#1f3142"} as const;
const linkTitle={display:"block",fontSize:13} as const;
const linkDescription={display:"block",marginTop:3,color:"#75818d",fontSize:10,lineHeight:1.35} as const;
const arrow={fontSize:22,color:"#7b8792",lineHeight:1} as const;
