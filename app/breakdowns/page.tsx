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

function unitLabel(row: BreakdownRow) {
  const type = String(row.equipment_type || '').toLowerCase() === 'trailer' ? 'Trailer' : 'Truck';
  return `${type} ${row.unit}`;
}

function money(value: number | null) {
  return value == null ? '—' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function BreakdownsPage() {
  const [breakdowns, setBreakdowns] = useState<BreakdownRow[]>([]);
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
      setBreakdowns(Array.isArray(payload.breakdowns) ? payload.breakdowns : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load breakdowns.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
        <p className="easy-subtitle">Driver roadside reports saved in D1. Email and Twilio notifications are intentionally not enabled yet.</p>

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
                <p className="easy-section-copy">Truck and trailer breakdowns use the same single-unit workflow.</p>
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
