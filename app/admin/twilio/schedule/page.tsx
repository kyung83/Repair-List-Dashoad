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

type AwayPeriod = {
  id: number;
  contactId: number;
  startDate: string;
  endDate: string;
  backupContactId: number | null;
  backupLabel: string;
  label: string;
  awayNow: boolean;
  updatedAt: string;
};

type CoveringFor = { contactId: number; label: string };

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
  normalAllowedNow: boolean;
  awayPeriods: AwayPeriod[];
  awayNow: boolean;
  activeAwayPeriod: AwayPeriod | null;
  coveringFor: CoveringFor[];
  updatedAt: string;
};

type ApiContactSchedule = Partial<ContactSchedule> & Pick<ContactSchedule, 'contactId' | 'label' | 'phone' | 'active' | 'mode'>;
type ApiResult = {
  contacts?: ApiContactSchedule[];
  ok?: boolean;
  message?: string;
  error?: string;
};
type TwilioConnection = { configured: boolean; enabled: boolean };
type TwilioResult = { connection?: TwilioConnection; status?: { connection?: TwilioConnection }; ok?: boolean; message?: string; error?: string };
type AwayDraft = { startDate: string; endDate: string; backupContactId: string; label: string };

const DAYS = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

function localDateKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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
    contactId: Number(contact.contactId),
    label: String(contact.label || ''),
    phone: String(contact.phone || ''),
    active: Boolean(contact.active),
    mode: contact.mode,
    windows: savedWindows.length ? savedWindows : contact.mode === 'custom' ? [legacyWindow] : [],
    days: Array.isArray(contact.days) ? contact.days : [],
    startTime: contact.startTime || '08:00',
    endTime: contact.endTime || '17:00',
    weekInterval: contact.weekInterval === 2 ? 2 : 1,
    activeThisWeek: contact.activeThisWeek !== false,
    anchorWeekStart: contact.anchorWeekStart || '',
    timezone: contact.timezone || 'America/Detroit',
    allowedNow: Boolean(contact.allowedNow),
    normalAllowedNow: Boolean(contact.normalAllowedNow),
    awayPeriods: Array.isArray(contact.awayPeriods) ? contact.awayPeriods : [],
    awayNow: Boolean(contact.awayNow),
    activeAwayPeriod: contact.activeAwayPeriod || null,
    coveringFor: Array.isArray(contact.coveringFor) ? contact.coveringFor : [],
    updatedAt: contact.updatedAt || '',
  };
}

function statusText(contact: ContactSchedule) {
  if (!contact.active) return 'INACTIVE';
  if (contact.awayNow) return 'ON VACATION';
  if (contact.coveringFor.length) return `COVERING: ${contact.coveringFor.map(item => item.label).join(', ')}`;
  if (contact.mode === 'default') return 'TEXTS PAUSED';
  return contact.allowedNow ? 'TEXTS ALLOWED' : 'OFF SCHEDULE';
}

function normalScheduleText(contact: ContactSchedule) {
  if (contact.mode === 'default') return 'Paused';
  if (contact.mode === 'always') return 'Always';
  if (!contact.windows.length) return 'No windows';
  return `${contact.windows.length} coverage window${contact.windows.length === 1 ? '' : 's'}`;
}

function nextAway(contact: ContactSchedule) {
  const today = localDateKey();
  return contact.awayPeriods.find(period => period.awayNow)
    || contact.awayPeriods.find(period => period.endDate >= today)
    || null;
}

function awayRange(period: AwayPeriod) {
  return `${period.startDate} → ${period.endDate}`;
}

function emptyAwayDraft(): AwayDraft {
  return { startDate: '', endDate: '', backupContactId: '', label: 'Vacation / Away' };
}

