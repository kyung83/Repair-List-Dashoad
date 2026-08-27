"use client";

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

type GmailStatus = {
  configured: boolean;
  connected: boolean;
  clientId: string;
  connectedEmail: string;
  connectedAt: string;
  updatedAt: string;
  sender: string;
  recipient: string;
  redirectUri: string;
};

function when(value: string) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function GmailConnectionPage() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [editingClient, setEditingClient] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const queryMessage = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) return `Connected ${connected}. Breakdown email can now send through Gmail.`;
    return error || '';
  }, []);

  async function load() {
    const response = await fetch('/api/admin/gmail', { cache: 'no-store' });
    const result = await response.json() as GmailStatus & { error?: string };
    if (response.status === 401) { window.location.assign('/login?returnTo=/admin/gmail'); return; }
    if (!response.ok) throw new Error(result.error || 'Gmail connection status could not be loaded.');
    setStatus(result);
    setClientId(current => current || result.clientId || '');
  }

  useEffect(() => {
    setMessage(queryMessage);
    void load().catch(error => setMessage(error instanceof Error ? error.message : 'Gmail connection status could not be loaded.'));
  }, [queryMessage]);

  async function saveClient() {
    if (!clientId.trim() || !clientSecret.trim()) {
      setMessage('Enter the Google OAuth Client ID and Client Secret first.');
      return;
    }
    setBusy('save'); setMessage('');
    try {
      const response = await fetch('/api/admin/gmail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save-client', clientId, clientSecret }),
      });
      const result = await response.json() as { ok?: boolean; message?: string; error?: string; status?: GmailStatus };
      if (!response.ok || !result.ok) throw new Error(result.error || 'Google OAuth client could not be saved.');
      setClientSecret('');
      setEditingClient(false);
      setMessage(result.message || 'Google OAuth client saved.');
      if (result.status) setStatus(result.status); else await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google OAuth client could not be saved.');
    } finally { setBusy(''); }
  }

  async function connectGmail() {
    setBusy('connect'); setMessage('');
    try {
      const response = await fetch('/api/admin/gmail/authorize', { method: 'POST' });
      const result = await response.json() as { ok?: boolean; authorizationUrl?: string; error?: string };
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || 'Gmail authorization could not be started.');
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gmail authorization could not be started.');
      setBusy('');
    }
  }

  async function action(kind: 'test' | 'disconnect' | 'clear-client') {
    if (kind !== 'test' && !window.confirm(kind === 'disconnect' ? 'Disconnect Gmail from breakdown alerts?' : 'Remove the Google OAuth client and Gmail connection?')) return;
    setBusy(kind); setMessage('');
    try {
      const response = await fetch('/api/admin/gmail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: kind }),
      });
      const result = await response.json() as { ok?: boolean; message?: string; error?: string; status?: GmailStatus };
      if (!response.ok || !result.ok) throw new Error(result.error || 'Gmail action failed.');
      setMessage(result.message || 'Done.');
      if (result.status) setStatus(result.status); else await load();
      if (kind === 'clear-client') { setClientId(''); setClientSecret(''); setEditingClient(false); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gmail action failed.');
    } finally { setBusy(''); }
  }

  const connected = Boolean(status?.connected);
  const showClientForm = !status?.configured || editingClient;

  return <section style={{ background: '#f3f5f7', padding: '0 clamp(16px,4vw,46px) 20px', color: '#182331' }}>
    <div style={{ ...card, borderColor: connected ? '#b9d9c3' : '#e5b765', background: connected ? '#f4fbf6' : '#fff9ed' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 15, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 950, letterSpacing: '.12em', color: connected ? '#25713c' : '#9a6508' }}>DIAGNOSTICS · BREAKDOWN EMAIL</div>
          <h2 style={{ margin: '6px 0 0', fontSize: 23, color: '#102238' }}>{connected ? 'Jerry Gmail is connected' : 'Connect Jerry Gmail'}</h2>
          <p style={copy}>{connected ? 'New breakdowns and provider/ETA updates will send through the authenticated Gmail account.' : 'This replaces the unverified Cloudflare sender with the real Northern Google Workspace mailbox.'}</p>
        </div>
        {connected && <button type="button" disabled={Boolean(busy)} onClick={() => void action('test')} style={primaryButton}>{busy === 'test' ? 'Sending…' : 'Send test email'}</button>}
      </div>

      {message && <div style={notice}>{message}</div>}

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(250px,.8fr) minmax(420px,1.4fr)', gap: 14, alignItems: 'start' }}>
        <div style={infoCard}>
          <strong style={{ fontSize: 15 }}>Breakdown email path</strong>
          <div style={detail}><span>From</span><strong>{status?.sender || 'Jtomaski@norloworld.com'}</strong></div>
          <div style={detail}><span>To</span><strong>{status?.recipient || 'breakdown@norloworld.com'}</strong></div>
          <div style={detail}><span>Status</span><strong>{connected ? 'Connected' : status?.configured ? 'OAuth client ready' : 'Needs Google OAuth client'}</strong></div>
          {connected && <><div style={detail}><span>Google account</span><strong>{status?.connectedEmail}</strong></div><div style={detail}><span>Connected</span><strong>{when(status?.connectedAt || '')}</strong></div></>}
        </div>

        <div style={formCard}>
          {!status?.configured && <>
            <div><strong style={{ fontSize: 16 }}>One Google setup step</strong><p style={smallCopy}>Google requires an OAuth Web Application before the dashboard can ask for permission to send as your mailbox. Enable Gmail API, use only the Gmail send permission, and register the callback below.</p></div>
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={linkButton}>Open Google Cloud credentials</a>
          </>}

          <div>
            <label style={label}>Authorized redirect URI</label>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <code style={codeBox}>{status?.redirectUri || 'https://norlow-repair-dashboard.norlo-repair-system.workers.dev/api/admin/gmail/callback'}</code>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(status?.redirectUri || '')}>Copy</button>
            </div>
          </div>

          {showClientForm ? <>
            <label style={label}>Google OAuth Client ID<input style={input} value={clientId} onChange={event => setClientId(event.target.value)} autoComplete="off" placeholder="...apps.googleusercontent.com" /></label>
            <label style={label}>Google OAuth Client Secret<input style={input} type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} autoComplete="new-password" placeholder="Paste once; it is encrypted before D1 storage" /></label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={Boolean(busy)} onClick={() => void saveClient()} style={primaryButton}>{busy === 'save' ? 'Saving…' : 'Save Google OAuth client'}</button>
              {status?.configured && <button type="button" disabled={Boolean(busy)} onClick={() => { setEditingClient(false); setClientSecret(''); }}>Cancel</button>}
            </div>
          </> : <>
            <div style={{ padding: 12, border: '1px solid #d6e0e7', borderRadius: 9, background: '#f9fbfc' }}><strong>OAuth client saved</strong><div style={{ marginTop: 4, fontSize: 12, color: '#60717f', overflowWrap: 'anywhere' }}>{status?.clientId}</div></div>
            {!connected && <button type="button" disabled={Boolean(busy)} onClick={() => void connectGmail()} style={primaryButton}>{busy === 'connect' ? 'Opening Google…' : 'Connect Jtomaski Gmail'}</button>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={Boolean(busy)} onClick={() => setEditingClient(true)}>Replace OAuth client</button>
              {connected && <button type="button" disabled={Boolean(busy)} onClick={() => void action('disconnect')}>Disconnect Gmail</button>}
              <button type="button" disabled={Boolean(busy)} onClick={() => void action('clear-client')} style={dangerButton}>Remove OAuth setup</button>
            </div>
          </>}
        </div>
      </div>
    </div>
  </section>;
}

