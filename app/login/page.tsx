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

  return <main style={{position:"fixed",inset:0,zIndex:1000,overflow:"auto",background:"#f1f4f2",color:"#1b2421",display:"grid",placeItems:"center",padding:24}}>
    <section style={{width:"min(460px, 100%)",background:"white",border:"1px solid #d7ded9",borderRadius:18,padding:32,boxShadow:"0 24px 70px #173f3718"}}>
      <div style={{marginBottom:22}}>
        <img src="/northern-logistics-logo.webp" alt="Northern Logistics — Employee Owned" style={{display:"block",width:230,maxWidth:"100%",height:"auto"}}/>
        <span style={{display:"block",marginTop:8,color:"#68746f",fontSize:12}}>Maintenance Software</span>
      </div>
      <h1 style={{margin:0,fontSize:30,color:"#173f37"}}>Sign in</h1>
      <p style={{margin:"8px 0 24px",color:"#68746f",lineHeight:1.5}}>Use the username and password created for you by an administrator.</p>
      {message&&<div style={{marginBottom:16,padding:12,borderRadius:9,background:"#fff3e9",border:"1px solid #f6b47d",color:"#88420b"}}>{message}</div>}
      <form onSubmit={signIn} style={{display:"grid",gap:14}}>
        <label style={{display:"grid",gap:6,fontWeight:700}}>Username
          <input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)} style={{border:"1px solid #b9c6c0",background:"white",color:"#1b2421",borderRadius:9,padding:"12px 13px",fontSize:15}}/>
        </label>
        <label style={{display:"grid",gap:6,fontWeight:700}}>Password
          <input autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)} style={{border:"1px solid #b9c6c0",background:"white",color:"#1b2421",borderRadius:9,padding:"12px 13px",fontSize:15}}/>
        </label>
        <button disabled={busy} type="submit" style={{border:0,borderRadius:9,padding:"13px 18px",background:"#2f6f60",color:"white",fontWeight:900,fontSize:15,cursor:busy?"wait":"pointer",opacity:busy?.7:1}}>{busy?"Signing in…":"Sign in"}</button>
      </form>
      <p style={{margin:"18px 0 0",fontSize:12,color:"#87928d"}}>Existing administrator email logins remain supported during the username rollout.</p>
    </section>
  </main>;
}
