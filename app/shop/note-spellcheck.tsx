'use client';
import {useRef,useState,type TextareaHTMLAttributes} from 'react';
type Props=TextareaHTMLAttributes<HTMLTextAreaElement>&{value:string};
export default function NoteSpellcheck({value,onChange,disabled,maxLength,...props}:Props){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[proposal,setProposal]=useState<{original:string;corrected:string}|null>(null),[undo,setUndo]=useState<{original:string;corrected:string}|null>(null);
  const latest=useRef(value);latest.current=value;
  const blocked=useRef(disabled);blocked.current=disabled;
  const limit=Math.min(maxLength??2000,2000);
  function change(next:string){
    // Preserve existing controlled-field handlers, including their length limits.
    onChange?.({target:{value:next},currentTarget:{value:next}} as React.ChangeEvent<HTMLTextAreaElement>);
  }
  async function check(){
    const original=value;
    setBusy(true);setProposal(null);setMessage('');
    try{
      const response=await fetch('/api/shop/note-spellcheck',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({note:original})});
      const data=await response.json() as {corrected?:string;error?:string};
      if(latest.current!==original||blocked.current)return;
      if(!response.ok||typeof data.corrected!=='string')throw new Error(data.error||'Correction unavailable.');
      if(data.corrected.length>limit)throw new Error('Correction exceeds the note length limit.');
      if(data.corrected===original){setMessage('No corrections suggested.');return}
      setProposal({original,corrected:data.corrected});
    }catch(error){if(latest.current===original)setMessage(error instanceof Error?error.message:'Correction unavailable.')}
    finally{setBusy(false)}
  }
  const buttonStyle={fontSize:12,padding:'6px 10px',border:'1px solid #aebdca',borderRadius:7,background:'#fff',color:'#182331',cursor:'pointer'} as const;
  return <div style={{display:'grid',gap:6,minWidth:0}}>
    <textarea {...props} value={value} onChange={onChange} disabled={disabled} maxLength={maxLength} spellCheck lang="en-US"/>
    {!disabled&&<><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      <button type="button" style={buttonStyle} disabled={busy||!value.trim()||value.length>limit} onClick={()=>void check()}>{busy?'Checking…':'Fix Spelling & Grammar'}</button>
      {undo&&undo.corrected===value&&<button type="button" style={buttonStyle} onClick={()=>{change(undo.original);setUndo(null);setProposal(null);setMessage('Original restored.')}}>Undo Correction</button>}
    </div>
    {proposal&&proposal.original===value&&<div style={{border:'1px solid #aebdca',borderRadius:7,padding:8,background:'#fff',color:'#182331'}}><strong>Review suggested correction</strong><div style={{whiteSpace:'pre-wrap',margin:'6px 0'}}>{proposal.corrected}</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button type="button" style={buttonStyle} onClick={()=>{change(proposal.corrected);setUndo(proposal);setProposal(null);setMessage('Correction applied. Review before saving.')}}>Apply Correction</button><button type="button" style={buttonStyle} onClick={()=>setProposal(null)}>Keep Original</button></div></div>}
    {message&&<span role="status" style={{fontSize:12}}>{message}</span>}</>}
  </div>
}
