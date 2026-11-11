"use client";

import {useCallback,useEffect,useRef,useState} from "react";

type PullThruAlert={
  id:number;
  repairId:string;
  title:string;
  body:string;
  unit:string;
  repairTitle:string;
  createdAt:string;
};

export default function PullThruTabletAlert(){
  const[alert,setAlert]=useState<PullThruAlert|null>(null);
  const[audioReady,setAudioReady]=useState(false);
  const[ackError,setAckError]=useState("");
  const contextRef=useRef<AudioContext|null>(null);
  const playedRef=useRef<number|null>(null);

  const getContext=useCallback(()=>{
    if(typeof window==="undefined")return null;
    const AudioContextCtor=window.AudioContext||(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!AudioContextCtor)return null;
    if(!contextRef.current)contextRef.current=new AudioContextCtor();
    return contextRef.current;
  },[]);

  const unlockAudio=useCallback(async()=>{
    const context=getContext();
    if(!context)return;
    try{
      if(context.state==="suspended")await context.resume();
      if(context.state==="running")setAudioReady(true);
    }catch{}
  },[getContext]);

  const playAlarm=useCallback(async(current:PullThruAlert)=>{
    if(playedRef.current===current.id)return;
    const context=getContext();
    if(!context)return;
    try{
      if(context.state==="suspended")await context.resume();
      if(context.state!=="running")return;
      const start=context.currentTime+0.03;
      [0,0.32,0.64,1.02].forEach((offset,index)=>{
        const oscillator=context.createOscillator();
        const gain=context.createGain();
        oscillator.type="square";
        oscillator.frequency.setValueAtTime(index===3?660:880,start+offset);
        gain.gain.setValueAtTime(0.0001,start+offset);
        gain.gain.exponentialRampToValueAtTime(0.22,start+offset+0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001,start+offset+0.19);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start+offset);
        oscillator.stop(start+offset+0.21);
      });
      if("vibrate" in navigator)navigator.vibrate?.([250,120,250,120,350]);
      playedRef.current=current.id;
      setAudioReady(true);
    }catch{}
  },[getContext]);

  const load=useCallback(async()=>{
    try{
      const response=await fetch("/api/shop/pull-thru-alert",{cache:"no-store"});
      if(!response.ok)return;
      const payload=await response.json() as{alert?:PullThruAlert|null};
      const next=payload.alert??null;
      setAlert(current=>current?.id===next?.id?current:next);
      if(next)void playAlarm(next);
    }catch{}
  },[playAlarm]);

  async function acknowledge(){
    if(!alert)return;
    setAckError("");
    try{
      const response=await fetch("/api/shop/pull-thru-alert",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({alertId:alert.id}),
      });
      const payload=await response.json() as{ok?:boolean;acknowledged?:boolean;error?:string};
      if(!response.ok||!payload.ok||!payload.acknowledged){
        throw new Error(payload.error||"Pull Thru acknowledgement did not save.");
      }
      playedRef.current=null;
      setAlert(null);
      window.setTimeout(()=>void load(),250);
    }catch(error){
      setAckError(error instanceof Error?error.message:"Pull Thru acknowledgement did not save.");
    }
  }

  useEffect(()=>{
    const unlock=()=>void unlockAudio();
    window.addEventListener("pointerdown",unlock,{passive:true});
    window.addEventListener("keydown",unlock);
    window.addEventListener("touchstart",unlock,{passive:true});
    void load();
    const id=window.setInterval(()=>void load(),4000);
    return()=>{
      window.clearInterval(id);
      window.removeEventListener("pointerdown",unlock);
      window.removeEventListener("keydown",unlock);
      window.removeEventListener("touchstart",unlock);
      void contextRef.current?.close().catch(()=>undefined);
    };
  },[load,unlockAudio]);

  useEffect(()=>{
    if(alert&&audioReady&&playedRef.current!==alert.id)void playAlarm(alert);
  },[alert,audioReady,playAlarm]);

  if(!alert)return null;
  return <div style={backdrop} role="alertdialog" aria-live="assertive" aria-label="Pull Thru alert">
    <div style={card}>
      <div style={alarmIcon}>🔔</div>
      <div style={{minWidth:0}}>
        <div style={eyebrow}>PULL THRU COMING</div>
        <strong style={title}>{alert.unit?"Unit "+alert.unit:alert.title}</strong>
        <div style={body}>{alert.repairTitle||alert.body}</div>
        {!audioReady&&<div style={soundHint}>Tap the tablet once to enable the alert sound.</div>}
        {ackError&&<div style={errorHint}>{ackError}</div>}
      </div>
      <button type="button" onClick={()=>void acknowledge()} style={button}>GOT IT</button>
    </div>
  </div>;
}

const backdrop={position:"fixed",inset:0,zIndex:200,display:"grid",placeItems:"start center",padding:"20px 14px",background:"#06120db8",pointerEvents:"auto"} as const;
const card={width:"min(720px,100%)",display:"grid",gridTemplateColumns:"60px minmax(0,1fr) auto",gap:14,alignItems:"center",padding:"18px",border:"3px solid #ff9b2f",borderRadius:16,background:"#fff8e9",boxShadow:"0 18px 60px #0006",color:"#172a22"} as const;
const alarmIcon={width:54,height:54,display:"grid",placeItems:"center",borderRadius:14,background:"#ff9b2f",fontSize:28} as const;
const eyebrow={fontSize:12,fontWeight:950,letterSpacing:".15em",color:"#a54d00",marginBottom:4} as const;
const title={display:"block",fontSize:27,lineHeight:1.05,color:"#173f37"} as const;
const body={marginTop:5,fontSize:14,fontWeight:800,color:"#4f5c57"} as const;
const soundHint={marginTop:8,fontSize:11,fontWeight:900,color:"#9a5a05"} as const;
const errorHint={marginTop:8,fontSize:11,fontWeight:900,color:"#b42318"} as const;
const button={minHeight:50,border:0,borderRadius:10,padding:"0 18px",background:"#173f37",color:"white",fontWeight:950,cursor:"pointer"} as const;
