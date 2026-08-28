'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BreakdownRow } from '@/lib/roadside-breakdowns';

const STAGE_LABELS: Record<number, string> = {
  1: 'Reported',
  2: 'Diagnostics',
  3: 'En Route',
  4: 'On Location',
  5: 'Complete',
};

type DispatchDraft = {
  serviceProvider: string;
  serviceProviderPhone: string;
  eta: string;
  cost: string;
};

type BreakdownPhoto = {
  breakdownId: number;
  objectKey: string;
  fileName: string;
  contentType: string;
  url: string;
};

type ServiceProvider = {
  id: number;
  name: string;
  phone: string;
  city: string;
  state: string;
  zip: string;
};

function unitLabel(row: BreakdownRow) {
  const type = String(row.equipment_type || '').toLowerCase() === 'trailer' ? 'Trailer' : 'Truck';
  return `${type} ${row.unit}`;
}

function money(value: number | null) {
  return value == null ? '—' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function draftFromRow(row: BreakdownRow): DispatchDraft {
  return {
    serviceProvider: row.service_provider || '',
    serviceProviderPhone: row.service_provider_phone || '',
    eta: row.eta || '',
    cost: row.cost == null ? '' : String(row.cost),
  };
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '9px 11px',
  border: '1px solid #cbd5e1',
  borderRadius: 9,
  background: '#fff',
  color: '#172033',
  fontSize: 14,
  boxSizing: 'border-box',
};

function ProviderPicker({
  row,
  disabled,
  onChoose,
}: {
  row: BreakdownRow;
  disabled: boolean;
  onChoose: (provider: ServiceProvider) => void;
}) {
  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const state = String(row.state || '').trim().toUpperCase();
    const city = String(row.city || '').trim();

    if (!state) {
      setProviders([]);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    setError('');
    const params = new URLSearchParams({ state });
    if (city) params.set('city', city);

    void fetch(`/api/breakdown-service-providers?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { providers?: ServiceProvider[]; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Provider directory could not be loaded.');
        return Array.isArray(payload.providers) ? payload.providers : [];
      })
      .then((rows) => {
        if (!cancelled) setProviders(rows);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Provider directory could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [row.city, row.state]);

  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return providers;
    const digits = q.replace(/\D/g, '');
    return providers.filter((provider) => {
      const text = `${provider.name} ${provider.city} ${provider.state} ${provider.zip} ${provider.phone}`.toLowerCase();
      if (text.includes(q)) return true;
      if (!digits) return false;
      return provider.phone.replace(/\D/g, '').includes(digits);
    });
  }, [providers, search]);

  const state = String(row.state || '').trim().toUpperCase();

  return (
    <div style={{ gridColumn: '1 / -1', padding: 12, border: '1px solid #d5dee8', borderRadius: 10, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
        <strong style={{ color: '#172033', fontSize: 13 }}>{state || 'State'} Provider Directory</strong>
        {!loading && !error && <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>{providers.length} provider{providers.length === 1 ? '' : 's'}</span>}
      </div>

      {error ? (
        <div style={{ color: '#9f1239', fontSize: 12 }}>{error} You can still type the provider manually below.</div>
      ) : loading ? (
        <div style={{ color: '#64748b', fontSize: 12 }}>Loading {state} providers...</div>
      ) : providers.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 12 }}>No providers are on file for {state}. You can still type one manually below.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value.slice(0, 80))}
            placeholder={`Search ${state} by company, city, ZIP or phone`}
            style={inputStyle}
            disabled={disabled}
          />
          <select
            defaultValue=""
            onChange={(event) => {
              const provider = providers.find((item) => item.id === Number(event.target.value));
              if (provider) onChoose(provider);
              event.currentTarget.value = '';
            }}
            style={inputStyle}
            disabled={disabled || filteredProviders.length === 0}
          >
            <option value="">Choose a {state} service provider...</option>
            {filteredProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} — {provider.city}, {provider.state}{provider.zip ? ` ${provider.zip}` : ''}{provider.phone ? ` — ${provider.phone}` : ''}
              </option>
            ))}
          </select>
          <small style={{ color: '#64748b', lineHeight: 1.4 }}>
            Only providers in {state} are shown. Providers in {row.city} are listed first when they are on file.
          </small>
        </div>
      )}
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
    setLoading(true);
    setMessage('');
    try {
      const [breakdownResponse, photoResponse] = await Promise.all([
        fetch('/api/breakdowns?open=1', { cache: 'no-store' }),
        fetch('/api/breakdowns/photos?open=1', { cache: 'no-store' }),
      ]);
      const payload = await breakdownResponse.json() as { breakdowns?: BreakdownRow[]; error?: string };
      const photoPayload = await photoResponse.json() as { photos?: BreakdownPhoto[]; error?: string };
      if (!breakdownResponse.ok) throw new Error(payload.error || 'Failed to load breakdowns.');
      if (!photoResponse.ok) throw new Error(photoPayload.error || 'Failed to load breakdown photos.');

      const rows = Array.isArray(payload.breakdowns) ? payload.breakdowns : [];
      const photos = Array.isArray(photoPayload.photos) ? photoPayload.photos : [];
      const grouped = photos.reduce<Record<number, BreakdownPhoto[]>>((current, photo) => {
        const id = Number(photo.breakdownId);
        if (!Number.isFinite(id)) return current;
        (current[id] ||= []).push(photo);
        return current;
      }, {});

      setBreakdowns(rows);
      setPhotosByBreakdown(grouped);
      setDrafts(Object.fromEntries(rows.map((row) => [row.id, draftFromRow(row)])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load breakdowns.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function setDraftField(id: number, field: keyof DispatchDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] || { serviceProvider: '', serviceProviderPhone: '', eta: '', cost: '' }),
        [field]: value,
      },
    }));
  }

  function chooseProvider(id: number, provider: ServiceProvider) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] || { serviceProvider: '', serviceProviderPhone: '', eta: '', cost: '' }),
        serviceProvider: provider.name,
        serviceProviderPhone: provider.phone,
      },
    }));
  }

  async function saveDispatchDetails(id: number) {
    const draft = drafts[id];
    if (!draft) return;

    const trimmedCost = draft.cost.trim();
    const parsedCost = trimmedCost === '' ? null : Number(trimmedCost);
    if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
      setMessage('Cost must be a valid positive dollar amount.');
      return;
    }

    setBusy(id);
    setMessage('');
    try {
      const response = await fetch(`/api/breakdowns/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceProvider: draft.serviceProvider.trim(),
          serviceProviderPhone: draft.serviceProviderPhone.trim(),
          eta: draft.eta.trim(),
          cost: parsedCost,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Breakdown details could not be saved.');
      await load();
      setMessage(`Breakdown #${id} dispatch details saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown details could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function claim(id: number) {
    setBusy(id);
    setMessage('');
    try {
      const response = await fetch(`/api/breakdowns/${id}/claim`, { method: 'POST' });
      const payload = await response.json() as { ok?: boolean; claimed?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Breakdown could not be claimed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown could not be claimed.');
    } finally {
      setBusy(null);
    }
  }

  async function advanceStage(id: number, stage: number) {
    setBusy(id);
    setMessage('');
    try {
      const response = await fetch(`/api/breakdowns/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Breakdown stage could not be updated.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown stage could not be updated.');
    } finally {
      setBusy(null);
    }
  }

  const summary = useMemo(() => ({
    open: breakdowns.length,
    unclaimed: breakdowns.filter((row) => !row.claimed_by_user_id).length,
    enRoute: breakdowns.filter((row) => row.stage === 3).length,
    onLocation: breakdowns.filter((row) => row.stage === 4).length,
  }), [breakdowns]);

  return (
    <main className="easy-page">
      <div className="easy-page-narrow">
        <p className="easy-eyebrow">ROADSIDE OPERATIONS</p>
        <h1 className="easy-title">Breakdowns</h1>
        <p className="easy-subtitle">Manage active roadside calls, view driver-submitted photos, and record who was used, ETA and cost. Service providers are filtered to the breakdown state automatically.</p>

        {message && <div className="easy-notice">{message}</div>}

        <section className="easy-grid">
          <article className="easy-card easy-metric"><span>Open breakdowns</span><strong>{summary.open}</strong><small>Stage 1–4</small></article>
          <article className="easy-card easy-metric"><span>Unclaimed</span><strong>{summary.unclaimed}</strong><small>Needs an owner</small></article>
          <article className="easy-card easy-metric"><span>En route</span><strong>{summary.enRoute}</strong><small>Provider traveling</small></article>
          <article className="easy-card easy-metric"><span>On location</span><strong>{summary.onLocation}</strong><small>Repair underway</small></article>
        </section>

        <section className="easy-card" style={{ marginTop: 18 }}>
          <div className="easy-card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <h2 className="easy-section-title">Active roadside calls</h2>
                <p className="easy-section-copy">Choose from the provider directory for the breakdown state, or type a provider manually.</p>
              </div>
              <button type="button" className="easy-button" onClick={() => void load()} disabled={loading}>Refresh</button>
            </div>

            {loading ? (
              <div className="easy-empty">Loading breakdowns...</div>
            ) : breakdowns.length === 0 ? (
              <div className="easy-empty">No open roadside breakdowns.</div>
            ) : (
              <div className="easy-list">
                {breakdowns.map((row) => {
                  const isBusy = busy === row.id;
                  const stage = STAGE_LABELS[row.stage] ?? `Stage ${row.stage}`;
                  const type = String(row.equipment_type || '').toLowerCase() === 'trailer' ? 'Trailer' : 'Truck';
                  const draft = drafts[row.id] || draftFromRow(row);
                  const photos = photosByBreakdown[row.id] || [];
                  return (
                    <article key={row.id} className="easy-card" style={{ padding: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0, flex: '1 1 360px' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="easy-badge orange">{type}</span>
                            <span className={`easy-badge ${row.stage >= 4 ? 'green' : row.stage === 1 ? 'red' : ''}`}>{stage}</span>
                            <span className="easy-badge">#{row.id}</span>
                          </div>
                          <h3 style={{ margin: '10px 0 0', color: '#0d1b2b', fontSize: 22 }}>{unitLabel(row)}</h3>
                          <p style={{ margin: '6px 0 0', color: '#334155', fontWeight: 800 }}>{row.driver_name} · {row.city}, {row.state}</p>
                          <p style={{ margin: '7px 0 0', color: '#64748b', lineHeight: 1.45 }}>{row.repair_category}: {row.description}</p>
                        </div>

                        <div style={{ minWidth: 220, flex: '0 1 300px', display: 'grid', gap: 7 }}>
                          <div className="easy-form-row"><strong>Claimed by</strong><span>{row.claimed_by || 'Unclaimed'}</span></div>
                          <div className="easy-form-row"><strong>Service provider</strong><span>{row.service_provider || 'Not set'}</span></div>
                          <div className="easy-form-row"><strong>ETA</strong><span>{row.eta || 'Not set'}</span></div>
                          <div className="easy-form-row"><strong>Cost</strong><span>{money(row.cost)}</span></div>
                        </div>
                      </div>

                      {photos.length > 0 && (
                        <section style={{ marginTop: 14 }}>
                          <p className="easy-eyebrow" style={{ marginBottom: 9 }}>DRIVER PHOTOS</p>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,220px))', gap: 10 }}>
                            {photos.map((photo) => (
                              <a
                                key={photo.objectKey}
                                href={photo.url}
                                target="_blank"
                                rel="noreferrer"
                                title={photo.fileName}
                                style={{ display: 'block', border: '1px solid #d9e1e8', borderRadius: 10, overflow: 'hidden', background: '#f8fafc' }}
                              >
                                <img
                                  src={photo.url}
                                  alt={`Breakdown ${row.id} - ${photo.fileName}`}
                                  loading="lazy"
                                  style={{ display: 'block', width: '100%', height: 150, objectFit: 'cover' }}
                                />
                              </a>
                            ))}
                          </div>
                        </section>
                      )}

                      <section style={{ marginTop: 16, padding: 14, background: '#f8fafc', border: '1px solid #dfe6ee', borderRadius: 12 }}>
                        <p className="easy-eyebrow" style={{ marginBottom: 10 }}>WHO WE USED</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
                          <ProviderPicker row={row} disabled={isBusy} onChoose={(provider) => chooseProvider(row.id, provider)} />

                          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 850, color: '#334155' }}>
                            Service / Tow Company
                            <input
                              value={draft.serviceProvider}
                              onChange={(event) => setDraftField(row.id, 'serviceProvider', event.target.value.slice(0, 160))}
                              placeholder="Company name"
                              style={inputStyle}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 850, color: '#334155' }}>
                            Phone Number
                            <input
                              value={draft.serviceProviderPhone}
                              onChange={(event) => setDraftField(row.id, 'serviceProviderPhone', event.target.value.slice(0, 40))}
                              placeholder="Phone"
                              inputMode="tel"
                              style={inputStyle}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 850, color: '#334155' }}>
                            ETA
                            <input
                              value={draft.eta}
                              onChange={(event) => setDraftField(row.id, 'eta', event.target.value.slice(0, 80))}
                              placeholder="Example: 45 min"
                              style={inputStyle}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 850, color: '#334155' }}>
                            Cost
                            <input
                              value={draft.cost}
                              onChange={(event) => setDraftField(row.id, 'cost', event.target.value.replace(/[^0-9.]/g, '').slice(0, 12))}
                              placeholder="0.00"
                              inputMode="decimal"
                              style={inputStyle}
                            />
                          </label>
                        </div>
                        <div className="easy-actions" style={{ marginTop: 10 }}>
                          <button type="button" className="easy-button orange" disabled={isBusy} onClick={() => void saveDispatchDetails(row.id)}>
                            {isBusy ? 'Saving...' : 'Save Who We Used'}
                          </button>
                        </div>
                      </section>

                      <div className="easy-actions" style={{ marginTop: 14 }}>
                        {!row.claimed_by_user_id && (
                          <button type="button" className="easy-button orange" disabled={isBusy} onClick={() => void claim(row.id)}>
                            {isBusy ? 'Working...' : 'Claim'}
                          </button>
                        )}
                        {row.stage < 5 && (
                          <button type="button" className="easy-button primary" disabled={isBusy} onClick={() => void advanceStage(row.id, row.stage + 1)}>
                            {isBusy ? 'Working...' : `Advance to ${STAGE_LABELS[row.stage + 1] ?? `Stage ${row.stage + 1}`}`}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
