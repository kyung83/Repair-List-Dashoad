'use client';

import { useEffect, useState } from 'react';

type Change = {
  id: number; changed_by: string; previous_total_cost: number; new_total_cost: number;
  reason: string; changed_at: string;
};
type HistoricalRo = {
  roNumber: string; unit: string; date: string; status: string;
  partsCost: number; laborCost: number; outsideCost: number; totalCost: number;
  details: Array<{ id: number; description: string; partsCost: number; laborCost: number; totalCost: number }>;
  history: Change[];
};
const amount = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const frame = { border: '1px solid #dce2e7', borderRadius: 12, padding: 16, background: '#fff' } as const;
const control = { padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', width: '100%', boxSizing: 'border-box' } as const;
const action = { padding: '10px 16px', border: 0, borderRadius: 8, background: '#0d1b2b', color: '#fff', cursor: 'pointer', fontWeight: 800 } as const;

export default function HistoricalRoCostEditor({ canEdit, onSaved }: { canEdit: boolean; onSaved: () => void }) {
  const [search, setSearch] = useState('');
  const [record, setRecord] = useState<HistoricalRo | null>(null);
  const [corrected, setCorrected] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canEdit) return;
    const directRo = new URLSearchParams(window.location.search).get('ro');
    if (directRo && /^WO\d{5,12}$/i.test(directRo.trim())) {
      setSearch(directRo.trim().toUpperCase());
      void lookup(directRo);
    }
  }, [canEdit]);

  if (!canEdit) return null;

  async function lookup(ro = search) {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/reports/history/cost-corrections?ro=' + encodeURIComponent(ro.trim().toUpperCase()), { cache: 'no-store' });
      const payload = await response.json() as HistoricalRo & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Cannot load that RO.');
      setRecord(payload);
      setSearch(payload.roNumber);
      setCorrected(payload.totalCost.toFixed(2));
      setReason('');
      return payload;
    } catch (e) {
      setRecord(null);
      setError(e instanceof Error ? e.message : 'Could not find that RO.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!record) return;
    const total = Number(corrected);
    if (!/^\d+(?:\.\d{1,2})?$/.test(corrected.trim()) || !Number.isFinite(total) || total < 0 || total > 1_000_000) {
      setError('Enter a corrected total with no more than two decimal places.');
      return;
    }
    if (Math.round(total * 100) < Math.round((record.laborCost + record.outsideCost) * 100)) {
      setError('The total cannot be less than existing labor and outside charges.');
      return;
    }
    if (reason.trim().length < 8) { setError('Add a short explanation of the correction.'); return; }
    if (Math.round(total * 100) === Math.round(record.totalCost * 100)) {
      setError('Enter a new amount different from the current total.'); return;
    }
    if (!window.confirm('Confirm correction to ' + record.roNumber + ' (' + record.unit + '): ' + amount(record.totalCost) + ' becomes ' + amount(total) + '. Labor and outside charges will remain unchanged.')) return;

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/reports/history/cost-corrections', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roNumber: record.roNumber,
          expectedTotalCost: record.totalCost.toFixed(2),
          correctedTotalCost: corrected.trim(),
          reason: reason.trim(),
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'The correction could not be saved.');
      const oldTotal = record.totalCost;
      const updated = await lookup(record.roNumber);
      setMessage(updated
        ? record.roNumber + ' was corrected from ' + amount(oldTotal) + ' to ' + amount(total) + '. Reporting totals have been refreshed.'
        : 'The correction was saved. Reload the RO to view the latest audit history.');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The correction could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const parsed = Number(corrected);
  const entered = corrected.trim() !== '' && /^\d+(?:\.\d{1,2})?$/.test(corrected.trim()) && Number.isFinite(parsed);
  const proposedParts = record && entered ? Math.round((parsed - record.laborCost - record.outsideCost) * 100) / 100 : null;

  return (
    <section id="historical-ro-cost-editor" style={{ ...frame, marginTop: 18, borderColor: '#a3b5ca' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 21 }}>Correct a Historical RO Cost</h2>
          <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 13 }}>
            Managers can fix an imported repair order without changing other work. Every correction is recorded.
          </p>
        </div>
        <span style={{ color: '#475569', fontSize: 12 }}>Managers & administrators only</span>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void lookup(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'flex-end' }}>
        <label style={{ minWidth: 180, flex: '1 1 260px', display: 'grid', gap: 5, fontWeight: 700 }}>
          Search by RO number
          <input aria-label="Historical RO number" value={search} onChange={(e) => { setSearch(e.target.value); setRecord(null); setMessage(''); setError(''); }}
            placeholder="Example: WO085385" style={control} autoComplete="off" />
        </label>
        <button type="submit" style={action} disabled={loading || saving || !search.trim()}>{loading ? 'Searching…' : 'Find RO'}</button>
      </form>
      {error && <p role="alert" style={{ padding: 10, border: '1px solid #fecaca', borderRadius: 8, background: '#fff1f2', color: '#9f1239' }}>{error}</p>}
      {message && <p role="status" style={{ padding: 10, border: '1px solid #bbf7d0', borderRadius: 8, background: '#f0fdf4', color: '#166534' }}>{message}</p>}
      {record && (
        <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <strong>{record.roNumber}</strong>
            <span>{record.unit} • {record.date} • {record.status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 10 }}>
            {[
              ['Current parts', record.partsCost], ['Labor (unchanged)', record.laborCost],
              ['Outside (unchanged)', record.outsideCost], ['Current total', record.totalCost],
            ].map(([label, value]) => (
              <div key={String(label)} style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 8 }}>
                <small style={{ color: '#64748b' }}>{label}</small>
                <strong style={{ display: 'block', marginTop: 4 }}>{amount(Number(value))}</strong>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <label style={{ display: 'grid', gap: 5, fontWeight: 700 }}>
              Corrected TOTAL including labor ($)
              <input aria-label="Corrected RO total including labor" type="number" min="0" max="1000000" step="0.01" value={corrected}
                onChange={(e) => setCorrected(e.target.value)} style={control} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontWeight: 700 }}>
              Reason for correction (required)
              <input aria-label="Reason for RO cost correction" value={reason} maxLength={500}
                onChange={(e) => setReason(e.target.value)} placeholder="Example: Corrected parts cost from invoice" style={control} />
            </label>
          </div>
          <div style={{ padding: 12, background: '#f1f5f9', borderRadius: 8, fontSize: 13 }}>
            New parts amount: <strong>{proposedParts == null ? '—' : amount(proposedParts)}</strong>.
            Labor and outside charges are preserved. The new total updates RO History and Fleet Cost Reporting.
          </div>
          <div>
            <button type="button" disabled={saving || loading || !entered || reason.trim().length < 8 || proposedParts == null || proposedParts < 0}
              onClick={() => void save()} style={{ ...action, opacity: saving ? .6 : 1 }}>
              {saving ? 'Saving correction…' : 'Save Corrected RO Cost'}
            </button>
          </div>
          {!!record.details.length && (
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>View existing RO detail lines ({record.details.length})</summary>
              <div style={{ overflowX: 'auto', marginTop: 9 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 550, fontSize: 13 }}>
                  <thead><tr>{['Description','Parts','Labor','Total'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 7, borderBottom: '1px solid #cbd5e1' }}>{h}</th>)}</tr></thead>
                  <tbody>{record.details.map((line) => <tr key={line.id}>
                    <td style={{ padding: 7 }}>{line.description}</td>
                    <td style={{ padding: 7 }}>{amount(line.partsCost)}</td>
                    <td style={{ padding: 7 }}>{amount(line.laborCost)}</td>
                    <td style={{ padding: 7 }}>{amount(line.totalCost)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </details>
          )}
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Correction history ({record.history.length})</summary>
            {record.history.length === 0 ? <p style={{ color: '#64748b' }}>No previous corrections.</p> : (
              <div style={{ overflowX: 'auto', marginTop: 9 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700, fontSize: 13 }}>
                  <thead><tr>{['When','Changed by','Previous total','New total','Reason'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 7, borderBottom: '1px solid #cbd5e1' }}>{h}</th>)}</tr></thead>
                  <tbody>{record.history.map((entry) => <tr key={entry.id}>
                    <td style={{ padding: 7 }}>{entry.changed_at}</td>
                    <td style={{ padding: 7 }}>{entry.changed_by}</td>
                    <td style={{ padding: 7 }}>{amount(entry.previous_total_cost)}</td>
                    <td style={{ padding: 7 }}>{amount(entry.new_total_cost)}</td>
                    <td style={{ padding: 7 }}>{entry.reason}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
