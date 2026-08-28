'use client';

import { useEffect, useState, type CSSProperties } from 'react';

type Connection = {
  configured: boolean;
  enabled: boolean;
  accountSid: string;
  sender: string;
  updatedAt: string;
};
type Template = { key: string; label: string; body: string; active: boolean; updatedAt: string };
type Contact = { id: number; label: string; phone: string; active: boolean };
type Status = { connection: Connection; templates: Template[]; contacts: Contact[]; webhookUrl: string; error?: string };

type ApiResult = { ok?: boolean; message?: string; error?: string; status?: Status };

export default function BreakdownTwilioAdminPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [sender, setSender] = useState('');
  const [editingConnection, setEditingConnection] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/admin/twilio', { cache: 'no-store' });
    const result = await response.json() as Status;
    if (response.status === 401) { window.location.assign('/login?returnTo=/admin/twilio'); return; }
    if (!response.ok) throw new Error(result.error || 'Breakdown texting settings could not be loaded.');
    setStatus(result);
    setAccountSid(current => current || result.connection.accountSid || '');
    setSender(current => current || result.connection.sender || '');
  }

  useEffect(() => {
    void load().catch(error => setMessage(error instanceof Error ? error.message : 'Breakdown texting settings could not be loaded.'));
  }, []);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action); setMessage('');
    try {
      const response = await fetch('/api/admin/twilio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok) throw new Error(result.error || 'Breakdown texting action failed.');
      setMessage(result.message || 'Saved.');
      if (result.status) {
        setStatus(result.status);
        setAccountSid(result.status.connection.accountSid || '');
        setSender(result.status.connection.sender || '');
      } else await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown texting action failed.');
      return false;
    } finally { setBusy(''); }
  }

  async function saveConnection() {
    if (!accountSid.trim() || !authToken.trim() || !sender.trim()) {
      setMessage('Enter the Twilio Account SID, Auth Token, and sending number or Messaging Service SID.');
      return;
    }
    const ok = await post('save-connection', {
      accountSid,
      authToken,
      sender,
      enabled: Boolean(status?.connection.enabled),
    });
    if (ok) { setAuthToken(''); setEditingConnection(false); }
  }

  async function toggleEnabled() {
    await post('set-enabled', { enabled: !status?.connection.enabled });
  }

  async function removeConnection() {
    if (!window.confirm('Remove the saved Twilio connection? Text wording and breakdown text users will stay saved.')) return;
    const ok = await post('clear-connection');
    if (ok) { setAccountSid(''); setAuthToken(''); setSender(''); setEditingConnection(true); }
  }

  async function saveTemplate(template: Template) {
    await post('save-template', {
      templateKey: template.key,
      templateBody: template.body,
      templateActive: template.active,
    });
  }

  async function addContact() {
    if (!newLabel.trim() || !newPhone.trim()) { setMessage('Enter the person’s name and mobile number.'); return; }
    const ok = await post('add-contact', { contactLabel: newLabel, contactPhone: newPhone, contactActive: true });
    if (ok) { setNewLabel(''); setNewPhone(''); }
  }

  async function updateContact(contact: Contact) {
    await post('update-contact', {
      contactId: contact.id,
      contactLabel: contact.label,
      contactPhone: contact.phone,
      contactActive: contact.active,
    });
  }

  async function removeContact(contact: Contact) {
    if (!window.confirm(`Remove ${contact.label || contact.phone} from breakdown texts?`)) return;
    await post('remove-contact', { contactId: contact.id });
  }

  function patchTemplate(key: string, patch: Partial<Template>) {
    setStatus(current => current ? { ...current, templates: current.templates.map(item => item.key === key ? { ...item, ...patch } : item) } : current);
  }
  function patchContact(id: number, patch: Partial<Contact>) {
    setStatus(current => current ? { ...current, contacts: current.contacts.map(item => item.id === id ? { ...item, ...patch } : item) } : current);
  }

  const connection = status?.connection;
  const showConnectionForm = !connection?.configured || editingConnection;

  return <section style={{ background: '#f3f5f7', padding: '0 clamp(16px,4vw,46px) 28px', color: '#182331' }}>
    <div style={{ ...card, borderColor: connection?.enabled ? '#9fcfb0' : '#e5b765', background: connection?.enabled ? '#f4fbf6' : '#fff9ed' }}>
      <div style={rowWrap}>
        <div>
          <div style={eyebrow}>DIAGNOSTICS · BREAKDOWN TEXTING</div>
          <h2 style={heading}>{connection?.enabled ? 'Twilio breakdown texting is live' : connection?.configured ? 'Twilio is connected but paused' : 'Connect Twilio'}</h2>
          <p style={copy}>Cloudflare owns the breakdown users and wording. Twilio only sends the messages and sends replies back to this application.</p>
        </div>
        {connection?.configured && <button type="button" disabled={Boolean(busy)} onClick={() => void toggleEnabled()} style={connection.enabled ? pauseButton : primaryButton}>
          {connection.enabled ? 'Pause Live Texts' : 'Enable Live Texts'}
        </button>}
      </div>

      {message && <div style={notice}>{message}</div>}

      <div style={twoColumn}>
        <div style={infoCard}>
          <strong>Twilio connection</strong>
          <div style={detail}><span>Status</span><strong>{connection?.enabled ? 'LIVE' : connection?.configured ? 'PAUSED' : 'NOT CONNECTED'}</strong></div>
          <div style={detail}><span>Account SID</span><strong style={breakAnywhere}>{connection?.accountSid || '—'}</strong></div>
          <div style={detail}><span>Sending from</span><strong style={breakAnywhere}>{connection?.sender || '—'}</strong></div>
          <div style={{ marginTop: 6 }}>
            <label style={label}>Inbound Twilio webhook</label>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <code style={codeBox}>{status?.webhookUrl || '—'}</code>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(status?.webhookUrl || '')}>Copy</button>
            </div>
            <p style={smallCopy}>Use this as the incoming-message webhook for the same Twilio number or Messaging Service.</p>
          </div>
        </div>

        <div style={formCard}>
          {showConnectionForm ? <>
            <strong>{connection?.configured ? 'Replace Twilio credentials' : 'Twilio credentials'}</strong>
            <label style={label}>Account SID<input style={input} value={accountSid} onChange={event => setAccountSid(event.target.value)} autoComplete="off" placeholder="AC..." /></label>
            <label style={label}>Auth Token<input style={input} type="password" value={authToken} onChange={event => setAuthToken(event.target.value)} autoComplete="new-password" placeholder={connection?.configured ? 'Enter the replacement/current token' : 'Paste Twilio Auth Token'} /></label>
            <label style={label}>Twilio phone number or Messaging Service SID<input style={input} value={sender} onChange={event => setSender(event.target.value)} autoComplete="off" placeholder="+1989... or MG..." /></label>
            <p style={smallCopy}>The Auth Token is encrypted before D1 storage and is never shown back on this page. If Twilio rotates or revokes it, replace it here and save.</p>
            <div style={buttonRow}>
              <button type="button" disabled={Boolean(busy)} onClick={() => void saveConnection()} style={primaryButton}>{busy === 'save-connection' ? 'Saving…' : 'Save Twilio Connection'}</button>
              {connection?.configured && <button type="button" disabled={Boolean(busy)} onClick={() => { setEditingConnection(false); setAuthToken(''); setAccountSid(connection.accountSid); setSender(connection.sender); }}>Cancel</button>}
            </div>
          </> : <>
            <div style={savedBox}><strong>Credentials saved securely</strong><p style={smallCopy}>The Auth Token is stored encrypted and cannot be displayed. Use Replace Credentials whenever Twilio changes it.</p></div>
            <div style={buttonRow}>
              <button type="button" onClick={() => setEditingConnection(true)}>Replace Credentials</button>
              <button type="button" onClick={() => void removeConnection()} style={dangerButton}>Remove Connection</button>
            </div>
          </>}

          {connection?.configured && <div style={{ borderTop: '1px solid #e1e6ea', paddingTop: 12, display: 'grid', gap: 8 }}>
            <strong>Send test text</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <input style={input} value={testPhone} onChange={event => setTestPhone(event.target.value)} placeholder="Mobile number" />
              <button type="button" disabled={Boolean(busy) || !connection.enabled} onClick={() => void post('test', { testPhone })} style={primaryButton}>{busy === 'test' ? 'Sending…' : 'Send Test'}</button>
            </div>
            {!connection.enabled && <small style={{ color: '#8b650c' }}>Enable live texts before sending a test.</small>}
          </div>}
        </div>
      </div>
    </div>

    <div style={{ ...card, marginTop: 16, borderColor: '#d7e0e6', background: '#fff' }}>
      <div>
        <div style={eyebrow}>BREAKDOWN TEXT USERS</div>
        <h2 style={heading}>Who Twilio texts</h2>
        <p style={copy}>Only active numbers on this list receive new breakdown alerts. Those same active numbers are allowed to claim a breakdown by replying with its breakdown number.</p>
      </div>

      <div style={{ ...formCard, marginTop: 14 }}>
        <strong>Add person</strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
          <input style={input} value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder="Name" />
          <input style={input} value={newPhone} onChange={event => setNewPhone(event.target.value)} placeholder="Mobile number" inputMode="tel" />
          <button type="button" disabled={Boolean(busy)} onClick={() => void addContact()} style={primaryButton}>Add User</button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {(status?.contacts || []).map(contact => <div key={contact.id} style={contactRow}>
          <input style={input} value={contact.label} onChange={event => patchContact(contact.id, { label: event.target.value })} />
          <input style={input} value={contact.phone} onChange={event => patchContact(contact.id, { phone: event.target.value })} inputMode="tel" />
          <label style={switchLabel}><input type="checkbox" checked={contact.active} onChange={event => patchContact(contact.id, { active: event.target.checked })} /> Active</label>
          <button type="button" disabled={Boolean(busy)} onClick={() => void updateContact(contact)}>Save</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => void removeContact(contact)} style={dangerButton}>Remove</button>
        </div>)}
        {status && status.contacts.length === 0 && <div style={empty}>No SMS users yet. Add the breakdown contacts you want Twilio to notify.</div>}
      </div>
    </div>

    <div style={{ ...card, marginTop: 16, borderColor: '#d7e0e6', background: '#fff' }}>
      <div style={eyebrow}>TEXT WORDING</div>
      <h2 style={heading}>Messages Twilio reads from Cloudflare</h2>
      <p style={copy}>Edit these without redeploying the application. Double-brace fields such as <code>{'{{driver_name}}'}</code> and <code>{'{{breakdown_id}}'}</code> are filled automatically.</p>
      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        {(status?.templates || []).map(template => <div key={template.key} style={templateCard}>
          <div style={rowWrap}>
            <div><strong>{template.label}</strong><div style={{ fontSize: 11, color: '#758391', marginTop: 2 }}>{template.key}</div></div>
            <label style={switchLabel}><input type="checkbox" checked={template.active} onChange={event => patchTemplate(template.key, { active: event.target.checked })} /> Active</label>
          </div>
          <textarea style={textarea} value={template.body} onChange={event => patchTemplate(template.key, { body: event.target.value })} rows={template.key === 'new_breakdown' ? 10 : 4} />
          <div><button type="button" disabled={Boolean(busy)} onClick={() => void saveTemplate(template)} style={primaryButton}>Save Text</button></div>
        </div>)}
      </div>
    </div>
  </section>;
}

