'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';

type Vendor = { id: number; name: string; phone: string; city: string; state: string; zip: string; active: boolean; hasHistory: boolean; canDelete: boolean; version: string };
type Directory = { vendors: Vendor[]; total: number; page: number; pages: number; pageSize: number; states: string[]; counts: { total: number; active: number; archived: number } };
type Filters = { q: string; state: string; status: string };
type Editor = { id?: number; version?: string; name: string; phone: string; city: string; state: string; zip: string; active?: boolean };
const emptyFilters: Filters = { q: '', state: '', status: 'all' };
const emptyEditor: Editor = { name: '', phone: '', city: '', state: '', zip: '' };
const api = '/api/breakdown-vendors';

async function readJson(response: Response) {
  let result;
  try { result = await response.json(); } catch { throw new Error('The server did not return a readable response. Refresh and try again.'); }
  if (!response.ok) throw new Error(result.error || 'The vendor request failed.');
  return result;
}
export default function BreakdownVendorsPage() {
  const [data, setData] = useState<Directory | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestSequence = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const editorPanel = useRef<HTMLElement>(null);
  const load = useCallback(async (next: Filters, page = 1) => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ ...next, page: String(page), pageSize: '100' });
      const result = await readJson(await fetch(`${api}?${params}`, { cache: 'no-store' }));
      if (!Array.isArray(result.vendors)) throw new Error('The vendor list is incomplete. Refresh and try again.');
      if (sequence !== requestSequence.current) return;
      setData(result); setApplied(next);
    } catch (reason) {
      if (sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : 'The vendor directory could not be loaded.');
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(emptyFilters); return () => { requestSequence.current += 1; }; }, [load]);
  const editorOpen = editor !== null, editingId = editor?.id;
  useEffect(() => {
    if (!editorOpen) return;
    editorPanel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    nameInput.current?.focus();
  }, [editorOpen, editingId]);

  const locked = loading || Boolean(busy);
  function openEditor(row?: Vendor) {
    if (locked || (editor && !window.confirm('Discard this unsaved vendor form?'))) return;
    setEditor(row ? { id: row.id, version: row.version, name: row.name, phone: row.phone, city: row.city, state: row.state, zip: row.zip, active: row.active } : { ...emptyEditor });
    setError(''); setMessage('');
  }
  function closeEditor() {
    if (busy || !window.confirm('Close this form without saving?')) return;
    setEditor(null); setError('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || locked) return;
    const draft = { ...editor };
    setBusy('save'); setError(''); setMessage('');
    try {
      const result = await readJson(await fetch(api, {
        method: draft.id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, action: 'edit', expectedVersion: draft.version }),
      }));
      const vendor: Vendor = result.vendor;
      if (!vendor?.id) throw new Error('The vendor save could not be confirmed. Refresh before submitting again.');
      setEditor(null);
      const next = { q: vendor.name, state: vendor.state, status: 'all' };
      setFilters(next);
      setMessage(`${draft.id ? 'Saved' : 'Added'} ${vendor.name}. The directory is filtered to show it. ${vendor.active ? 'It is available in the next breakdown provider search for ' + vendor.state + '.' : 'It remains archived until restored.'} Past breakdowns were not changed.`);
      await load(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Vendor could not be saved.'); }
    finally { setBusy(''); }
  }
  async function change(row: Vendor, action: 'archive' | 'restore' | 'delete') {
    if (locked || editor) return;
    const detail = action === 'delete' ? 'Permanently delete this archived vendor? This cannot be undone. Breakdown history is checked again before deletion.'
      : action === 'archive' ? 'Archive this vendor so it no longer appears in new provider searches? Existing breakdowns stay unchanged.'
      : 'Restore this vendor to active breakdown provider searches?';
    if (!window.confirm(`${row.name} - ${row.city}, ${row.state}\n\n${detail}`)) return;
    setBusy(`${action}-${row.id}`); setError(''); setMessage('');
    try {
      await readJson(await fetch(api, { method: action === 'delete' ? 'DELETE' : 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, expectedVersion: row.version, action, confirmDelete: action === 'delete' }) }));
      setMessage(`${row.name} ${action === 'delete' ? 'deleted from the directory' : action === 'archive' ? 'archived' : 'restored'}. Existing breakdowns and costs were not changed.`);
      await load(applied, data?.page || 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Vendor could not be changed.'); }
    finally { setBusy(''); }
  }

  return <main className="easy-page"><div style={{ maxWidth: 1380, margin: '0 auto' }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <div><p className="easy-eyebrow">SETUP / BREAKDOWN &amp; OPERATIONS</p><h1 className="easy-title">Breakdown Vendors</h1><p className="easy-subtitle">Manage the roadside provider directory without opening a breakdown.</p></div>
      <div style={actions}><a className="easy-button" href="/setup-center">Back to Setup Home</a>{data && <button className="easy-button orange" disabled={locked} onClick={() => openEditor()}>+ Add Breakdown Vendor</button>}</div>
    </header>
    {message && <div className="easy-notice" role="status" style={{ marginTop: 16 }}>{message}</div>}
    {error && <div role="alert" style={{ marginTop: 16, border: '1px solid #d88b78', padding: 12, borderRadius: 8, background: '#fff3f0' }}>{error} <button className="easy-button" disabled={locked} onClick={() => void load(applied, data?.page || 1)}>Refresh directory</button></div>}
    {!data && loading && <p role="status">Loading breakdown vendors...</p>}
    {data && <>
      <section className="easy-card" style={{ marginTop: 18 }}><div className="easy-card-body">
        <div style={{ ...actions, justifyContent: 'space-between', marginBottom: 12 }}><strong>{data.counts.total} vendors in directory</strong><span>{data.counts.active} active / {data.counts.archived} archived</span></div>
        <form onSubmit={(event) => { event.preventDefault(); void load(filters); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ ...label, flex: '2 1 260px' }}>Search vendors<input style={input} value={filters.q} maxLength={160} placeholder="Company, phone, city, state, ZIP..." onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></label>
          <label style={{ ...label, flex: '1 1 170px' }}>State / province<select style={input} value={filters.state} onChange={(event) => setFilters({ ...filters, state: event.target.value })}><option value="">All states / provinces</option>{data.states.map((state) => <option key={state}>{state}</option>)}</select></label>
          <label style={{ ...label, flex: '1 1 170px' }}>Status<select style={input} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="all">All vendors</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
          <button className="easy-button orange" disabled={locked}>Search</button><button type="button" className="easy-button" disabled={locked} onClick={() => { setFilters(emptyFilters); void load(emptyFilters); }}>Reset</button>
        </form>
      </div></section>
      {editor && <section ref={editorPanel} className="easy-card" aria-labelledby="vendor-editor-title" style={{ marginTop: 16, borderColor: '#f47b20' }}><div className="easy-card-body">
        <h2 id="vendor-editor-title" style={{ marginTop: 0 }}>{editor.id ? 'Edit Breakdown Vendor' : 'Add Breakdown Vendor'}</h2>
        <p style={copy}>Company name, city, and state/province are required. Phone and ZIP/postal code are optional. Each branch/location is a separate directory entry.</p>
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={Boolean(busy)} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            <label style={label}>Company name *<input ref={nameInput} required style={input} maxLength={160} value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
            <label style={label}>Phone<input type="tel" style={input} maxLength={40} value={editor.phone} onChange={(e) => setEditor({ ...editor, phone: e.target.value })} /></label>
            <label style={label}>City *<input required style={input} maxLength={120} value={editor.city} onChange={(e) => setEditor({ ...editor, city: e.target.value })} /></label>
            <label style={label}>State / province *<input required pattern="[A-Za-z]{2}" title="Two-letter state or province, for example MI or ON" style={input} maxLength={2} value={editor.state} onChange={(e) => setEditor({ ...editor, state: e.target.value.toUpperCase() })} /></label>
            <label style={label}>ZIP / postal code<input style={input} maxLength={20} value={editor.zip} onChange={(e) => setEditor({ ...editor, zip: e.target.value })} /></label>
          </fieldset>
          {editor.active === false && <p style={copy}>This vendor is archived. Saving edits will not restore it automatically.</p>}
          <div style={{ ...actions, marginTop: 14 }}><button className="easy-button orange" disabled={locked}>{busy === 'save' ? 'Saving...' : editor.id ? 'Save Changes' : 'Add Vendor'}</button><button type="button" className="easy-button" disabled={Boolean(busy)} onClick={closeEditor}>Cancel</button></div>
        </form>
      </div></section>}
      <section className="easy-card" style={{ marginTop: 16 }}><div className="easy-card-body">
        <h2 style={{ marginTop: 0 }}>Vendor Directory</h2>
        <p style={copy}>Archive removes a vendor from future searches; Restore makes it available again. Delete is available only after archiving and only when no matching breakdown history is found. History checks use current and previously saved names/phone numbers, so shared names or numbers can protect more than one location. No past breakdown, invoice, or cost is rewritten.</p>
        <p role="status" style={copy}>{loading ? 'Refreshing...' : `Showing ${data.total ? (data.page - 1) * data.pageSize + 1 : 0}-${Math.min(data.page * data.pageSize, data.total)} of ${data.total} matches`} | {applied.state || 'All states / provinces'} | {applied.status}{applied.q ? ` | Search: ${applied.q}` : ''}</p>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}><thead><tr>{['Company', 'Phone', 'City', 'State', 'ZIP / Postal', 'Status', 'History protection', 'Actions'].map((text) => <th key={text} style={th}>{text}</th>)}</tr></thead><tbody>
          {data.vendors.map((row) => <tr key={row.id}>
            <td style={{ ...td, fontWeight: 800 }}>{row.name}</td><td style={td}>{row.phone || 'Not recorded'}</td><td style={td}>{row.city}</td><td style={td}>{row.state}</td><td style={td}>{row.zip || '-'}</td><td style={td}>{row.active ? 'Active' : 'Archived'}</td><td style={td}>{row.hasHistory ? 'Matching history - keep archived' : 'No name / phone match'}</td>
            <td style={td}><div style={actions}><button className="easy-button" disabled={locked} onClick={() => openEditor(row)}>Edit</button><button className="easy-button" disabled={locked || editorOpen} onClick={() => void change(row, row.active ? 'archive' : 'restore')}>{row.active ? 'Archive' : 'Restore'}</button>{!row.active && <button className="easy-button" style={{ color: '#a52222' }} disabled={locked || editorOpen || !row.canDelete} title={row.hasHistory ? 'Matching breakdown history protects this vendor. Keep it archived instead.' : 'Permanently delete this unused archived entry'} onClick={() => void change(row, 'delete')}>Delete</button>}</div></td>
          </tr>)}
          {!data.vendors.length && <tr><td colSpan={8} style={td}>No vendors match these filters. Reset to see the full directory, or add a new vendor above.</td></tr>}
        </tbody></table></div>
        <div style={{ ...actions, justifyContent: 'space-between', marginTop: 14 }}><button className="easy-button" disabled={locked || data.page <= 1} onClick={() => void load(applied, data.page - 1)}>Previous</button><span>Page {data.page} of {data.pages}</span><button className="easy-button" disabled={locked || data.page >= data.pages} onClick={() => void load(applied, data.page + 1)}>Next</button></div>
      </div></section>
    </>}
  </div></main>;
}
const actions: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', minHeight: 42, padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: 'white', color: '#172033', fontSize: 14 };
const label: CSSProperties = { display: 'grid', gap: 5, fontSize: 12, fontWeight: 800 };
const copy: CSSProperties = { fontSize: 13, lineHeight: 1.5, color: '#64748b' };
const th: CSSProperties = { textAlign: 'left', padding: 10, fontSize: 12, borderBottom: '1px solid #cbd5e1' };
const td: CSSProperties = { padding: 10, fontSize: 13, verticalAlign: 'top', borderBottom: '1px solid #e2e8f0' };
