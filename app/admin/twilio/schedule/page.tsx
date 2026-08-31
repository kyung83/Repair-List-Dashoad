'use client';

import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';

type WeekInterval = 1 | 2;

type Schedule = {
  enabled: boolean;
  days: number[];
  startTime: string;
  endTime: string;
  weekInterval: WeekInterval;
  activeThisWeek: boolean;
  anchorWeekStart: string;
  timezone: string;
  allowedNow: boolean;
  updatedAt: string;
};

type ContactScheduleMode = 'default' | 'always' | 'custom';

type ContactSchedule = {
  contactId: number;
  label: string;
  phone: string;
  active: boolean;
  mode: ContactScheduleMode;
  days: number[];
  startTime: string;
  endTime: string;
  weekInterval: WeekInterval;
  activeThisWeek: boolean;
  anchorWeekStart: string;
  timezone: string;
  allowedNow: boolean;
  updatedAt: string;
};

type ApiResult = {
  schedule?: Schedule;
  contacts?: ContactSchedule[];
  ok?: boolean;
  message?: string;
  error?: string;
};

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
  const [contacts, setContacts] = useState<ContactSchedule[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/admin/twilio/schedule', { cache: 'no-store' });
    const result = await response.json() as ApiResult;
    if (response.status === 401) { window.location.assign('/login?returnTo=/admin/twilio/schedule'); return; }
    if (!response.ok || !result.schedule || !Array.isArray(result.contacts)) {
      throw new Error(result.error || 'Breakdown text schedules could not be loaded.');
    }
    setSchedule(result.schedule);
    setContacts(result.contacts);
  }

  useEffect(() => {
    void load().catch(error => setMessage(error instanceof Error ? error.message : 'Breakdown text schedules could not be loaded.'));
  }, []);

  function patchDefault(patchValue: Partial<Schedule>) {
    setSchedule(current => current ? { ...current, ...patchValue } : current);
  }

  function toggleDefaultDay(day: number) {
    setSchedule(current => {
      if (!current) return current;
      const exists = current.days.includes(day);
      const days = exists ? current.days.filter(item => item !== day) : [...current.days, day].sort((a, b) => a - b);
      return { ...current, days };
    });
  }

  function patchContact(contactId: number, patchValue: Partial<ContactSchedule>) {
    setContacts(current => current.map(contact => contact.contactId === contactId ? { ...contact, ...patchValue } : contact));
  }

  function toggleContactDay(contactId: number, day: number) {
    setContacts(current => current.map(contact => {
      if (contact.contactId !== contactId) return contact;
      const exists = contact.days.includes(day);
      const days = exists ? contact.days.filter(item => item !== day) : [...contact.days, day].sort((a, b) => a - b);
      return { ...contact, days };
    }));
  }

  async function saveDefault() {
    if (!schedule) return;
    if (schedule.enabled && schedule.days.length === 0) {
      setMessage('Select at least one shared office-hours day, or turn the shared window off.');
      return;
    }
    setBusy('default'); setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save-default',
          enabled: schedule.enabled,
          days: schedule.days,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          weekInterval: schedule.weekInterval,
          activeThisWeek: schedule.activeThisWeek,
        }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok || !result.schedule || !Array.isArray(result.contacts)) {
        throw new Error(result.error || 'Shared office-hours schedule could not be saved.');
      }
      setSchedule(result.schedule);
      setContacts(result.contacts);
      setMessage(result.message || 'Shared office-hours schedule saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Shared office-hours schedule could not be saved.');
    } finally { setBusy(''); }
  }

  async function saveContact(contact: ContactSchedule) {
    if (contact.mode === 'custom' && contact.days.length === 0) {
      setMessage(`Select at least one personal on-call day for ${contact.label}.`);
      return;
    }
    const busyKey = `contact-${contact.contactId}`;
    setBusy(busyKey); setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save-contact',
          contactId: contact.contactId,
          mode: contact.mode,
          days: contact.days,
          startTime: contact.startTime,
          endTime: contact.endTime,
          weekInterval: contact.weekInterval,
          activeThisWeek: contact.activeThisWeek,
        }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok || !Array.isArray(result.contacts)) {
        throw new Error(result.error || `The schedule for ${contact.label} could not be saved.`);
      }
      const saved = result.contacts.find(item => item.contactId === contact.contactId);
      if (saved) patchContact(contact.contactId, saved);
      if (result.schedule) setSchedule(result.schedule);
      setMessage(result.message || `Schedule saved for ${contact.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The schedule for ${contact.label} could not be saved.`);
    } finally { setBusy(''); }
  }

  const defaultEnabled = Boolean(schedule?.enabled);
  const defaultAllowedNow = Boolean(schedule?.allowedNow);

  return <section style={{ background: '#f3f5f7', padding: '0 clamp(16px,4vw,46px) 28px', color: '#182331' }}>
    <div style={rowWrap}>
      <div>
        <div style={eyebrow}>DIAGNOSTICS · BREAKDOWN TEXTING</div>
        <h2 style={heading}>Shared Office Hours & Personal On-Call Schedules</h2>
        <p style={copy}>Set office hours once so every active breakdown text user receives those alerts every week. Then add a personal nights, weekends, or every-other-week on-call schedule for each person. Breakdown email still sends immediately.</p>
      </div>
      <a href="/admin/twilio" style={linkButton}>Back to Breakdown Texting</a>
    </div>

    {message && <div style={notice}>{message}</div>}

    <div style={{ ...card, marginTop: 16, borderColor: defaultEnabled ? (defaultAllowedNow ? '#a9d3b5' : '#e0ba73') : '#a9d3b5', background: defaultEnabled && !defaultAllowedNow ? '#fff9ed' : '#f5fbf6' }}>
      <div style={rowWrap}>
        <div>
          <div style={eyebrow}>SHARED OFFICE HOURS</div>
          <h3 style={subheading}>Every active text user gets these alerts</h3>
          <p style={copy}>This window is shared by everyone and is added to each person’s personal on-call schedule. Set the rotation to Every week for normal office hours.</p>
        </div>
        <div style={statusPill}><span>Shared window now</span><strong>{!defaultEnabled || defaultAllowedNow ? 'TEXTS ALLOWED' : 'OUTSIDE OFFICE HOURS'}</strong></div>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(240px,.8fr) minmax(360px,1.2fr)', gap: 14, alignItems: 'start' }}>
        <div style={infoCard}>
          <strong>Shared coverage</strong>
          <div style={detail}><span>Mode</span><strong>{defaultEnabled ? 'SCHEDULED' : 'ALWAYS ON'}</strong></div>
          <div style={detail}><span>Rotation</span><strong>{schedule?.weekInterval === 2 ? 'EVERY OTHER WEEK' : 'EVERY WEEK'}</strong></div>
          <div style={detail}><span>Time zone</span><strong>{schedule?.timezone || 'America/Detroit'}</strong></div>
          <p style={smallCopy}>Custom personal schedules add extra coverage outside this shared window; they no longer replace it. Inactive text users never receive alerts.</p>
        </div>

        <div style={formCard}>
          <label style={switchLabel}>
            <input type="checkbox" checked={defaultEnabled} onChange={(event: ChangeEvent<HTMLInputElement>) => patchDefault({ enabled: event.target.checked })} />
            Use a shared office-hours window
          </label>
          {!defaultEnabled && <div style={savedBox}><strong>Shared coverage is Always On</strong><p style={smallCopy}>Every active breakdown text user receives every new alert at all times. Enable the window to limit shared coverage to office hours.</p></div>}

          {defaultEnabled && <ScheduleFields
            days={schedule?.days || []}
            startTime={schedule?.startTime || '00:00'}
            endTime={schedule?.endTime || '00:00'}
            weekInterval={schedule?.weekInterval || 1}
            activeThisWeek={schedule?.activeThisWeek !== false}
            onToggleDay={toggleDefaultDay}
            onStartTime={value => patchDefault({ startTime: value })}
            onEndTime={value => patchDefault({ endTime: value })}
            onWeekInterval={value => patchDefault({ weekInterval: value })}
            onActiveThisWeek={value => patchDefault({ activeThisWeek: value })}
          />}

          <button type="button" disabled={Boolean(busy) || !schedule} onClick={() => void saveDefault()} style={primaryButton}>{busy === 'default' ? 'Saving…' : 'Save Shared Office Hours'}</button>
        </div>
      </div>
    </div>

    <div style={{ ...card, marginTop: 16, borderColor: '#d7e0e6', background: '#fff' }}>
      <div style={eyebrow}>PERSONAL AFTER-HOURS / ON-CALL</div>
      <h3 style={subheading}>Add extra coverage for each person</h3>
      <p style={copy}>Everyone still receives texts during shared office hours. Use the personal schedules below for nights, weekends, and alternating on-call weeks.</p>

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {contacts.map(contact => {
          const busyKey = `contact-${contact.contactId}`;
          return <article key={contact.contactId} style={{ ...personCard, opacity: contact.active ? 1 : .68 }}>
            <div style={rowWrap}>
              <div>
                <strong style={{ fontSize: 17 }}>{contact.label}</strong>
                <div style={{ marginTop: 3, color: '#64748b', fontSize: 13 }}>{contact.phone}</div>
              </div>
              <div style={{ ...statusPill, borderColor: contact.active && contact.allowedNow ? '#9fcfb0' : '#e5b765', background: contact.active && contact.allowedNow ? '#f1faf4' : '#fff8e8' }}>
                <span>{contact.active ? 'Right now' : 'Status'}</span>
                <strong>{!contact.active ? 'INACTIVE' : contact.allowedNow ? 'TEXTS ALLOWED' : 'EMAIL ONLY'}</strong>
              </div>
            </div>

            {!contact.active && <div style={inactiveNotice}>This person is inactive on the Breakdown Text Users page and will not receive texts until reactivated.</div>}

            <label style={{ ...label, marginTop: 12 }}>
              Coverage for this person
              <select style={input} value={contact.mode} onChange={(event: ChangeEvent<HTMLSelectElement>) => patchContact(contact.contactId, { mode: event.target.value as ContactScheduleMode })}>
                <option value="default">Shared office hours only</option>
                <option value="always">Always text this person</option>
                <option value="custom">Shared office hours + personal on-call</option>
              </select>
            </label>

            {contact.mode === 'default' && <div style={savedBox}><strong>Shared office hours only</strong><p style={smallCopy}>This person receives all shared office-hour alerts and no extra personal on-call coverage.</p></div>}
            {contact.mode === 'always' && <div style={savedBox}><strong>Always text this person</strong><p style={smallCopy}>When Twilio is enabled and this user is active, this person receives every new breakdown alert.</p></div>}
            {contact.mode === 'custom' && <>
              <div style={savedBox}><strong>Shared office hours stay on</strong><p style={smallCopy}>The personal schedule below adds nights, weekends, or alternating-week coverage. It does not remove the shared office-hours texts.</p></div>
              <ScheduleFields
                days={contact.days}
                startTime={contact.startTime}
                endTime={contact.endTime}
                weekInterval={contact.weekInterval}
                activeThisWeek={contact.activeThisWeek}
                onToggleDay={day => toggleContactDay(contact.contactId, day)}
                onStartTime={value => patchContact(contact.contactId, { startTime: value })}
                onEndTime={value => patchContact(contact.contactId, { endTime: value })}
                onWeekInterval={value => patchContact(contact.contactId, { weekInterval: value })}
                onActiveThisWeek={value => patchContact(contact.contactId, { activeThisWeek: value })}
              />
            </>}

            <button type="button" disabled={Boolean(busy)} onClick={() => void saveContact(contact)} style={primaryButton}>{busy === busyKey ? 'Saving…' : `Save ${contact.label}'s Schedule`}</button>
          </article>;
        })}
        {schedule && contacts.length === 0 && <div style={empty}>No breakdown text users have phone numbers yet. Add them on the Breakdown Texting page first.</div>}
      </div>
    </div>
  </section>;
}

