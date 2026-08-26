'use client';

import { useState, useRef } from 'react';

/**
 * PUBLIC page -- no auth. This is intentionally its own route (meant to be
 * served from a driver-facing subdomain, e.g. report.norloworld.com) rather
 * than a tab inside the main dashboard, so drivers never see or need
 * credentials for shop-side tooling. Mirrors the old norloworld-breakdown
 * MainForm.jsx fields.
 */

const REPAIR_CATEGORIES = ['AIR/CHAMBERS/GLADHANDS', 'TIRES', 'ELECTRICAL/Lights', 'MECHANICAL', 'Tow', 'Other'];
const STATES = ['MI', 'OH', 'IN', 'IL', 'WI', 'KY', 'MO', 'WV', 'PA', 'TN', 'Other'];

export default function ReportBreakdownPage() {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: true; breakdownId: number } | { error: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const form = new FormData(e.currentTarget);
      const res = await fetch('/api/breakdowns', { method: 'POST', body: form });
      const data = await res.json<any>();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setResult({ ok: true, breakdownId: data.breakdownId });
      formRef.current?.reset();
    } catch (err) {
      setResult({ error: String((err as Error)?.message ?? err) });
    } finally {
      setSubmitting(false);
    }
  }

  if (result && 'ok' in result) {
    return (
      <main style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
        <h1>Breakdown reported</h1>
        <p>Dispatch has been notified. Reference #{result.breakdownId}.</p>
        <button onClick={() => setResult(null)}>Report another breakdown</button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1>Report a Breakdown</h1>
      <form ref={formRef} onSubmit={handleSubmit}>
        <label>
          Driver Name *
          <input name="driverName" required maxLength={120} />
        </label>
        <label>
          Truck # *
          <input name="truckUnit" required maxLength={20} />
        </label>
        <label>
          Trailer #
          <input name="trailerUnit" maxLength={20} />
        </label>
        <label>
          State *
          <select name="state" required defaultValue="">
            <option value="" disabled>Select state</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          City *
          <input name="city" required maxLength={120} />
        </label>
        <label>
          Repair Type *
          <select name="repairCategory" required defaultValue="">
            <option value="" disabled>Select type</option>
            {REPAIR_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Description *
          <textarea name="description" required maxLength={2000} rows={5} />
        </label>
        <label>
          Photos
          <input type="file" name="photos" accept="image/*" multiple capture="environment" />
        </label>

        {result && 'error' in result && <p style={{ color: 'crimson' }}>{result.error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Breakdown'}
        </button>
      </form>
    </main>
  );
}