const card: CSSProperties = { border: '2px solid', borderRadius: 14, padding: 18, boxShadow: '0 3px 14px rgba(15,32,48,.05)' };
const heading: CSSProperties = { margin: '6px 0 0', fontSize: 23, color: '#102238' };
const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: '.12em', color: '#415d74' };
const copy: CSSProperties = { margin: '7px 0 0', color: '#586979', lineHeight: 1.55, fontSize: 14 };
const smallCopy: CSSProperties = { margin: '5px 0 0', color: '#657482', lineHeight: 1.45, fontSize: 12 };
const rowWrap: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' };
const twoColumn: CSSProperties = { marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(280px,.9fr) minmax(380px,1.2fr)', gap: 14, alignItems: 'start' };
const infoCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: 'white', display: 'grid', gap: 10 };
const formCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: 'white', display: 'grid', gap: 10 };
const label: CSSProperties = { display: 'grid', gap: 5, color: '#485b6b', fontSize: 11, fontWeight: 900 };
const input: CSSProperties = { minHeight: 42, padding: '0 10px', border: '1px solid #cbd5dd', borderRadius: 8, background: 'white', color: '#172536', fontSize: 13, boxSizing: 'border-box', width: '100%' };
const textarea: CSSProperties = { width: '100%', padding: 10, border: '1px solid #cbd5dd', borderRadius: 8, font: '13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box', resize: 'vertical' };
const notice: CSSProperties = { marginTop: 12, padding: '10px 11px', border: '1px solid #d8c17b', borderRadius: 8, background: '#fffdf2', fontSize: 13 };
const primaryButton: CSSProperties = { border: 0, borderRadius: 7, padding: '9px 12px', background: '#0d1b2b', color: 'white', fontWeight: 900 };
const pauseButton: CSSProperties = { border: '1px solid #d5a559', borderRadius: 7, padding: '9px 12px', background: '#fff7e6', color: '#80520a', fontWeight: 900 };
const dangerButton: CSSProperties = { border: '1px solid #d8a19d', borderRadius: 7, padding: '8px 11px', background: '#fff5f4', color: '#9b2c25', fontWeight: 850 };
const buttonRow: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const savedBox: CSSProperties = { padding: 12, border: '1px solid #cfe0d4', borderRadius: 9, background: '#f5fbf7' };
const codeBox: CSSProperties = { display: 'block', flex: 1, padding: '9px 10px', border: '1px solid #dce3e8', borderRadius: 8, background: '#f7f9fa', fontSize: 11, overflowWrap: 'anywhere' };
const detail: CSSProperties = { display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8, fontSize: 12, alignItems: 'baseline' };
const breakAnywhere: CSSProperties = { overflowWrap: 'anywhere' };
const contactRow: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(150px,1fr) minmax(160px,1fr) auto auto auto', gap: 8, alignItems: 'center', padding: 10, border: '1px solid #e0e6ea', borderRadius: 9, background: '#fbfcfd' };
const switchLabel: CSSProperties = { display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 850, whiteSpace: 'nowrap' };
const templateCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: '#fbfcfd', display: 'grid', gap: 9 };
const empty: CSSProperties = { padding: 16, border: '1px dashed #ccd7df', borderRadius: 9, color: '#687785', background: '#fafcfd' };