function ScheduleFields({
  days,
  startTime,
  endTime,
  weekInterval,
  activeThisWeek,
  onToggleDay,
  onStartTime,
  onEndTime,
  onWeekInterval,
  onActiveThisWeek,
}: {
  days: number[];
  startTime: string;
  endTime: string;
  weekInterval: WeekInterval;
  activeThisWeek: boolean;
  onToggleDay: (day: number) => void;
  onStartTime: (value: string) => void;
  onEndTime: (value: string) => void;
  onWeekInterval: (value: WeekInterval) => void;
  onActiveThisWeek: (value: boolean) => void;
}) {
  return <>
    <div>
      <div style={label}>Days the texting window starts</div>
      <div style={dayGrid}>
        {DAYS.map(day => <label key={day.id} style={{ ...dayChip, borderColor: days.includes(day.id) ? '#4c7b5b' : '#d7e0e6', background: days.includes(day.id) ? '#edf7ef' : '#fff' }}>
          <input type="checkbox" checked={days.includes(day.id)} onChange={() => onToggleDay(day.id)} />
          {day.label}
        </label>)}
      </div>
    </div>

    <div style={timeGrid}>
      <label style={label}>Start time<input type="time" style={input} value={startTime} onChange={(event: ChangeEvent<HTMLInputElement>) => onStartTime(event.target.value)} /></label>
      <label style={label}>End time<input type="time" style={input} value={endTime} onChange={(event: ChangeEvent<HTMLInputElement>) => onEndTime(event.target.value)} /></label>
    </div>

    <div style={timeGrid}>
      <label style={label}>
        Week rotation
        <select style={input} value={weekInterval} onChange={(event: ChangeEvent<HTMLSelectElement>) => onWeekInterval(Number(event.target.value) === 2 ? 2 : 1)}>
          <option value={1}>Every week</option>
          <option value={2}>Every other week</option>
        </select>
      </label>

      {weekInterval === 2 && <label style={label}>
        Start the two-week rotation
        <select style={input} value={activeThisWeek ? 'on' : 'off'} onChange={(event: ChangeEvent<HTMLSelectElement>) => onActiveThisWeek(event.target.value === 'on')}>
          <option value="on">This week ON, next week OFF</option>
          <option value="off">This week OFF, next week ON</option>
        </select>
      </label>}
    </div>

    {weekInterval === 2 && <div style={rotationNotice}>
      <strong>{activeThisWeek ? 'This week is an ON week.' : 'This week is an OFF week.'}</strong>
      <p style={smallCopy}>The schedule flips automatically every Monday at midnight in America/Detroit time. Set one person ON this week and the other OFF this week to alternate them.</p>
    </div>}

    <p style={smallCopy}>Overnight windows work too—for example Monday 6:00 PM to 6:00 AM continues into Tuesday morning. Matching start and end times make the selected day open for 24 hours.</p>
  </>;
}

