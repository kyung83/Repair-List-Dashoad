'use client';

import { useEffect, useMemo, useState } from 'react';

type KeyRow = {
  id:number;
  label:string;
  tokenPrefix:string;
  createdAt:string;
  lastUsedAt:string|null;
  revokedAt:string|null;
  active:boolean;
};

type CreatedKey = {
  id:number;
  label:string;
  token:string;
  tokenPrefix:string;
};

const panel = { background:'#fff', border:'1px solid #dce2e7', borderRadius:14, padding:18 } as const;
const button = { border:0, borderRadius:8, padding:'10px 14px', background:'#0d1b2b', color:'#fff', fontWeight:850, cursor:'pointer' } as const;
const lightButton = { ...button, background:'#e8edf2', color:'#172033' } as const;

function when(value:string|null) {
  if (!value) return 'Never';
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function YardCheckApiPage() {
  const [keys,setKeys] = useState<KeyRow[]>([]);
  const [label,setLabel] = useState('');
  const [created,setCreated] = useState<CreatedKey|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [script,setScript] = useState('');

  const apiUrl = useMemo(() => typeof window === 'undefined' ? '' : `${window.location.origin}/api/integrations/yard-check/repair-board`, []);

  async function load() {
    const response = await fetch('/api/admin/yard-check-api', { cache:'no-store' });
    const payload = await response.json() as { keys?:KeyRow[]; error?:string };
    if (!response.ok) throw new Error(payload.error || 'Yard Check API settings could not be loaded.');
    setKeys(payload.keys ?? []);
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Yard Check API settings could not be loaded.'));
  }, []);

  async function createKey() {
    if (busy) return;
    const cleanLabel = label.trim();
    if (!cleanLabel) { setMessage('Enter a name such as “GR Yard Check - Mike”.'); return; }
    setBusy(true); setMessage(''); setCreated(null);
    try {
      const response = await fetch('/api/admin/yard-check-api', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ action:'createKey', label:cleanLabel }),
      });
      const payload = await response.json() as { created?:CreatedKey; error?:string };
      if (!response.ok || !payload.created) throw new Error(payload.error || 'API key could not be created.');
      setCreated(payload.created);
      setLabel('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'API key could not be created.');
    } finally { setBusy(false); }
  }

  async function revokeKey(row:KeyRow) {
    if (busy || !row.active) return;
    if (!window.confirm(`Revoke ${row.label}? The Google Sheet using this key will stop receiving Repair Board data.`)) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/yard-check-api', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ action:'revokeKey', id:row.id }),
      });
      const payload = await response.json() as { ok?:boolean; error?:string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'API key could not be revoked.');
      if (created?.id === row.id) setCreated(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'API key could not be revoked.');
    } finally { setBusy(false); }
  }

  async function copy(value:string, success:string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(success);
    } catch {
      setMessage('Copy was blocked by the browser. Select the text and copy it manually.');
    }
  }

  async function loadScript() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/yard-check-api/google-script', { cache:'no-store' });
      const text = await response.text();
      if (!response.ok) throw new Error(text || 'Google Apps Script could not be loaded.');
      setScript(text);
      await copy(text, 'Google Apps Script copied. Paste it into Extensions > Apps Script in the Yard Check spreadsheet.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google Apps Script could not be loaded.');
    } finally { setBusy(false); }
  }

  return <main style={{ minHeight:'100vh', background:'#f3f5f7', color:'#172033', padding:'34px 34px 110px' }}>
    <div style={{ maxWidth:1100, margin:'0 auto' }}>
      <p style={{ margin:0, color:'#b45309', fontWeight:900, letterSpacing:'.14em', fontSize:12 }}>SETUP</p>
      <h1 style={{ margin:'7px 0 0', fontSize:34 }}>Yard Check API</h1>
      <p style={{ color:'#64748b', maxWidth:900, lineHeight:1.55 }}>
        Give a Google Yard Check spreadsheet read-only access to the current Repair Board. The connection can see unit, yard, repair type, issue, status, technician, OOS and working status. It cannot assign, edit, complete, or delete repairs.
      </p>

      {message && <div style={{ ...panel, marginTop:14, background:'#fff8e6', borderColor:'#f2c66d' }}>{message}</div>}

      <section style={{ ...panel, marginTop:18 }}>
        <h2 style={{ marginTop:0 }}>1. Create a connection key</h2>
        <p style={{ color:'#64748b' }}>Use a different key for each coworker or spreadsheet. You can revoke one later without affecting the others.</p>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Example: GR Yard Check - Mike"
            maxLength={80}
            style={{ flex:'1 1 360px', padding:'10px 11px', border:'1px solid #cbd5e1', borderRadius:8 }}
          />
          <button type="button" style={button} onClick={createKey} disabled={busy}>{busy ? 'Working…' : 'Generate Read-Only Key'}</button>
        </div>

        {created && <div style={{ marginTop:16, border:'2px solid #f59e0b', borderRadius:12, padding:16, background:'#fffbeb' }}>
          <strong>Copy this key now. It will not be shown again after you leave or reload this page.</strong>
          <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
            <code style={{ flex:'1 1 600px', padding:12, background:'#fff', border:'1px solid #f2c66d', borderRadius:8, overflowWrap:'anywhere' }}>{created.token}</code>
            <button type="button" style={lightButton} onClick={() => copy(created.token, 'API key copied.')}>Copy Key</button>
          </div>
        </div>}
      </section>

      <section style={{ ...panel, marginTop:18 }}>
        <h2 style={{ marginTop:0 }}>2. Put the connection in the Google Sheet</h2>
        <p style={{ color:'#64748b', lineHeight:1.55 }}>
          In the coworker&apos;s Yard Check spreadsheet open <b>Extensions → Apps Script</b>, replace the code with the Northern script, save it, then reload the spreadsheet. The new <b>Northern Yard Check</b> menu will walk them through the API key and Yard Check tab setup.
        </p>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button type="button" style={button} onClick={loadScript} disabled={busy}>Copy Full Google Apps Script</button>
          <button type="button" style={lightButton} onClick={() => copy(apiUrl, 'Read-only API URL copied.')}>Copy API URL</button>
        </div>
        <div style={{ marginTop:12, color:'#64748b', fontSize:13 }}><b>Read-only URL:</b> {apiUrl}</div>
        {script && <details style={{ marginTop:14 }}>
          <summary style={{ cursor:'pointer', fontWeight:850 }}>Show paste-ready Apps Script</summary>
          <textarea readOnly value={script} style={{ width:'100%', minHeight:360, marginTop:10, fontFamily:'monospace', fontSize:12, border:'1px solid #cbd5e1', borderRadius:8, padding:12 }} />
        </details>}
      </section>

      <section style={{ ...panel, marginTop:18 }}>
        <h2 style={{ marginTop:0 }}>3. Active connections</h2>
        {!keys.length ? <p style={{ color:'#64748b' }}>No Yard Check connections have been created yet.</p> :
          <div style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              {['Name','Key','Created','Last Used','Status',''].map((heading) => <th key={heading} style={{ textAlign:'left', padding:'9px 8px', borderBottom:'1px solid #dce2e7', whiteSpace:'nowrap' }}>{heading}</th>)}
            </tr></thead>
            <tbody>{keys.map((row) => <tr key={row.id}>
              <td style={{ padding:8, borderBottom:'1px solid #eef2f5', fontWeight:800 }}>{row.label}</td>
              <td style={{ padding:8, borderBottom:'1px solid #eef2f5' }}><code>{row.tokenPrefix}</code></td>
              <td style={{ padding:8, borderBottom:'1px solid #eef2f5', whiteSpace:'nowrap' }}>{when(row.createdAt)}</td>
              <td style={{ padding:8, borderBottom:'1px solid #eef2f5', whiteSpace:'nowrap' }}>{when(row.lastUsedAt)}</td>
              <td style={{ padding:8, borderBottom:'1px solid #eef2f5', fontWeight:850 }}>{row.active ? 'ACTIVE' : 'REVOKED'}</td>
              <td style={{ padding:8, borderBottom:'1px solid #eef2f5' }}>{row.active && <button type="button" style={{ ...lightButton, color:'#b91c1c' }} onClick={() => revokeKey(row)} disabled={busy}>Revoke</button>}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>

      <section style={{ ...panel, marginTop:18, background:'#f8fafc' }}>
        <h3 style={{ marginTop:0 }}>What the Google script creates</h3>
        <p style={{ marginBottom:0, lineHeight:1.55 }}>
          It leaves the coworker&apos;s Yard Check tab alone. It creates <b>Repair Board Import</b> for the individual open repair lines and <b>Yard Check Comparison</b> for the one-row-per-unit comparison. The comparison shows units on both lists, Yard Check-only units, and Repair Board-only units. A 5-minute automatic refresh can be turned on from the spreadsheet menu.
        </p>
      </section>
    </div>
  </main>;
}
