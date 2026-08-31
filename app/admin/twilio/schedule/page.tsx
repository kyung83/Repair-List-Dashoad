'use client';

import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';

type WeekInterval = 1 | 2;
type ContactScheduleMode = 'default' | 'always' | 'custom';

const MAX_PERSONAL_WINDOWS = 12;
let nextTemporaryWindowId = -1;

type CoverageWindow = {
  id: number;
  label: string;
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

type ContactSchedule = {
  contactId: number;
  label: string;
  phone: string;
  active: boolean;
  mode: ContactScheduleMode;
  windows: CoverageWindow[];
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

type ApiContactSchedule = Omit<ContactSchedule, 'windows'> & {
  windows?: CoverageWindow[];
};

type ApiResult = {
  contacts?: ApiContactSchedule[];
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

function newCoverageWindow(number: number): CoverageWindow {
  return {
    id: nextTemporaryWindowId--,
    label: number === 1 ? 'Office hours' : `Coverage window ${number}`,
    days: [1, 2, 3, 4, 5],
    startTime: '08:00',
    endTime: '17:00',
    weekInterval: 1,
    activeThisWeek: true,
    anchorWeekStart: '',
    timezone: 'America/Detroit',
    allowedNow: false,
    updatedAt: '',
  };
}

function hydrateContact(contact: ApiContactSchedule): ContactSchedule {
  const savedWindows = Array.isArray(contact.windows) ? contact.windows : [];
  const legacyWindow: CoverageWindow = {
    id: 0,
    label: 'Existing coverage',
    days: Array.isArray(contact.days) ? contact.days : [],
    startTime: contact.startTime || '08:00',
    endTime: contact.endTime || '17:00',
    weekInterval: contact.weekInterval === 2 ? 2 : 1,
    activeThisWeek: contact.activeThisWeek !== false,
    anchorWeekStart: contact.anchorWeekStart || '',
    timezone: contact.timezone || 'America/Detroit',
    allowedNow: false,
    updatedAt: contact.updatedAt || '',
  };
  return {
    ...contact,
    windows: savedWindows.length
      ? savedWindows
      : contact.mode === 'custom'
        ? [legacyWindow]
        : [],
  };
}

function statusText(contact: ContactSchedule) {
  if (!contact.active) return 'INACTIVE';
  if (contact.mode === 'default') return 'TEXTS PAUSED';
  return contact.allowedNow ? 'TEXTS ALLOWED' : 'OFF SCHEDULE';
}

export default function BreakdownTextSchedulePage() {
  const [contacts, setContacts] = useState<ContactSchedule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  function applyContacts(value: ApiContactSchedule[]) {
    setContacts(value.map(hydrateContact));
  }

  async function load() {
    const response = await fetch('/api/admin/twilio/schedule', { cache: 'no-store' });
    const result = await response.json() as ApiResult;
    if (response.status === 401) {
      window.location.assign('/login?returnTo=/admin/twilio/schedule');
      return;
    }
    if (!response.ok || !Array.isArray(result.contacts)) {
      throw new Error(result.error || 'Breakdown text schedules could not be loaded.');
    }
    applyContacts(result.contacts);
    setLoaded(true);
  }

  useEffect(() => {
    void load().catch(error => {
      setLoaded(true);
      setMessage(error instanceof Error ? error.message : 'Breakdown text schedules could not be loaded.');
    });
  }, []);

  function changeContactMode(contactId: number, mode: ContactScheduleMode) {
    setContacts(current => current.map(contact => {
      if (contact.contactId !== contactId) return contact;
      const windows = mode === 'custom' && contact.windows.length === 0
        ? [newCoverageWindow(1)]
        : contact.windows;
      return { ...contact, mode, windows };
    }));
  }

  function patchWindow(contactId: number, windowId: number, patchValue: Partial<CoverageWindow>) {
    setContacts(current => current.map(contact => contact.contactId === contactId ? {
      ...contact,
      windows: contact.windows.map(coverage => coverage.id === windowId ? { ...coverage, ...patchValue } : coverage),
    } : contact));
  }

  function toggleWindowDay(contactId: number, windowId: number, day: number) {
    setContacts(current => current.map(contact => {
      if (contact.contactId !== contactId) return contact;
      return {
        ...contact,
        windows: contact.windows.map(coverage => {
          if (coverage.id !== windowId) return coverage;
          const exists = coverage.days.includes(day);
          const days = exists
            ? coverage.days.filter(item => item !== day)
            : [...coverage.days, day].sort((a, b) => a - b);
          return { ...coverage, days };
        }),
      };
    }));
  }

  function addWindow(contactId: number) {
    setContacts(current => current.map(contact => {
      if (contact.contactId !== contactId || contact.windows.length >= MAX_PERSONAL_WINDOWS) return contact;
      return {
        ...contact,
        windows: [...contact.windows, newCoverageWindow(contact.windows.length + 1)],
      };
    }));
  }

  function removeWindow(contactId: number, windowId: number) {
    setContacts(current => current.map(contact => contact.contactId === contactId ? {
      ...contact,
      windows: contact.windows.filter(coverage => coverage.id !== windowId),
    } : contact));
  }

  async function saveContact(contact: ContactSchedule) {
    if (contact.mode === 'custom' && contact.windows.length === 0) {
      setMessage(`Add at least one coverage window for ${contact.label}.`);
      return;
    }
    if (contact.mode === 'custom') {
      const invalidWindow = contact.windows.findIndex(coverage => coverage.days.length === 0);
      if (invalidWindow >= 0) {
        setMessage(`Select at least one day for ${contact.label}'s coverage window ${invalidWindow + 1}.`);
        return;
      }
    }

    const busyKey = `contact-${contact.contactId}`;
    setBusy(busyKey);
    setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save-contact',
          contactId: contact.contactId,
          mode: contact.mode,
          windows: contact.windows.map(coverage => ({
            label: coverage.label,
            days: coverage.days,
            startTime: coverage.startTime,
            endTime: coverage.endTime,
            weekInterval: coverage.weekInterval,
            activeThisWeek: coverage.activeThisWeek,
          })),
        }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok || !Array.isArray(result.contacts)) {
        throw new Error(result.error || `The coverage for ${contact.label} could not be saved.`);
      }
      applyContacts(result.contacts);
      setMessage(result.message || `Coverage saved for ${contact.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The coverage for ${contact.label} could not be saved.`);
    } finally {
      setBusy('');
    }
  }

  return <section style={{ background: '#f3f5f7', padding: '0 clamp(16px,4vw,46px) 28px', color: '#182331' }}>
    <div style={rowWrap}>
      <div>
        <div style={eyebrow}>DIAGNOSTICS · BREAKDOWN TEXTING</div>
        <h2 style={heading}>Individual Breakdown Text Schedules</h2>
        <p style={copy}>There is no shared office-hours setting. Each person has their own exact days and times. When two schedules overlap, both people receive the text. Breakdown email still sends immediately.</p>
      </div>
      <a href="/admin/twilio" style={linkButton}>Back to Breakdown Texting</a>
    </div>

    {message && <div style={notice}>{message}</div>}

    <div style={{ ...card, marginTop: 16, borderColor: '#b9cde0', background: '#f5f9fc' }}>
      <div style={eyebrow}>HOW IT WORKS</div>
      <h3 style={subheading}>One person’s hours never change another person’s hours</h3>
      <div style={explanationGrid}>
        <div style={infoBox}><strong>Different start times</strong><span>Give each person their own weekly office-hours window.</span></div>
        <div style={infoBox}><strong>Alternating on-call</strong><span>Add a second every-other-week overnight window.</span></div>
        <div style={infoBox}><strong>Overlapping hours</strong><span>Everyone whose own window is active receives the alert.</span></div>
      </div>
    </div>

    <div style={{ ...card, marginTop: 16, borderColor: '#d7e0e6', background: '#fff' }}>
      <div style={eyebrow}>BREAKDOWN TEXT USERS</div>
      <h3 style={subheading}>Set each person separately</h3>
      <p style={copy}>Use as many windows as needed for regular hours, early or late coverage, weekends, and every-other-week on-call.</p>

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {contacts.map(contact => {
          const busyKey = `contact-${contact.contactId}`;
          const status = statusText(contact);
          const statusAllowed = contact.active && contact.mode !== 'default' && contact.allowedNow;
          return <article key={contact.contactId} style={{ ...personCard, opacity: contact.active ? 1 : .68 }}>
            <div style={rowWrap}>
              <div>
                <strong style={{ fontSize: 17 }}>{contact.label}</strong>
                <div style={{ marginTop: 3, color: '#64748b', fontSize: 13 }}>{contact.phone}</div>
              </div>
              <div style={{
                ...statusPill,
                borderColor: statusAllowed ? '#9fcfb0' : '#e5b765',
                background: statusAllowed ? '#f1faf4' : '#fff8e8',
              }}>
                <span>{contact.active ? 'Right now' : 'Status'}</span>
                <strong>{status}</strong>
              </div>
            </div>

            {!contact.active && <div style={inactiveNotice}>This person is inactive on the Breakdown Text Users page and will not receive texts until reactivated.</div>}

            <label style={{ ...label, marginTop: 12 }}>
              Texting for this person
              <select style={input} value={contact.mode} onChange={(event: ChangeEvent<HTMLSelectElement>) => changeContactMode(contact.contactId, event.target.value as ContactScheduleMode)}>
                <option value="default">Pause scheduled breakdown texts</option>
                <option value="always">Always text this person</option>
                <option value="custom">Use this person’s coverage windows</option>
              </select>
            </label>

            {contact.mode === 'default' && <div style={savedBox}>
              <strong>Scheduled texts are paused</strong>
              <p style={smallCopy}>This person will not receive new breakdown alert texts until Always or Coverage Windows is selected. Their saved windows can remain for later use.</p>
            </div>}

            {contact.mode === 'always' && <div style={savedBox}>
              <strong>Always text this person</strong>
              <p style={smallCopy}>When Twilio is enabled and this user is active, this person receives every new breakdown alert at any time.</p>
            </div>}

            {contact.mode === 'custom' && <>
              <div style={savedBox}>
                <strong>Only this person’s windows apply</strong>
                <p style={smallCopy}>A text is sent when any one of the windows below is active. Other people’s schedules do not affect this person.</p>
              </div>

              <div style={windowList}>
                {contact.windows.map((coverage, index) => <div key={coverage.id} style={coverageCard}>
                  <div style={windowHeader}>
                    <label style={{ ...label, flex: '1 1 240px' }}>
                      Coverage name
                      <input
                        type="text"
                        maxLength={80}
                        style={input}
                        value={coverage.label}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => patchWindow(contact.contactId, coverage.id, { label: event.target.value })}
                        placeholder={`Coverage window ${index + 1}`}
                      />
                    </label>
                    <button type="button" disabled={Boolean(busy)} onClick={() => removeWindow(contact.contactId, coverage.id)} style={removeButton}>Remove Window</button>
                  </div>

                  <ScheduleFields
                    days={coverage.days}
                    startTime={coverage.startTime}
                    endTime={coverage.endTime}
                    weekInterval={coverage.weekInterval}
                    activeThisWeek={coverage.activeThisWeek}
                    onToggleDay={day => toggleWindowDay(contact.contactId, coverage.id, day)}
                    onStartTime={value => patchWindow(contact.contactId, coverage.id, { startTime: value })}
                    onEndTime={value => patchWindow(contact.contactId, coverage.id, { endTime: value })}
                    onWeekInterval={value => patchWindow(contact.contactId, coverage.id, { weekInterval: value })}
                    onActiveThisWeek={value => patchWindow(contact.contactId, coverage.id, { activeThisWeek: value })}
                  />
                </div>)}

                {contact.windows.length === 0 && <div style={empty}>No windows yet. Add this person’s regular office hours first.</div>}

                <button
                  type="button"
                  disabled={Boolean(busy) || contact.windows.length >= MAX_PERSONAL_WINDOWS}
                  onClick={() => addWindow(contact.contactId)}
                  style={secondaryButton}
                >
                  {contact.windows.length >= MAX_PERSONAL_WINDOWS ? `Maximum ${MAX_PERSONAL_WINDOWS} Windows` : 'Add Another Coverage Window'}
                </button>
              </div>
            </>}

            <button type="button" disabled={Boolean(busy)} onClick={() => void saveContact(contact)} style={primaryButton}>
              {busy === busyKey ? 'Saving…' : `Save ${contact.label}'s Text Schedule`}
            </button>
          </article>;
        })}

        {loaded && contacts.length === 0 && <div style={empty}>No breakdown text users have phone numbers yet. Add them on the Breakdown Texting page first.</div>}
        {!loaded && <div style={empty}>Loading breakdown text users…</div>}
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
      <div style={label}>Days this window starts</div>
      <div style={dayGrid}>
        {DAYS.map(day => <label key={day.id} style={{
          ...dayChip,
          borderColor: days.includes(day.id) ? '#4c7b5b' : '#d7e0e6',
          background: days.includes(day.id) ? '#edf7ef' : '#fff',
        }}>
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
      <p style={smallCopy}>The window flips automatically every Monday at midnight in America/Detroit time.</p>
    </div>}

    <p style={smallCopy}>Overnight windows work too—for example Monday 5:00 PM to 7:00 AM continues into Tuesday morning. Matching start and end times make the selected day open for 24 hours.</p>
  </>;
}

