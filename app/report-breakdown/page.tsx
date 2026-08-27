'use client';

import { useEffect, useRef, useState } from 'react';

type UnitType = '' | 'truck' | 'trailer';
type UnitResult = { unit: string; equipmentType: string };
type SubmitResult = { ok: true; breakdownId: number } | { error: string } | null;

const REPAIR_CATEGORIES = [
  'AIR/CHAMBERS/GLADHANDS',
  'TIRES',
  'ELECTRICAL/Lights',
  'MECHANICAL',
  'Tow',
  'Other',
];

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const fieldStyle: React.CSSProperties = {
  width: '100%', minHeight: 50, padding: '10px 13px', border: '1px solid #cbd5dd',
  borderRadius: 10, background: '#fff', color: '#172033', fontSize: 16, boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'grid', gap: 7, color: '#334155', fontSize: 13, fontWeight: 850,
};

export default function ReportBreakdownPage() {
  const [unitType, setUnitType] = useState<UnitType>('');
  const [unitQuery, setUnitQuery] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [units, setUnits] = useState<UnitResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!unitType || selectedUnit) {
      setUnits([]);
      setHasMore(false);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const params = new URLSearchParams({ type: unitType, q: unitQuery.trim() });
        const response = await fetch(`/api/equipment/search?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json() as { units?: UnitResult[]; hasMore?: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Unit search failed.');
        setUnits(Array.isArray(payload.units) ? payload.units : []);
        setHasMore(Boolean(payload.hasMore));
      } catch (error) {
        if (controller.signal.aborted) return;
        setUnits([]);
        setHasMore(false);
        setSearchError(error instanceof Error ? error.message : 'Unit search failed.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 160);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [unitType, unitQuery, selectedUnit]);

  function chooseType(next: Exclude<UnitType, ''>) {
    setUnitType(next);
    setUnitQuery('');
    setSelectedUnit('');
    setUnits([]);
    setHasMore(false);
    setSearchError('');
    setResult(null);
  }

  function chooseUnit(unit: string) {
    setSelectedUnit(unit);
    setUnitQuery(unit);
    setUnits([]);
    setHasMore(false);
    setSearchError('');
  }

  function changeUnit() {
    setSelectedUnit('');
    setUnitQuery('');
    setResult(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);

    if (!unitType) {
      setResult({ error: 'Pick Truck or Trailer.' });
      return;
    }
    if (!selectedUnit) {
      setResult({ error: 'Search for and tap the unit number.' });
      return;
    }

    setSubmitting(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch('/api/breakdowns', { method: 'POST', body: form });
      const payload = await response.json() as { ok?: boolean; breakdownId?: number; error?: string };
      if (!response.ok || !payload.ok || !payload.breakdownId) {
        throw new Error(payload.error || 'The breakdown could not be saved.');
      }
      setResult({ ok: true, breakdownId: payload.breakdownId });
      formRef.current?.reset();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : 'The breakdown could not be saved.' });
    } finally {
      setSubmitting(false);
    }
  }

  function reportAnother() {
    setResult(null);
    setUnitType('');
    setUnitQuery('');
    setSelectedUnit('');
    setUnits([]);
    setHasMore(false);
    setSearchError('');
  }

  if (result && 'ok' in result) {
    return (
      <main className="easy-page">
        <div className="easy-page-narrow" style={{ maxWidth: 720 }}>
          <section className="easy-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: 28, background: '#0d1b2b', color: '#fff' }}>
              <p className="easy-eyebrow">ROADSIDE BREAKDOWN</p>
              <h1 style={{ margin: '8px 0 0', fontSize: 34 }}>Breakdown saved</h1>
              <p style={{ margin: '10px 0 0', color: '#c5d0da', lineHeight: 1.5 }}>
                Reference #{result.breakdownId}. Keep this number if you need to follow up.
              </p>
            </div>
            <div className="easy-card-body">
              <p className="easy-section-copy" style={{ marginTop: 0 }}>
                The report is now in Northern&apos;s breakdown system. Email and Twilio alerts will be connected later; this page is currently saving directly to D1 only.
              </p>
              <div className="easy-actions">
                <button type="button" className="easy-button orange" onClick={reportAnother}>Report another breakdown</button>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="easy-page">
      <div className="easy-page-narrow" style={{ maxWidth: 820 }}>
        <p className="easy-eyebrow">NORTHERN LOGISTICS</p>
        <h1 className="easy-title">Report a Roadside Breakdown</h1>
        <p className="easy-subtitle">Choose the unit that is broken down, then give dispatch the information they need.</p>

        <form ref={formRef} onSubmit={handleSubmit} className="easy-card" style={{ marginTop: 20, overflow: 'hidden' }}>
          <input type="hidden" name="unitType" value={unitType} />
          <input type="hidden" name="unitNumber" value={selectedUnit} />

          <section style={{ padding: 22, borderBottom: '1px solid #e2e8f0' }}>
            <p className="easy-eyebrow">1 · WHICH UNIT BROKE DOWN?</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              {(['truck', 'trailer'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`easy-button ${unitType === type ? 'orange' : ''}`}
                  aria-pressed={unitType === type}
                  onClick={() => chooseType(type)}
                  style={{ minHeight: 58, fontSize: 16 }}
                >
                  {type === 'truck' ? 'Truck' : 'Trailer'}
                </button>
              ))}
            </div>

            {unitType && !selectedUnit && (
              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>
                  Quick search {unitType === 'truck' ? 'truck' : 'trailer'} number *
                  <input
                    className="easy-search-input"
                    value={unitQuery}
                    onChange={(event) => setUnitQuery(event.target.value.replace(/[^a-zA-Z0-9()\- ]/g, '').slice(0, 24))}
                    placeholder={`Start typing ${unitType === 'truck' ? 'truck' : 'trailer'} #`}
                    autoComplete="off"
                    inputMode="text"
                  />
                </label>

                {searching && <p className="easy-section-copy">Searching fleet...</p>}
                {searchError && <div className="easy-notice">{searchError}</div>}

                {!searching && !searchError && units.length > 0 && (
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(92px,1fr))', gap: 8 }}>
                    {units.map((item) => (
                      <button
                        key={item.unit}
                        type="button"
                        className="easy-button"
                        onClick={() => chooseUnit(item.unit)}
                        style={{ minHeight: 48, fontSize: 14 }}
                      >
                        {item.unit}
                      </button>
                    ))}
                  </div>
                )}

                {!searching && !searchError && unitQuery && units.length === 0 && (
                  <div className="easy-notice">No active {unitType}s match “{unitQuery}”. Check the number and try again.</div>
                )}

                {hasMore && <p className="easy-section-copy">More matches exist — keep typing to narrow the list.</p>}
              </div>
            )}

            {selectedUnit && (
              <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: '#0d1b2b', color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <small style={{ color: '#9fb0bf', fontWeight: 900, textTransform: 'uppercase' }}>Selected {unitType}</small>
                  <strong style={{ display: 'block', marginTop: 3, fontSize: 24 }}>{selectedUnit}</strong>
                </div>
                <button type="button" className="easy-button" onClick={changeUnit}>Change</button>
              </div>
            )}
          </section>

          <section style={{ padding: 22 }}>
            <p className="easy-eyebrow">2 · BREAKDOWN DETAILS</p>
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14 }}>
              <label style={labelStyle}>
                Driver Name *
                <input name="driverName" required maxLength={120} autoComplete="name" style={fieldStyle} />
              </label>

              <label style={labelStyle}>
                State *
                <select name="state" required defaultValue="" style={fieldStyle}>
                  <option value="" disabled>Select state</option>
                  {STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>

              <label style={labelStyle}>
                City *
                <input name="city" required maxLength={120} autoComplete="address-level2" style={fieldStyle} />
              </label>

              <label style={labelStyle}>
                Repair Type *
                <select name="repairCategory" required defaultValue="" style={fieldStyle}>
                  <option value="" disabled>Select repair type</option>
                  {REPAIR_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
            </div>

            <label style={{ ...labelStyle, marginTop: 14 }}>
              What happened / what needs repair? *
              <textarea name="description" required maxLength={2000} rows={6} style={{ ...fieldStyle, minHeight: 130, resize: 'vertical' }} />
            </label>

            <label style={{ ...labelStyle, marginTop: 14 }}>
              Photos (optional)
              <input type="file" name="photos" accept="image/*" multiple capture="environment" style={{ ...fieldStyle, paddingTop: 12 }} />
            </label>

            {result && 'error' in result && <div className="easy-notice" style={{ borderColor: '#e49b95', background: '#fff0ef', color: '#8a2922' }}>{result.error}</div>}

            <button type="submit" className="easy-button orange" disabled={submitting} style={{ width: '100%', minHeight: 58, marginTop: 18, fontSize: 16 }}>
              {submitting ? 'Saving breakdown...' : 'Submit Breakdown'}
            </button>
          </section>
        </form>
      </div>
    </main>
  );
}
