'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BreakdownRow } from '@/lib/roadside-breakdowns';
import DriverReceiptReview from './driver-receipt-review';

const STAGE_LABELS: Record<number, string> = {
  1: 'Reported',
  2: 'Diagnostics',
  3: 'En Route',
  4: 'On Location',
  5: 'Complete',
};

type DispatchDraft = { serviceProvider: string; serviceProviderPhone: string; eta: string; cost: string };
type BreakdownPhoto = { breakdownId: number; objectKey: string; fileName: string; contentType: string; url: string };
type ServiceProvider = { id: number; name: string; phone: string; city: string; state: string; zip: string };
type NewProviderDraft = { name: string; phone: string; city: string; state: string; zip: string };

function unitLabel(row: BreakdownRow) {
  const type = String(row.equipment_type || '').toLowerCase() === 'trailer' ? 'Trailer' : 'Truck';
  return `${type} ${row.unit}`;
}
function money(value: number | null) { return value == null ? '—' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
function draftFromRow(row: BreakdownRow): DispatchDraft {
  return { serviceProvider: row.service_provider || '', serviceProviderPhone: row.service_provider_phone || '', eta: row.eta || '', cost: row.cost == null ? '' : String(row.cost) };
}

const inputStyle: React.CSSProperties = { width: '100%', minHeight: 44, padding: '9px 11px', border: '1px solid #cbd5e1', borderRadius: 9, background: '#fff', color: '#172033', fontSize: 14, boxSizing: 'border-box' };
const labelStyle: React.CSSProperties = { display: 'grid', gap: 5, fontSize: 12, fontWeight: 850, color: '#334155' };

function ProviderPicker({ row, disabled, selectedName, selectedPhone, onChoose, onClear }: {
  row: BreakdownRow; disabled: boolean; selectedName: string; selectedPhone: string;
  onChoose: (provider: ServiceProvider) => void; onClear: () => void;
}) {
  const state = String(row.state || '').trim().toUpperCase();
  const city = String(row.city || '').trim();
  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [newProvider, setNewProvider] = useState<NewProviderDraft>({ name: '', phone: '', city, state, zip: '' });

  const loadProviders = useCallback(async () => {
    if (!state) { setProviders([]); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ state });
      if (city) params.set('city', city);
      const response = await fetch(`/api/breakdown-service-providers?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as { providers?: ServiceProvider[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Provider directory could not be loaded.');
      setProviders(Array.isArray(payload.providers) ? payload.providers : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Provider directory could not be loaded.'); }
    finally { setLoading(false); }
  }, [city, state]);

  useEffect(() => { setNewProvider((current) => ({ ...current, city, state })); void loadProviders(); }, [city, state, loadProviders]);

  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return providers;
    const digits = q.replace(/\D/g, '');
    return providers.filter((provider) => {
      const text = `${provider.name} ${provider.city} ${provider.state} ${provider.zip} ${provider.phone}`.toLowerCase();
      return text.includes(q) || Boolean(digits && provider.phone.replace(/\D/g, '').includes(digits));
    });
  }, [providers, search]);

  function setNewProviderField(field: keyof NewProviderDraft, value: string) { setNewProvider((current) => ({ ...current, [field]: value })); }
  async function addProvider() {
    setAddBusy(true); setAddError('');
    try {
      const response = await fetch('/api/breakdown-service-providers', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newProvider.name.trim(), phone: newProvider.phone.trim(), city: newProvider.city.trim(), state: newProvider.state.trim().toUpperCase(), zip: newProvider.zip.trim() }),
      });
      const payload = await response.json() as { provider?: ServiceProvider; error?: string };
      if (!response.ok || !payload.provider) throw new Error(payload.error || 'Provider could not be saved.');
      if (payload.provider.state === state) onChoose(payload.provider);
      setShowAdd(false); setSearch(''); setNewProvider({ name: '', phone: '', city, state, zip: '' });
      await loadProviders();
    } catch (reason) { setAddError(reason instanceof Error ? reason.message : 'Provider could not be saved.'); }
    finally { setAddBusy(false); }
  }

  return (
    <div style={{ gridColumn: '1 / -1', padding: 12, border: '1px solid #d5dee8', borderRadius: 10, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div><strong style={{ color: '#172033', fontSize: 14 }}>Service Provider</strong><div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Showing {state || 'state'} providers only. {city ? `${city} locations are listed first.` : ''}</div></div>
        <button type="button" className="easy-button" disabled={disabled} onClick={() => { setShowAdd((current) => !current); setAddError(''); }}>{showAdd ? 'Cancel Add' : '+ Add Service Provider'}</button>
      </div>

      {selectedName && (
        <div style={{ marginBottom: 10, padding: '9px 11px', borderRadius: 9, background: '#f8fafc', border: '1px solid #dfe6ee', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><strong style={{ color: '#172033' }}>{selectedName}</strong><div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{selectedPhone || 'No phone on file'}</div></div>
          <button type="button" className="easy-button" disabled={disabled} onClick={onClear}>Clear Selection</button>
        </div>
      )}

      {showAdd ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
            <label style={labelStyle}>Company Name<input value={newProvider.name} onChange={(e) => setNewProviderField('name', e.target.value.slice(0, 160))} style={inputStyle} placeholder="Company name" /></label>
            <label style={labelStyle}>Phone Number<input value={newProvider.phone} onChange={(e) => setNewProviderField('phone', e.target.value.slice(0, 40))} style={inputStyle} placeholder="Phone" inputMode="tel" /></label>
            <label style={labelStyle}>City<input value={newProvider.city} onChange={(e) => setNewProviderField('city', e.target.value.slice(0, 120))} style={inputStyle} placeholder="City" /></label>
            <label style={labelStyle}>State<input value={newProvider.state} onChange={(e) => setNewProviderField('state', e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2))} style={inputStyle} placeholder="IN" maxLength={2} /></label>
            <label style={labelStyle}>ZIP<input value={newProvider.zip} onChange={(e) => setNewProviderField('zip', e.target.value.slice(0, 20))} style={inputStyle} placeholder="ZIP" inputMode="numeric" /></label>
          </div>
          {addError && <div style={{ color: '#9f1239', fontSize: 12 }}>{addError}</div>}
          <div className="easy-actions"><button type="button" className="easy-button orange" disabled={disabled || addBusy} onClick={() => void addProvider()}>{addBusy ? 'Saving Provider...' : 'Save Provider'}</button></div>
        </div>
      ) : error ? <div style={{ color: '#9f1239', fontSize: 12 }}>{error}</div>
        : loading ? <div style={{ color: '#64748b', fontSize: 12 }}>Loading {state} providers...</div>
        : <div style={{ display: 'grid', gap: 8 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value.slice(0, 80))} placeholder={`Search ${state} by company, city, ZIP or phone`} style={inputStyle} disabled={disabled} />
            <select defaultValue="" onChange={(e) => { const provider = providers.find((item) => item.id === Number(e.target.value)); if (provider) onChoose(provider); e.currentTarget.value = ''; }} style={inputStyle} disabled={disabled || filteredProviders.length === 0}>
              <option value="">{filteredProviders.length ? `Choose a ${state} service provider...` : `No matching ${state} providers`}</option>
              {filteredProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.city}, {provider.state}{provider.zip ? ` ${provider.zip}` : ''}{provider.phone ? ` — ${provider.phone}` : ''}</option>)}
            </select>
            <small style={{ color: '#64748b', lineHeight: 1.4 }}>{providers.length} provider{providers.length === 1 ? '' : 's'} on file for {state}. If the company is missing, use Add Service Provider above.</small>
          </div>}
    </div>
  );
}

export default function BreakdownsPage() {
  const [breakdowns, setBreakdowns] = useState<BreakdownRow[]>([]);
  const [photosByBreakdown, setPhotosByBreakdown] = useState<Record<number, BreakdownPhoto[]>>({});
  const [drafts, setDrafts] = useState<Record<number, DispatchDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setMessage('');
    try {
      const [breakdownResponse, photoResponse] = await Promise.all([fetch('/api/breakdowns?open=1', { cache: 'no-store' }), fetch('/api/breakdowns/photos?open=1', { cache: 'no-store' })]);
      const payload = await breakdownResponse.json() as { breakdowns?: BreakdownRow[]; error?: string };
      const photoPayload = await photoResponse.json() as { photos?: BreakdownPhoto[]; error?: string };
      if (!breakdownResponse.ok) throw new Error(payload.error || 'Failed to load breakdowns.');
      if (!photoResponse.ok) throw new Error(photoPayload.error || 'Failed to load breakdown photos.');
      const rows = Array.isArray(payload.breakdowns) ? payload.breakdowns : [];
      const photos = Array.isArray(photoPayload.photos) ? photoPayload.photos : [];
      const grouped = photos.reduce<Record<number, BreakdownPhoto[]>>((current, photo) => { const id = Number(photo.breakdownId); if (Number.isFinite(id)) (current[id] ||= []).push(photo); return current; }, {});
      setBreakdowns(rows); setPhotosByBreakdown(grouped); setDrafts(Object.fromEntries(rows.map((row) => [row.id, draftFromRow(row)])));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Failed to load breakdowns.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  function setDraftField(id: number, field: keyof DispatchDraft, value: string) { setDrafts((current) => ({ ...current, [id]: { ...(current[id] || { serviceProvider: '', serviceProviderPhone: '', eta: '', cost: '' }), [field]: value } })); }
  function chooseProvider(id: number, provider: ServiceProvider) { setDrafts((current) => ({ ...current, [id]: { ...(current[id] || { serviceProvider: '', serviceProviderPhone: '', eta: '', cost: '' }), serviceProvider: provider.name, serviceProviderPhone: provider.phone } })); }
  function clearProvider(id: number) { setDrafts((current) => ({ ...current, [id]: { ...(current[id] || { serviceProvider: '', serviceProviderPhone: '', eta: '', cost: '' }), serviceProvider: '', serviceProviderPhone: '' } })); }

  async function saveDispatchDetails(id: number) {
    const draft = drafts[id]; if (!draft) return;
    const trimmedCost = draft.cost.trim(); const parsedCost = trimmedCost === '' ? null : Number(trimmedCost);
    if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) { setMessage('Cost must be a valid positive dollar amount.'); return; }
    setBusy(id); setMessage('');
    try {
      const response = await fetch(`/api/breakdowns/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceProvider: draft.serviceProvider.trim(), serviceProviderPhone: draft.serviceProviderPhone.trim(), eta: draft.eta.trim(), cost: parsedCost }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Breakdown details could not be saved.');
      await load(); setMessage(`Breakdown #${id} provider details saved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Breakdown details could not be saved.'); }
    finally { setBusy(null); }
  }

  async function claim(id: number) {
    setBusy(id); setMessage('');
    try { const response = await fetch(`/api/breakdowns/${id}/claim`, { method: 'POST' }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || 'Breakdown could not be claimed.'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Breakdown could not be claimed.'); }
    finally { setBusy(null); }
  }

  async function advanceStage(id: number, stage: number) {
    setBusy(id); setMessage('');
    try { const response = await fetch(`/api/breakdowns/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage }) }); const payload = await response.json() as { ok?: boolean; error?: string }; if (!response.ok || !payload.ok) throw new Error(payload.error || 'Breakdown stage could not be updated.'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Breakdown stage could not be updated.'); }
    finally { setBusy(null); }
  }

  async function clearNotBreakdown(row: BreakdownRow) {
    if (!window.confirm(`Clear ${unitLabel(row)} for ${row.driver_name} as NOT A BREAKDOWN?\n\nThis removes it from active breakdowns and closes the linked repair as Cancelled. The history is kept.`)) return;
    setBusy(row.id); setMessage('');
    try { const response = await fetch(`/api/breakdowns/${row.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notBreakdown: true }) }); const payload = await response.json() as { ok?: boolean; error?: string }; if (!response.ok || !payload.ok) throw new Error(payload.error || 'Breakdown could not be cleared.'); await load(); setMessage(`Breakdown #${row.id} cleared as not a breakdown.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Breakdown could not be cleared.'); }
    finally { setBusy(null); }
  }

  const summary = useMemo(() => ({ open: breakdowns.length, unclaimed: breakdowns.filter((row) => !row.claimed_by_user_id).length, enRoute: breakdowns.filter((row) => row.stage === 3).length, onLocation: breakdowns.filter((row) => row.stage === 4).length }), [breakdowns]);

  return (
    <main className="easy-page">
      <div className="easy-page-narrow">
        <p className="easy-eyebrow">ROADSIDE OPERATIONS</p><h1 className="easy-title">Breakdowns</h1>
        <p className="easy-subtitle">Manage active roadside calls, provider/ETA, driver progress, and receipt review. A driver marking Rolling leaves the call open for office confirmation.</p>
        {message && <div className="easy-notice">{message}</div>}
        <section className="easy-grid">
          <article className="easy-card easy-metric"><span>Open breakdowns</span><strong>{summary.open}</strong><small>Stage 1–4</small></article>
          <article className="easy-card easy-metric"><span>Unclaimed</span><strong>{summary.unclaimed}</strong><small>Needs an owner</small></article>
          <article className="easy-card easy-metric"><span>En route</span><strong>{summary.enRoute}</strong><small>Provider traveling</small></article>
          <article className="easy-card easy-metric"><span>On location</span><strong>{summary.onLocation}</strong><small>Repair / review</small></article>
        </section>

        <section className="easy-card" style={{ marginTop: 18 }}><div className="easy-card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><div><h2 className="easy-section-title">Active roadside calls</h2><p className="easy-section-copy">Each call shows only providers from that breakdown state.</p></div><button type="button" className="easy-button" onClick={() => void load()} disabled={loading}>Refresh</button></div>
          {loading ? <div className="easy-empty">Loading breakdowns...</div> : breakdowns.length === 0 ? <div className="easy-empty">No open roadside breakdowns.</div> : (
            <div className="easy-list">{breakdowns.map((row) => {
              const isBusy = busy === row.id; const stage = STAGE_LABELS[row.stage] ?? `Stage ${row.stage}`; const type = String(row.equipment_type || '').toLowerCase() === 'trailer' ? 'Trailer' : 'Truck'; const draft = drafts[row.id] || draftFromRow(row); const photos = photosByBreakdown[row.id] || [];
              return <article key={row.id} className="easy-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 360px' }}><div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="easy-badge orange">{type}</span><span className={`easy-badge ${row.stage >= 4 ? 'green' : row.stage === 1 ? 'red' : ''}`}>{stage}</span><span className="easy-badge">#{row.id}</span></div><h3 style={{ margin: '10px 0 0', color: '#0d1b2b', fontSize: 22 }}>{unitLabel(row)}</h3><p style={{ margin: '6px 0 0', color: '#334155', fontWeight: 800 }}>{row.driver_name} · {row.city}, {row.state}</p><p style={{ margin: '7px 0 0', color: '#64748b', lineHeight: 1.45 }}>{row.repair_category}: {row.description}</p></div>
                  <div style={{ minWidth: 220, flex: '0 1 300px', display: 'grid', gap: 7 }}><div className="easy-form-row"><strong>Claimed by</strong><span>{row.claimed_by || 'Unclaimed'}</span></div><div className="easy-form-row"><strong>Service provider</strong><span>{row.service_provider || 'Not set'}</span></div><div className="easy-form-row"><strong>ETA</strong><span>{row.eta || 'Not set'}</span></div><div className="easy-form-row"><strong>Cost</strong><span>{money(row.cost)}</span></div></div>
                </div>
                {photos.length > 0 && <section style={{ marginTop: 14 }}><p className="easy-eyebrow" style={{ marginBottom: 9 }}>DRIVER PHOTOS</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,220px))', gap: 10 }}>{photos.map((photo) => <a key={photo.objectKey} href={photo.url} target="_blank" rel="noreferrer" title={photo.fileName} style={{ display: 'block', border: '1px solid #d9e1e8', borderRadius: 10, overflow: 'hidden', background: '#f8fafc' }}><img src={photo.url} alt={`Breakdown ${row.id} - ${photo.fileName}`} loading="lazy" style={{ display: 'block', width: '100%', height: 150, objectFit: 'cover' }} /></a>)}</div></section>}

                <DriverReceiptReview breakdownId={row.id} onClosed={() => void load()} />

                <section style={{ marginTop: 16, padding: 14, background: '#f8fafc', border: '1px solid #dfe6ee', borderRadius: 12 }}><p className="easy-eyebrow" style={{ marginBottom: 10 }}>WHO WE USED</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
                  <ProviderPicker row={row} disabled={isBusy} selectedName={draft.serviceProvider} selectedPhone={draft.serviceProviderPhone} onChoose={(provider) => chooseProvider(row.id, provider)} onClear={() => clearProvider(row.id)} />
                  <label style={labelStyle}>ETA<input value={draft.eta} onChange={(e) => setDraftField(row.id, 'eta', e.target.value.slice(0, 80))} placeholder="Example: 45 min" style={inputStyle} /></label>
                  <label style={labelStyle}>Cost<input value={draft.cost} onChange={(e) => setDraftField(row.id, 'cost', e.target.value.replace(/[^0-9.]/g, '').slice(0, 12))} placeholder="0.00" inputMode="decimal" style={inputStyle} /></label>
                </div><div className="easy-actions" style={{ marginTop: 10 }}><button type="button" className="easy-button orange" disabled={isBusy} onClick={() => void saveDispatchDetails(row.id)}>{isBusy ? 'Saving...' : 'Save Provider / ETA'}</button></div></section>

                <div className="easy-actions" style={{ marginTop: 14 }}>
                  {!row.claimed_by_user_id && <button type="button" className="easy-button orange" disabled={isBusy} onClick={() => void claim(row.id)}>{isBusy ? 'Working...' : 'Claim'}</button>}
                  {row.stage >= 2 && row.stage < 4 && <button type="button" className="easy-button primary" disabled={isBusy} onClick={() => void advanceStage(row.id, row.stage + 1)}>{isBusy ? 'Working...' : `Advance to ${STAGE_LABELS[row.stage + 1] ?? `Stage ${row.stage + 1}`}`}</button>}
                  {row.stage < 5 && <button type="button" className="easy-button" disabled={isBusy} onClick={() => void clearNotBreakdown(row)} style={{ borderColor: '#b91c1c', color: '#991b1b', background: '#fff' }}>Clear — Not a Breakdown</button>}
                </div>
              </article>;
            })}</div>
          )}
        </div></section>
      </div>
    </main>
  );
}