const card: CSSProperties = { border: '2px solid', borderRadius: 14, padding: 18, boxShadow: '0 3px 14px rgba(15,32,48,.05)' };
const heading: CSSProperties = { margin: '6px 0 0', fontSize: 25, color: '#102238' };
const subheading: CSSProperties = { margin: '6px 0 0', fontSize: 20, color: '#102238' };
const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: '.12em', color: '#415d74' };
const copy: CSSProperties = { margin: '7px 0 0', color: '#586979', lineHeight: 1.55, fontSize: 14 };
const smallCopy: CSSProperties = { margin: '5px 0 0', color: '#657482', lineHeight: 1.5, fontSize: 12 };
const rowWrap: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' };
const explanationGrid: CSSProperties = { marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 };
const infoBox: CSSProperties = { display: 'grid', gap: 5, padding: 12, border: '1px solid #cbd9e5', borderRadius: 9, background: 'white', color: '#42576a', fontSize: 13 };
const personCard: CSSProperties = { padding: 16, border: '1px solid #dce2e7', borderRadius: 12, background: '#fbfcfd', display: 'grid', gap: 12 };
const windowList: CSSProperties = { display: 'grid', gap: 12 };
const coverageCard: CSSProperties = { display: 'grid', gap: 12, padding: 14, border: '1px solid #cbd8e2', borderRadius: 10, background: 'white' };
const windowHeader: CSSProperties = { display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' };
const label: CSSProperties = { display: 'grid', gap: 5, color: '#485b6b', fontSize: 12, fontWeight: 900 };
const input: CSSProperties = { minHeight: 44, padding: '0 10px', border: '1px solid #cbd5dd', borderRadius: 8, background: 'white', color: '#172536', fontSize: 16 };
const dayGrid: CSSProperties = { marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(74px,1fr))', gap: 8 };
const dayChip: CSSProperties = { minHeight: 44, border: '1px solid', borderRadius: 9, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 850 };
const timeGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 };
const statusPill: CSSProperties = { display: 'grid', gap: 2, minWidth: 132, padding: '8px 10px', border: '1px solid #9fcfb0', borderRadius: 9, background: '#f1faf4', fontSize: 11 };
const savedBox: CSSProperties = { padding: 12, border: '1px solid #d6e0e7', borderRadius: 9, background: '#f9fbfc' };
const rotationNotice: CSSProperties = { padding: 12, border: '1px solid #b9cde0', borderRadius: 9, background: '#f2f7fb', color: '#27445d' };
const inactiveNotice: CSSProperties = { padding: '9px 10px', border: '1px solid #e2bd73', borderRadius: 8, background: '#fff8e8', color: '#76530d', fontSize: 12 };
const notice: CSSProperties = { marginTop: 12, padding: '10px 11px', border: '1px solid #d8c17b', borderRadius: 8, background: '#fffdf2', fontSize: 13 };
const empty: CSSProperties = { padding: 18, border: '1px dashed #cbd5dd', borderRadius: 10, color: '#64748b', textAlign: 'center' };
const primaryButton: CSSProperties = { minHeight: 44, border: 0, borderRadius: 8, padding: '9px 13px', background: '#0d1b2b', color: 'white', fontWeight: 900, width: 'fit-content' };
const secondaryButton: CSSProperties = { minHeight: 42, border: '1px solid #9fb3c4', borderRadius: 8, padding: '8px 12px', background: '#f7fafc', color: '#17324a', fontWeight: 900, width: 'fit-content' };
const removeButton: CSSProperties = { minHeight: 42, border: '1px solid #d1a1a1', borderRadius: 8, padding: '8px 11px', background: '#fff7f7', color: '#8a2f2f', fontWeight: 900, width: 'fit-content' };
const linkButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 11px', border: '1px solid #cbd5dd', borderRadius: 8, color: '#17324a', background: 'white', textDecoration: 'none', fontWeight: 850, fontSize: 12 };
