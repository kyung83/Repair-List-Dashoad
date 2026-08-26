'use client';

import { useEffect, useState, useCallback } from 'react';
import type { BreakdownRow } from '@/lib/roadside-breakdowns';

/**
 * ADMIN-ONLY. Breakdowns never appear in the shop-repair views -- they're
 * source='roadside-breakdown' in the repairs table, which the shop/tech
 * queries already exclude (same pattern as source='outside-work'). This is
 * the only place they're visible day to day.
 *
 * Claiming is SMS-first (dispatch is on-call, not always at a screen) --
 * the "Claim" button here is a fallback for whoever happens to be looking
 * at the dashboard, not the primary path.
 */

const STAGE_LABELS: Record<number, string> = {
  1: 'Reported', 2: 'Diagnostics', 3: 'En Route', 4: 'On Location', 5: 'Complete',
};

export default function BreakdownsPage() {
  const [breakdowns, setBreakdowns] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/breakdowns?open=1');
      const data = await res.json<any>();
      if (!res.ok) throw new Error(data.error || 'Failed to load breakdowns.');
      setBreakdowns(data.breakdowns);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function claim(id: number) {
    const res = await fetch(`/api/breakdowns/${id}/claim`, { method: 'POST' });
    if (!res.ok) { const d = await res.json<any>(); alert(d.error); }
    load();
  }

  async function advanceStage(id: number, stage: number) {
    await fetch(`/api/breakdowns/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    load();
  }

  if (loading) return <p>Loading breakdowns...</p>;
  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;

  return (
    <main style={{ padding: 24 }}>
      <h1>Breakdowns</h1>
      <table>
        <thead>
          <tr>
            <th>Truck</th><th>Driver</th><th>Location</th><th>Category</th>
            <th>Stage</th><th>Claimed By</th><th>Cost</th><th></th>
          </tr>
        </thead>
        <tbody>
          {breakdowns.map(b => (
            <tr key={b.id}>
              <td>{b.unit}{b.trailer_unit ? ` / ${b.trailer_unit}` : ''}</td>
              <td>{b.driver_name}</td>
              <td>{b.city}, {b.state}</td>
              <td>{b.repair_category}</td>
              <td>{STAGE_LABELS[b.stage] ?? b.stage}</td>
              <td>{b.claimed_by ?? '\u2014'}</td>
              <td>{b.cost != null ? `$${b.cost.toFixed(2)}` : '\u2014'}</td>
              <td>
                {!b.claimed_by_user_id && <button onClick={() => claim(b.id)}>Claim</button>}
                {b.stage < 5 && <button onClick={() => advanceStage(b.id, b.stage + 1)}>Advance</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