const card: CSSProperties = { border: '2px solid', borderRadius: 14, padding: 18, boxShadow: '0 3px 14px rgba(15,32,48,.05)' };
const copy: CSSProperties = { margin: '7px 0 0', color: '#586979', lineHeight: 1.55, fontSize: 14 };
const smallCopy: CSSProperties = { margin: '7px 0 12px', color: '#657482', lineHeight: 1.5, fontSize: 12 };
const infoCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: 'white', display: 'grid', gap: 10 };
const formCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: 'white', display: 'grid', gap: 11 };
const label: CSSProperties = { display: 'grid', gap: 5, color: '#485b6b', fontSize: 11, fontWeight: 900 };
const input: CSSProperties = { minHeight: 42, padding: '0 10px', border: '1px solid #cbd5dd', borderRadius: 8, background: 'white', color: '#172536', fontSize: 13 };
const notice: CSSProperties = { marginTop: 12, padding: '10px 11px', border: '1px solid #d8c17b', borderRadius: 8, background: '#fffdf2', fontSize: 13 };
const linkButton: CSSProperties = { display: 'inline-flex', width: 'fit-content', alignItems: 'center', minHeight: 36, padding: '0 10px', border: '1px solid #ccd5dd', borderRadius: 8, color: '#17324a', textDecoration: 'none', fontWeight: 850, fontSize: 12 };
const primaryButton: CSSProperties = { border: 0, borderRadius: 7, padding: '8px 11px', background: '#0d1b2b', color: 'white', fontWeight: 900 };
const dangerButton: CSSProperties = { border: '1px solid #d8a19d', borderRadius: 7, padding: '8px 11px', background: '#fff5f4', color: '#9b2c25', fontWeight: 850 };
const codeBox: CSSProperties = { display: 'block', flex: 1, padding: '9px 10px', border: '1px solid #dce3e8', borderRadius: 8, background: '#f7f9fa', fontSize: 11, overflowWrap: 'anywhere' };
const detail: CSSProperties = { display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, fontSize: 12, alignItems: 'baseline' };
