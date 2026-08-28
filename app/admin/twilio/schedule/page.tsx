'use client';

import { useEffect, useState, type CSSProperties } from 'react';

type Schedule = {
  enabled: boolean;
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  allowedNow: boolean;
  updatedAt: string;
};

type ApiResult = { schedule?: Schedule; ok?: boolean; message?: string; error?: string };

const DAYS = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

export default function BreakdownTextSchedulePage() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/admin/twilio/schedule', { cache: 'no-store' });
    const result = await response.json() as ApiResult;
    if (response.status === 401) { window.location.assign('/login?returnTo=/admin/twilio/schedule'); return; }
    if (!response.ok || !result.schedule) throw new Error(result.error || 'Breakdown text schedule could not be loaded.');
    setSchedule(result.schedule);
  }

  useEffect(() => {
    void load().catch(error => setMessage(error instanceof Error ? error.message : 'Breakdown text schedule could not be loaded.'));
  }, []);

  function patch(patchValue: Partial<Schedule>) {
    setSchedule(current => current ? { ...current, ...patchValue } : current);
  }

  function toggleDay(day: number) {
    setSchedule(current => {
      if (!current) return current;
      const exists = current.days.includes(day);
      const days = exists ? current.days.filter(item => item !== day) : [...current.days, day].sort((a, b) => a - b);
      return { ...current, days };
    });
  }

  async function save() {
    if (!schedule) return;
    if (schedule.enabled && schedule.days.length === 0) {
      setMessage('Select at least one day, or turn the schedule off for Always On.');
      return;
    }
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: schedule.enabled,
          days: schedule.days,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok || !result.schedule) throw new Error(result.error || 'Breakdown text schedule could not be saved.');
      setSchedule(result.schedule);
      setMessage(result.message || 'Schedule saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown text schedule could not be saved.');
    } finally { setBusy(false); }
  }

  const enabled = Boolean(schedule?.enabled);
  const allowedNow = Boolean(schedule?.allowedNow);

  return <section style={{ background: '#f3f5f7', padding: '0 clamp(16px,4vw,46px) 28px', color: '#182331' }}>
    <div style={{ ...card, borderColor: enabled ? (allowedNow ? '#a9d3b5' : '#e0ba73') : '#a9d3b5', background: enabled && !allowedNow ? '#fff9ed' : '#f5fbf6' }}>
      <div style={rowWrap}>
        <div>
          <div style={eyebrow}>DIAGNOSTICS · BREAKDOWN TEXTING</div>
          <h2 style={heading}>Breakdown Text Schedule</h2>
          <p style={copy}>This schedule controls Twilio SMS only. Breakdown email continues to send immediately whether SMS is inside or outside the schedule.</p>
        </div>
        <a href="/admin/twilio" style={linkButton}>Back to Breakdown Texting</a>
      </div>

      {message && <div style={notice}>{message}</div>}

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(240px,.8fr) minmax(360px,1.2fr)', gap: 14, alignItems: 'start' }}>
        <div style={infoCard}>
          <strong>Current behavior</strong>
          <div style={detail}><span>SMS mode</span><strong>{enabled ? 'SCHEDULED' : 'ALWAYS ON'}</strong></div>
          <div style={detail}><span>Right now</span><strong>{!enabled || allowedNow ? 'TEXTS ALLOWED' : 'EMAIL ONLY'}</strong></div>
          <div style={detail}><span>Time zone</span><strong>{schedule?.timezone || 'America/Detroit'}</strong></div>
          <p style={smallCopy}>Outside the selected SMS window, the text is skipped rather than held for later. The breakdown email still goes out immediately.</p>
        </div>

        <div style={formCard}>
          <label style={switchLabel}>
            <input type="checkbox" checked={enabled} onChange={event => patch({ enabled: event.target.checked })} />
            Use a texting schedule
          </label>
          {!enabled && <div style={savedBox}><strong>Always On</strong><p style={smallCopy}>When Twilio is enabled, every breakdown can text the active Breakdown Text Users at any time.</p></div>}

          {enabled && <>
            <div>
              <div style={label}>Days the texting window starts</div>
              <div style={dayGrid}>
                {DAYS.map(day => <label key={day.id} style={{ ...dayChip, borderColor: schedule?.days.includes(day.id) ? '#4c7b5b' : '#d7e0e6', background: schedule?.days.includes(day.id) ? '#edf7ef' : '#fff' }}>
                  <input type="checkbox" checked={Boolean(schedule?.days.includes(day.id))} onChange={() => toggleDay(day.id)} />
                  {day.label}
                </label>)}
              </div>
            </div>

            <div style={timeGrid}>
              <label style={label}>Start time<input type="time" style={input} value={schedule?.startTime || '00:00'} onChange={event => patch({ startTime: event.target.value })} /></label>
              <label style={label}>End time<input type="time" style={input} value={schedule?.endTime || '00:00'} onChange={event => patch({ endTime: event.target.value })} /></label>
            </div>
            <p style={smallCopy}>Times use America/Detroit. Overnight windows work too—for example Monday 6:00 PM to 6:00 AM continues into Tuesday morning. If start and end are the same, that selected day is open for 24 hours.</p>
          </>}

          <button type="button" disabled={busy || !schedule} onClick={() => void save()} style={primaryButton}>{busy ? 'Saving…' : 'Save Text Schedule'}</button>
        </div>
      </div>
    </div>
  </section>;
}

const card: CSSProperties = { border: '2px solid', borderRadius: 14, padding: 18, boxShadow: '0 3px 14px rgba(15,32,48,.05)' };
const heading: CSSProperties = { margin: '6px 0 0', fontSize: 23, color: '#102238' };
const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: '.12em', color: '#415d74' };
const copy: CSSProperties = { margin: '7px 0 0', color: '#586979', lineHeight: 1.55, fontSize: 14 };
const smallCopy: CSSProperties = { margin: '5px 0 0', color: '#657482', lineHeight: 1.5, fontSize: 12 };
const rowWrap: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' };
const infoCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: 'white', display: 'grid', gap: 10 };
const formCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: 'white', display: 'grid', gap: 12 };
const label: CSSProperties = { display: 'grid', gap: 5, color: '#485b6b', fontSize: 12, fontWeight: 900 };
const input: CSSProperties = { minHeight: 44, padding: '0 10px', border: '1px solid #cbd5dd', borderRadius: 8, background: 'white', color: '#172536', fontSize: 16 };
const switchLabel: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', minHeight: 44, fontSize: 14, fontWeight: 900 };
const dayGrid: CSSProperties = { marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(74px,1fr))', gap: 8 };
const dayChip: CSSProperties = { minHeight: 44, border: '1px solid', borderRadius: 9, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 850 };
const timeGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 };
const detail: CSSProperties = { display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8, fontSize: 12, alignItems: 'baseline' };
const savedBox: CSSProperties = { padding: 12, border: '1px solid #d6e0e7', borderRadius: 9, background: '#f9fbfc' };
const notice: CSSProperties = { marginTop: 12, padding: '10px 11px', border: '1px solid #d8c17b', borderRadius: 8, background: '#fffdf2', fontSize: 13 };
const primaryButton: CSSProperties = { minHeight: 44, border: 0, borderRadius: 8, padding: '9px 13px', background: '#0d1b2b', color: 'white', fontWeight: 900, width: 'fit-content' };
const linkButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 11px', border: '1px solid #cbd5dd', borderRadius: 8, color: '#17324a', background: 'white', textDecoration: 'none', fontWeight: 850, fontSize: 12 };
