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

export default function BreakdownsPage() {
  const [breakdowns, setBreakdowns] = useState<BreakdownRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, DispatchDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/breakdowns?open=1', { cache: 'no-store' });
      const payload = await response.json() as { breakdowns?: BreakdownRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to load breakdowns.');
      const rows = Array.isArray(payload.breakdowns) ? payload.breakdowns : [];
      setBreakdowns(rows);
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
        <p className="easy-subtitle">Manage active roadside calls, record who was used, ETA and cost. Email and Twilio notifications are intentionally not enabled yet.</p>

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
                <p className="easy-section-copy">Enter the service or tow company directly on the breakdown they handled.</p>
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

                      <section style={{ marginTop: 16, padding: 14, background: '#f8fafc', border: '1px solid #dfe6ee', borderRadius: 12 }}>
                        <p className="easy-eyebrow" style={{ marginBottom: 10 }}>WHO WE USED</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
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
