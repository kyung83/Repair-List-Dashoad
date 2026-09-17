'use client';

import { useState } from 'react';

type EditRecord = {
  breakdownId: number;
  unit: string;
  finalTotalCost: number;
  serviceProvider: string;
  invoiceNumber: string;
  invoiceDate: string;
  closeoutNotes: string;
};

type Draft = {
  totalAmount: string;
  serviceProvider: string;
  invoiceNumber: string;
  invoiceDate: string;
  closeoutNotes: string;
};

const input: React.CSSProperties = {
  width: '100%',
  minHeight: 42,
  padding: '9px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  background: '#fff',
  color: '#172033',
  boxSizing: 'border-box',
  fontSize: 14,
};
const label: React.CSSProperties = {
  display: 'grid',
  gap: 5,
  fontSize: 11,
  fontWeight: 850,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: '.03em',
};
const button: React.CSSProperties = {
  minHeight: 34,
  padding: '0 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 7,
  background: '#fff',
  color: '#263b4e',
  fontWeight: 850,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export default function EditBreakdownButton({
  breakdownId,
  unit,
  onSaved,
}: {
  breakdownId: number;
  unit: string;
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<Draft>({ totalAmount: '', serviceProvider: '', invoiceNumber: '', invoiceDate: '', closeoutNotes: '' });

  async function openEditor() {
    setOpen(true);
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`/api/reports/breakdowns/${breakdownId}`, { cache: 'no-store' });
      const payload = await response.json() as { record?: EditRecord; error?: string };
      if (!response.ok || !payload.record) throw new Error(payload.error || 'Breakdown could not be loaded.');
      setDraft({
        totalAmount: Number(payload.record.finalTotalCost || 0).toFixed(2),
        serviceProvider: payload.record.serviceProvider || '',
        invoiceNumber: payload.record.invoiceNumber || '',
        invoiceDate: payload.record.invoiceDate || '',
        closeoutNotes: payload.record.closeoutNotes || '',
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  function setField(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    const cost = Number(draft.totalAmount);
    if (draft.totalAmount.trim() === '' || !Number.isFinite(cost) || cost < 0) {
      setMessage('Enter a valid final total cost.');
      return;
    }
    if (draft.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.invoiceDate)) {
      setMessage('Invoice date is invalid.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`/api/reports/breakdowns/${breakdownId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          totalAmount: draft.totalAmount,
          serviceProvider: draft.serviceProvider,
          invoiceNumber: draft.invoiceNumber,
          invoiceDate: draft.invoiceDate,
          closeoutNotes: draft.closeoutNotes,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Breakdown correction could not be saved.');
      await onSaved();
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown correction could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button type="button" style={button} onClick={() => void openEditor()}>Edit Breakdown</button>
    {open && <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.48)', display: 'grid', placeItems: 'center', padding: 18 }} onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label={`Edit breakdown ${breakdownId}`} style={{ width: 'min(720px,100%)', maxHeight: '92vh', overflowY: 'auto', background: '#fff', borderRadius: 14, boxShadow: '0 24px 70px rgba(15,23,42,.28)', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 900, letterSpacing: '.08em', color: '#b45309' }}>COMPLETED BREAKDOWN CORRECTION</p>
            <h2 style={{ margin: '5px 0 0', fontSize: 24 }}>Breakdown #{breakdownId} · Unit {unit}</h2>
            <p style={{ margin: '7px 0 0', color: '#64748b', fontSize: 13 }}>Correct the final outside invoice information without reopening the breakdown. Parts and labor stay unchanged.</p>
          </div>
          <button type="button" style={button} disabled={saving} onClick={() => setOpen(false)}>Close</button>
        </div>

        {loading ? <div style={{ marginTop: 18, padding: 16, background: '#f8fafc', borderRadius: 9 }}>Loading breakdown…</div> : <div style={{ display: 'grid', gap: 13, marginTop: 18 }}>
          <label style={label}>Final Total Cost
            <div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 11, top: 11, fontWeight: 900, color: '#52616d' }}>$</span><input style={{ ...input, paddingLeft: 26, fontSize: 20, fontWeight: 900 }} inputMode="decimal" value={draft.totalAmount} onChange={(event) => setField('totalAmount', event.target.value.replace(/[^0-9.]/g, '').slice(0, 12))} /></div>
          </label>
          <label style={label}>Service Provider<input style={input} value={draft.serviceProvider} onChange={(event) => setField('serviceProvider', event.target.value.slice(0, 180))} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(160px,.7fr)', gap: 12 }}>
            <label style={label}>Invoice #<input style={input} value={draft.invoiceNumber} onChange={(event) => setField('invoiceNumber', event.target.value.slice(0, 100))} /></label>
            <label style={label}>Invoice Date<input type="date" style={input} value={draft.invoiceDate} onChange={(event) => setField('invoiceDate', event.target.value)} /></label>
          </div>
          <label style={label}>Closeout Notes<textarea style={{ ...input, minHeight: 120, resize: 'vertical' }} value={draft.closeoutNotes} onChange={(event) => setField('closeoutNotes', event.target.value.slice(0, 4000))} /></label>
          {message && <div style={{ padding: 10, border: '1px solid #efc16c', borderRadius: 8, background: '#fff8e8', color: '#6b4d14', fontSize: 12, fontWeight: 700 }}>{message}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" style={button} disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" style={{ ...button, background: '#f47b20', borderColor: '#f47b20', color: '#fff', minWidth: 170 }} disabled={saving || loading} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Correction'}</button>
          </div>
        </div>}
      </div>
    </div>}
  </>;
}