const card: CSSProperties = { border: '2px solid', borderRadius: 14, padding: 18, boxShadow: '0 3px 14px rgba(15,32,48,.05)' };
const heading: CSSProperties = { margin: '6px 0 0', fontSize: 25, color: '#102238' };
const subheading: CSSProperties = { margin: '6px 0 0', fontSize: 20, color: '#102238' };
const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: '.12em', color: '#415d74' };
const copy: CSSProperties = { margin: '7px 0 0', color: '#586979', lineHeight: 1.55, fontSize: 14 };
const smallCopy: CSSProperties = { margin: '5px 0 0', color: '#657482', lineHeight: 1.5, fontSize: 12 };
const rowWrap: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' };
const infoCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: 'white', display: 'grid', gap: 10 };
const formCard: CSSProperties = { padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: 'white', display: 'grid', gap: 12 };
const personCard: CSSProperties = { padding: 16, border: '1px solid #dce2e7', borderRadius: 12, background: '#fbfcfd', display: 'grid', gap: 12 };
const label: CSSProperties = { display: 'grid', gap: 5, color: '#485b6b', fontSize: 12, fontWeight: 900 };
const input: CSSProperties = { minHeight: 44, padding: '0 10px', border: '1px solid #cbd5dd', borderRadius: 8, background: 'white', color: '#172536', fontSize: 16 };
const switchLabel: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', minHeight: 44, fontSize: 14, fontWeight: 900 };
const dayGrid: CSSProperties = { marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(74px,1fr))', gap: 8 };
const dayChip: CSSProperties = { minHeight: 44, border: '1px solid', borderRadius: 9, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 850 };
const timeGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 };
const detail: CSSProperties = { display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8, fontSize: 12, alignItems: 'baseline' };
const statusPill: CSSProperties = { display: 'grid', gap: 2, minWidth: 132, padding: '8px 10px', border: '1px solid #9fcfb0', borderRadius: 9, background: '#f1faf4', fontSize: 11 };
const savedBox: CSSProperties = { padding: 12, border: '1px solid #d6e0e7', borderRadius: 9, background: '#f9fbfc' };
const rotationNotice: CSSProperties = { padding: 12, border: '1px solid #b9cde0', borderRadius: 9, background: '#f2f7fb', color: '#27445d' };
const inactiveNotice: CSSProperties = { padding: '9px 10px', border: '1px solid #e2bd73', borderRadius: 8, background: '#fff8e8', color: '#76530d', fontSize: 12 };
const notice: CSSProperties = { marginTop: 12, padding: '10px 11px', border: '1px solid #d8c17b', borderRadius: 8, background: '#fffdf2', fontSize: 13 };
const empty: CSSProperties = { padding: 18, border: '1px dashed #cbd5dd', borderRadius: 10, color: '#64748b', textAlign: 'center' };
const primaryButton: CSSProperties = { minHeight: 44, border: 0, borderRadius: 8, padding: '9px 13px', background: '#0d1b2b', color: 'white', fontWeight: 900, width: 'fit-content' };
const linkButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 11px', border: '1px solid #cbd5dd', borderRadius: 8, color: '#17324a', background: 'white', textDecoration: 'none', fontWeight: 850, fontSize: 12 };
