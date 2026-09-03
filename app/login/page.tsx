"use client";

import { FormEvent, useState } from "react";

type LoginUser = { role?: "viewer" | "mechanic" | "dispatch" | "manager" | "admin" };

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/login", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ username, password }) });
      const result = await response.json() as { error?:string; setupRequired?:boolean; user?:LoginUser };
      if (result.setupRequired) { window.location.assign("/setup"); return; }
      if (!response.ok) { setMessage(result.error || "Sign in failed."); return; }
      const params = new URLSearchParams(window.location.search);
      const defaultPath = result.user?.role === "mechanic" ? "/shop" : "/repair-board";
      const requested = params.get("returnTo") || defaultPath;
      const returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : defaultPath;
      window.location.assign(returnTo);
    } catch { setMessage("The dashboard could not be reached."); } finally { setBusy(false); }
  }

  return <main style={{position:"fixed",inset:0,zIndex:1000,overflow:"auto",background:"#0d1b2b",color:"#182331",display:"grid",placeItems:"center",padding:24}}><section style={{width:"min(460px, 100%)",background:"white",borderRadius:18,padding:32,boxShadow:"0 24px 70px #0007"}}><div style={{display:"inline-flex",alignItems:"center",gap:10,marginBottom:22}}><div style={{width:40,height:40,borderRadius:10,background:"#f47b20",display:"grid",placeItems:"center",color:"white",fontWeight:900}}>N</div><div><strong style={{display:"block",color:"#0d1b2b",letterSpacing:".02em"}}>NORLOW FLEET OPERATIONS</strong><span style={{color:"#6c7886",fontSize:12}}>Repair, PM, inventory and shop labor</span></div></div><h1 style={{margin:0,fontSize:30,color:"#0d1b2b"}}>Sign in</h1><p style={{margin:"8px 0 24px",color:"#6c7886",lineHeight:1.5}}>Use the username and password created for you by an administrator.</p>{message&&<div style={{marginBottom:16,padding:12,borderRadius:9,background:"#fff3e9",border:"1px solid #f6b47d",color:"#88420b"}}>{message}</div>}<form onSubmit={signIn} style={{display:"grid",gap:14}}><label style={{display:"grid",gap:6,fontWeight:700}}>Username<input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)} style={{border:"1px solid #ccd5dd",borderRadius:9,padding:"12px 13px",fontSize:15}}/></label><label style={{display:"grid",gap:6,fontWeight:700}}>Password<input autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)} style={{border:"1px solid #ccd5dd",borderRadius:9,padding:"12px 13px",fontSize:15}}/></label><button disabled={busy} type="submit" style={{border:0,borderRadius:9,padding:"13px 18px",background:"#f47b20",color:"white",fontWeight:900,fontSize:15,cursor:busy?"wait":"pointer",opacity:busy?.7:1}}>{busy?"Signing in…":"Sign in"}</button></form><p style={{margin:"18px 0 0",fontSize:12,color:"#87929c"}}>Existing administrator email logins remain supported during the username rollout.</p></section></main>;
}