export default function BreakdownTextSchedulePage() {
  const [contacts, setContacts] = useState<ContactSchedule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [twilio, setTwilio] = useState<TwilioConnection | null>(null);
  const [awayDrafts, setAwayDrafts] = useState<Record<number, AwayDraft>>({});

  function applyContacts(value: ApiContactSchedule[]) {
    setContacts(value.map(hydrateContact));
  }

  async function load() {
    const [scheduleResponse, twilioResponse] = await Promise.all([
      fetch('/api/admin/twilio/schedule', { cache: 'no-store' }),
      fetch('/api/admin/twilio', { cache: 'no-store' }),
    ]);
    const result = await scheduleResponse.json() as ApiResult;
    const twilioResult = await twilioResponse.json() as TwilioResult;
    if (scheduleResponse.status === 401 || twilioResponse.status === 401) {
      window.location.assign('/login?returnTo=/admin/twilio/schedule');
      return;
    }
    if (!scheduleResponse.ok || !Array.isArray(result.contacts)) {
      throw new Error(result.error || 'Breakdown text schedules could not be loaded.');
    }
    applyContacts(result.contacts);
    if (twilioResponse.ok && twilioResult.connection) setTwilio(twilioResult.connection);
    setLoaded(true);
  }

  useEffect(() => {
    void load().catch(error => {
      setLoaded(true);
      setMessage(error instanceof Error ? error.message : 'Breakdown text schedules could not be loaded.');
    });
  }, []);

  async function toggleGlobalTexting() {
    if (!twilio?.configured) return;
    setBusy('global');
    setMessage('');
    try {
      const response = await fetch('/api/admin/twilio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set-enabled', enabled: !twilio.enabled }),
      });
      const result = await response.json() as TwilioResult;
      if (!response.ok || !result.ok) throw new Error(result.error || 'Breakdown texting could not be changed.');
      const updated = result.status?.connection;
      if (updated) setTwilio(updated);
      setMessage(result.message || 'Breakdown texting updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown texting could not be changed.');
    } finally {
      setBusy('');
    }
  }

  function changeContactMode(contactId: number, mode: ContactScheduleMode) {
    setContacts(current => current.map(contact => {
      if (contact.contactId !== contactId) return contact;
      const windows = mode === 'custom' && contact.windows.length === 0 ? [newCoverageWindow(1)] : contact.windows;
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
          const days = exists ? coverage.days.filter(item => item !== day) : [...coverage.days, day].sort((a, b) => a - b);
          return { ...coverage, days };
        }),
      };
    }));
  }

  function addWindow(contactId: number) {
    setContacts(current => current.map(contact => {
      if (contact.contactId !== contactId || contact.windows.length >= MAX_PERSONAL_WINDOWS) return contact;
      return { ...contact, windows: [...contact.windows, newCoverageWindow(contact.windows.length + 1)] };
    }));
  }

  function removeWindow(contactId: number, windowId: number) {
    setContacts(current => current.map(contact => contact.contactId === contactId ? {
      ...contact,
      windows: contact.windows.filter(coverage => coverage.id !== windowId),
    } : contact));
  }

  function patchAwayDraft(contactId: number, patch: Partial<AwayDraft>) {
    setAwayDrafts(current => ({
      ...current,
      [contactId]: { ...(current[contactId] || emptyAwayDraft()), ...patch },
    }));
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

  async function saveAway(contact: ContactSchedule) {
    const draft = awayDrafts[contact.contactId] || emptyAwayDraft();
    if (!draft.startDate || !draft.endDate) {
      setMessage(`Choose vacation start and end dates for ${contact.label}.`);
      return;
    }
    const busyKey = `away-${contact.contactId}`;
    setBusy(busyKey);
    setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save-away',
          contactId: contact.contactId,
          startDate: draft.startDate,
          endDate: draft.endDate,
          backupContactId: draft.backupContactId ? Number(draft.backupContactId) : null,
          awayLabel: draft.label,
        }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok || !Array.isArray(result.contacts)) {
        throw new Error(result.error || `Vacation coverage for ${contact.label} could not be saved.`);
      }
      applyContacts(result.contacts);
      setAwayDrafts(current => ({ ...current, [contact.contactId]: emptyAwayDraft() }));
      setMessage(result.message || `Vacation coverage saved for ${contact.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Vacation coverage for ${contact.label} could not be saved.`);
    } finally {
      setBusy('');
    }
  }

  async function removeAway(contact: ContactSchedule, period: AwayPeriod) {
    if (!window.confirm(`Cancel ${period.label} for ${contact.label} (${awayRange(period)})?`)) return;
    const busyKey = `remove-away-${period.id}`;
    setBusy(busyKey);
    setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'remove-away', contactId: contact.contactId, awayId: period.id }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok || !Array.isArray(result.contacts)) {
        throw new Error(result.error || `Vacation coverage for ${contact.label} could not be canceled.`);
      }
      applyContacts(result.contacts);
      setMessage(result.message || `Vacation coverage canceled for ${contact.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Vacation coverage for ${contact.label} could not be canceled.`);
    } finally {
      setBusy('');
    }
  }

  return <section style={{ background: '#f3f5f7', padding: '0 clamp(16px,4vw,46px) 28px', color: '#182331' }}>
    <div style={rowWrap}>
      <div>
        <div style={eyebrow}>DIAGNOSTICS · BREAKDOWN TEXTING</div>
        <h2 style={heading}>Individual Breakdown Text Schedules</h2>
        <p style={copy}>Set each person’s normal coverage, vacation / away dates, and backup. Breakdown email still sends immediately.</p>
      </div>
      <a href="/admin/twilio" style={linkButton}>Manage People & Twilio</a>
    </div>

    {message && <div style={notice}>{message}</div>}

    <div style={{ ...card, marginTop: 16, borderColor: twilio?.enabled ? '#9fcfb0' : '#e5b765', background: twilio?.enabled ? '#f4fbf6' : '#fff9ed' }}>
      <div style={rowWrap}>
        <div>
          <div style={eyebrow}>TWILIO TEXTING STATUS</div>
          <h3 style={subheading}>{twilio?.enabled ? 'Live Texts Enabled' : twilio?.configured ? 'Live Texts Paused' : 'Twilio Not Connected'}</h3>
          <p style={copy}>Use the global switch only when nobody should receive breakdown texts. Vacation coverage below changes one person at a time.</p>
        </div>
        {twilio?.configured && <button type="button" disabled={Boolean(busy)} onClick={() => void toggleGlobalTexting()} style={twilio.enabled ? pauseButton : primaryButton}>
          {busy === 'global' ? 'Saving…' : twilio.enabled ? 'Pause Live Texts' : 'Enable Live Texts'}
        </button>}
      </div>
    </div>

    <div style={{ ...card, marginTop: 16, borderColor: '#d7e0e6', background: '#fff' }}>
      <div style={eyebrow}>BREAKDOWN PEOPLE</div>
      <h3 style={subheading}>Who is receiving texts and who is covering</h3>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={summaryTable}>
          <thead><tr><th style={summaryTh}>Name</th><th style={summaryTh}>Normal Schedule</th><th style={summaryTh}>Vacation / Away</th><th style={summaryTh}>Backup</th><th style={summaryTh}>Status</th></tr></thead>
          <tbody>{contacts.map(contact => {
            const away = nextAway(contact);
            return <tr key={contact.contactId}>
              <td style={summaryTd}><strong>{contact.label}</strong><div style={muted}>{contact.phone}</div></td>
              <td style={summaryTd}>{normalScheduleText(contact)}</td>
              <td style={summaryTd}>{away ? <><strong>{away.awayNow ? 'Away now' : 'Scheduled'}</strong><div style={muted}>{awayRange(away)}</div></> : '—'}</td>
              <td style={summaryTd}>{away?.backupLabel || '—'}</td>
              <td style={summaryTd}><span style={{ ...miniPill, background: contact.awayNow ? '#fff0ed' : contact.allowedNow ? '#eaf8ef' : '#eef2f5' }}>{statusText(contact)}</span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>

    <div style={{ ...card, marginTop: 16, borderColor: '#b9cde0', background: '#f5f9fc' }}>
      <div style={eyebrow}>HOW IT WORKS</div>
      <h3 style={subheading}>One person’s hours never change another person’s hours</h3>
      <div style={explanationGrid}>
        <div style={infoBox}><strong>Normal schedule</strong><span>Give each person their own weekly and on-call coverage windows.</span></div>
        <div style={infoBox}><strong>Vacation / Away</strong><span>The person stops receiving new breakdown alerts only for the dates you enter.</span></div>
        <div style={infoBox}><strong>Automatic backup</strong><span>The backup inherits the away person’s normal alert window, then coverage returns automatically after vacation.</span></div>
      </div>
    </div>

    <div style={{ ...card, marginTop: 16, borderColor: '#d7e0e6', background: '#fff' }}>
      <div style={eyebrow}>BREAKDOWN TEXT USERS</div>
      <h3 style={subheading}>Set each person separately</h3>
      <p style={copy}>Use as many windows as needed for regular hours, early or late coverage, weekends, and every-other-week on-call.</p>

      <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
        {contacts.map(contact => {
          const busyKey = `contact-${contact.contactId}`;
          const awayBusyKey = `away-${contact.contactId}`;
          const status = statusText(contact);
          const statusAllowed = contact.active && contact.allowedNow;
          const draft = awayDrafts[contact.contactId] || emptyAwayDraft();
          const activePeriods = contact.awayPeriods.filter(period => period.endDate >= localDateKey() || period.awayNow);
          return <article key={contact.contactId} style={{ ...personCard, opacity: contact.active ? 1 : .68 }}>
            <div style={rowWrap}>
              <div>
                <strong style={{ fontSize: 18 }}>{contact.label}</strong>
                <div style={{ marginTop: 3, color: '#64748b', fontSize: 13 }}>{contact.phone}</div>
                {contact.coveringFor.length > 0 && <div style={coveringNotice}>Backup coverage active for {contact.coveringFor.map(item => item.label).join(', ')}.</div>}
              </div>
              <div style={{
                ...statusPill,
                borderColor: contact.awayNow ? '#e6a899' : statusAllowed ? '#9fcfb0' : '#e5b765',
                background: contact.awayNow ? '#fff2ef' : statusAllowed ? '#f1faf4' : '#fff8e8',
              }}>
                <span>{contact.active ? 'Right now' : 'Status'}</span>
                <strong>{status}</strong>
              </div>
            </div>

            {!contact.active && <div style={inactiveNotice}>This person is inactive on the Breakdown Text Users page and will not receive texts until reactivated.</div>}
            {contact.awayNow && contact.activeAwayPeriod && <div style={awayNowNotice}>
              <strong>Vacation / Away is active through {contact.activeAwayPeriod.endDate}.</strong>
              <span>{contact.activeAwayPeriod.backupLabel ? `${contact.activeAwayPeriod.backupLabel} is covering this person’s normal text window.` : 'No backup is assigned for this away period.'}</span>
            </div>}

            <div style={sectionBlock}>
              <div>
                <div style={eyebrow}>NORMAL SCHEDULE</div>
                <strong>Texting for this person</strong>
              </div>
              <select style={input} value={contact.mode} onChange={(event: ChangeEvent<HTMLSelectElement>) => changeContactMode(contact.contactId, event.target.value as ContactScheduleMode)}>
                <option value="default">Pause scheduled breakdown texts</option>
                <option value="always">Always text this person</option>
                <option value="custom">Use this person’s coverage windows</option>
              </select>

              {contact.mode === 'default' && <div style={savedBox}>
                <strong>Scheduled texts are paused</strong>
                <p style={smallCopy}>This person will not receive new breakdown alert texts until Always or Coverage Windows is selected. Their saved windows can remain for later use.</p>
              </div>}

              {contact.mode === 'always' && <div style={savedBox}>
                <strong>Always text this person</strong>
                <p style={smallCopy}>When Twilio is enabled and this user is active, this person receives every new breakdown alert at any time unless Vacation / Away is active.</p>
              </div>}

              {contact.mode === 'custom' && <>
                <div style={savedBox}>
                  <strong>Only this person’s windows apply</strong>
                  <p style={smallCopy}>A text is sent when any one of the windows below is active. Other people’s normal schedules do not affect this person.</p>
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
            </div>

            <div style={awayPanel}>
              <div>
                <div style={eyebrow}>VACATION / AWAY</div>
                <strong>Temporarily hand this person’s breakdown texts to a backup</strong>
                <p style={smallCopy}>Their normal schedule stays saved. The backup receives only the alerts this person normally would have received during these dates. After the end date, normal coverage resumes automatically.</p>
              </div>

              <div style={awayGrid}>
                <label style={label}>Start date<input type="date" style={input} value={draft.startDate} onChange={(event: ChangeEvent<HTMLInputElement>) => patchAwayDraft(contact.contactId, { startDate: event.target.value })} /></label>
                <label style={label}>End date<input type="date" style={input} value={draft.endDate} onChange={(event: ChangeEvent<HTMLInputElement>) => patchAwayDraft(contact.contactId, { endDate: event.target.value })} /></label>
                <label style={label}>Backup person
                  <select style={input} value={draft.backupContactId} onChange={(event: ChangeEvent<HTMLSelectElement>) => patchAwayDraft(contact.contactId, { backupContactId: event.target.value })}>
                    <option value="">No backup</option>
                    {contacts.filter(option => option.contactId !== contact.contactId && option.active).map(option => <option key={option.contactId} value={option.contactId}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <label style={label}>Away label<input style={input} maxLength={80} value={draft.label} onChange={(event: ChangeEvent<HTMLInputElement>) => patchAwayDraft(contact.contactId, { label: event.target.value })} placeholder="Vacation / Away" /></label>

              <button type="button" disabled={Boolean(busy) || !contact.active} onClick={() => void saveAway(contact)} style={vacationButton}>
                {busy === awayBusyKey ? 'Saving Vacation…' : 'Save Vacation / Away'}
              </button>

              {activePeriods.length > 0 && <div style={periodList}>
                <strong>Current / upcoming away periods</strong>
                {activePeriods.map(period => <div key={period.id} style={periodRow}>
                  <div>
                    <strong>{period.label}</strong>
                    <div style={muted}>{awayRange(period)}{period.awayNow ? ' · AWAY NOW' : ''}</div>
                    <div style={muted}>Backup: {period.backupLabel || 'None'}</div>
                  </div>
                  <button type="button" disabled={Boolean(busy)} onClick={() => void removeAway(contact, period)} style={removeButton}>
                    {busy === `remove-away-${period.id}` ? 'Canceling…' : 'Cancel Away'}
                  </button>
                </div>)}
              </div>}
            </div>
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
const muted: CSSProperties = { marginTop: 3, color: '#6b7b89', fontSize: 12 };
const rowWrap: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' };
const explanationGrid: CSSProperties = { marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 };
const infoBox: CSSProperties = { display: 'grid', gap: 5, padding: 12, border: '1px solid #cbd9e5', borderRadius: 9, background: 'white', color: '#42576a', fontSize: 13 };
const personCard: CSSProperties = { padding: 16, border: '1px solid #dce2e7', borderRadius: 12, background: '#fbfcfd', display: 'grid', gap: 14 };
const sectionBlock: CSSProperties = { display: 'grid', gap: 12, padding: 14, border: '1px solid #dce2e7', borderRadius: 10, background: '#fff' };
const windowList: CSSProperties = { display: 'grid', gap: 12 };
const coverageCard: CSSProperties = { display: 'grid', gap: 12, padding: 14, border: '1px solid #cbd8e2', borderRadius: 10, background: 'white' };
const windowHeader: CSSProperties = { display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' };
const label: CSSProperties = { display: 'grid', gap: 5, color: '#485b6b', fontSize: 12, fontWeight: 900 };
const input: CSSProperties = { minHeight: 44, padding: '0 10px', border: '1px solid #cbd5dd', borderRadius: 8, background: 'white', color: '#172536', fontSize: 16, boxSizing: 'border-box', width: '100%' };
const dayGrid: CSSProperties = { marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(74px,1fr))', gap: 8 };
const dayChip: CSSProperties = { minHeight: 44, border: '1px solid', borderRadius: 9, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 850 };
const timeGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 };
const statusPill: CSSProperties = { display: 'grid', gap: 2, minWidth: 150, padding: '8px 10px', border: '1px solid #9fcfb0', borderRadius: 9, background: '#f1faf4', fontSize: 11 };
const savedBox: CSSProperties = { padding: 12, border: '1px solid #d6e0e7', borderRadius: 9, background: '#f9fbfc' };
const rotationNotice: CSSProperties = { padding: 12, border: '1px solid #b9cde0', borderRadius: 9, background: '#f2f7fb', color: '#27445d' };
const inactiveNotice: CSSProperties = { padding: '9px 10px', border: '1px solid #e2bd73', borderRadius: 8, background: '#fff8e8', color: '#76530d', fontSize: 12 };
const awayNowNotice: CSSProperties = { padding: '11px 12px', border: '1px solid #e6a899', borderRadius: 9, background: '#fff2ef', color: '#7b3026', display: 'grid', gap: 4, fontSize: 13 };
const coveringNotice: CSSProperties = { marginTop: 7, display: 'inline-flex', padding: '5px 8px', borderRadius: 999, background: '#eaf8ef', color: '#1f6a3b', fontSize: 11, fontWeight: 900 };
const awayPanel: CSSProperties = { display: 'grid', gap: 12, padding: 14, border: '1px solid #efb4aa', borderRadius: 10, background: '#fff8f6' };
const awayGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 };
const periodList: CSSProperties = { display: 'grid', gap: 8, paddingTop: 4 };
const periodRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: 10, border: '1px solid #e8c9c2', borderRadius: 8, background: '#fff' };
const notice: CSSProperties = { marginTop: 12, padding: '10px 11px', border: '1px solid #d8c17b', borderRadius: 8, background: '#fffdf2', fontSize: 13 };
const empty: CSSProperties = { padding: 18, border: '1px dashed #cbd5dd', borderRadius: 10, color: '#64748b', textAlign: 'center' };
const primaryButton: CSSProperties = { minHeight: 44, border: 0, borderRadius: 8, padding: '9px 13px', background: '#0d1b2b', color: 'white', fontWeight: 900, width: 'fit-content', cursor: 'pointer' };
const secondaryButton: CSSProperties = { minHeight: 42, border: '1px solid #9fb3c4', borderRadius: 8, padding: '8px 12px', background: '#f7fafc', color: '#17324a', fontWeight: 900, width: 'fit-content' };
const removeButton: CSSProperties = { minHeight: 40, border: '1px solid #d1a1a1', borderRadius: 8, padding: '8px 11px', background: '#fff7f7', color: '#8a2f2f', fontWeight: 900, width: 'fit-content' };
const vacationButton: CSSProperties = { minHeight: 44, border: 0, borderRadius: 8, padding: '9px 13px', background: '#b74834', color: 'white', fontWeight: 900, width: 'fit-content' };
const pauseButton: CSSProperties = { minHeight: 44, border: '1px solid #c85142', borderRadius: 8, padding: '9px 13px', background: '#fff', color: '#a83226', fontWeight: 900, width: 'fit-content' };
const linkButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 11px', border: '1px solid #cbd5dd', borderRadius: 8, color: '#17324a', background: 'white', textDecoration: 'none', fontWeight: 850, fontSize: 12 };
const summaryTable: CSSProperties = { width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 };
const summaryTh: CSSProperties = { textAlign: 'left', padding: '9px 10px', borderBottom: '1px solid #dce3e8', color: '#4f6272', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' };
const summaryTd: CSSProperties = { padding: '11px 10px', borderBottom: '1px solid #edf1f4', verticalAlign: 'top' };
const miniPill: CSSProperties = { display: 'inline-flex', padding: '5px 8px', borderRadius: 999, fontSize: 10, fontWeight: 950, whiteSpace: 'nowrap' };
