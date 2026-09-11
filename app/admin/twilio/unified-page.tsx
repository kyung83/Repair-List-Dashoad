'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from 'react';

type WeekInterval = 1 | 2;
type ContactScheduleMode = 'default' | 'always' | 'custom';

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

type ScheduleResult = {
  contacts?: Partial<ContactSchedule>[];
  ok?: boolean;
  message?: string;
  error?: string;
};

type Connection = {
  configured: boolean;
  enabled: boolean;
  accountSid: string;
  sender: string;
  updatedAt: string;
};

type Template = {
  key: string;
  label: string;
  body: string;
  active: boolean;
  updatedAt: string;
};

type AdminContact = {
  id: number;
  label: string;
  phone: string;
  active: boolean;
};

type AdminStatus = {
  connection: Connection;
  templates: Template[];
  contacts: AdminContact[];
  webhookUrl: string;
  error?: string;
};

type AdminResult = {
  ok?: boolean;
  message?: string;
  error?: string;
  status?: AdminStatus;
};

type AwayDraft = {
  startDate: string;
  endDate: string;
  backupContactId: string;
  label: string;
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

let nextTemporaryWindowId = -1;

function localDateKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function emptyAwayDraft(): AwayDraft {
  return { startDate: '', endDate: '', backupContactId: '', label: 'Vacation / Away' };
}

function newCoverageWindow(number: number): CoverageWindow {
  return {
    id: nextTemporaryWindowId--,
    label: number === 1 ? 'Office Hours' : `Coverage Window ${number}`,
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

function hydrateContact(value: Partial<ContactSchedule>): ContactSchedule {
  const windows = Array.isArray(value.windows) ? value.windows as CoverageWindow[] : [];
  return {
    contactId: Number(value.contactId || 0),
    label: String(value.label || ''),
    phone: String(value.phone || ''),
    active: Boolean(value.active),
    mode: value.mode === 'always' || value.mode === 'custom' ? value.mode : 'default',
    windows,
    days: Array.isArray(value.days) ? value.days.map(Number) : [],
    startTime: String(value.startTime || '08:00'),
    endTime: String(value.endTime || '17:00'),
    weekInterval: value.weekInterval === 2 ? 2 : 1,
    activeThisWeek: value.activeThisWeek !== false,
    anchorWeekStart: String(value.anchorWeekStart || ''),
    timezone: String(value.timezone || 'America/Detroit'),
    allowedNow: Boolean(value.allowedNow),
    normalAllowedNow: Boolean(value.normalAllowedNow),
    awayPeriods: Array.isArray(value.awayPeriods) ? value.awayPeriods as AwayPeriod[] : [],
    awayNow: Boolean(value.awayNow),
    activeAwayPeriod: value.activeAwayPeriod ? value.activeAwayPeriod as AwayPeriod : null,
    coveringFor: Array.isArray(value.coveringFor) ? value.coveringFor as CoveringFor[] : [],
    updatedAt: String(value.updatedAt || ''),
  };
}

function timeLabel(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return value || '—';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function daysLabel(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join(',') === '1,2,3,4,5') return 'Mon–Fri';
  if (sorted.join(',') === '0,1,2,3,4,5,6') return 'Every day';
  return sorted.map(day => DAYS.find(item => item.id === day)?.label || '').filter(Boolean).join(', ') || 'No days';
}

function windowSummary(window: CoverageWindow) {
  const rotation = window.weekInterval === 2
    ? `Every other week · ${window.activeThisWeek ? 'ON this week' : 'OFF this week'}`
    : 'Every week';
  return `${daysLabel(window.days)} · ${timeLabel(window.startTime)}–${timeLabel(window.endTime)} · ${rotation}`;
}

function awayRange(period: AwayPeriod) {
  return `${period.startDate} → ${period.endDate}`;
}

function statusText(contact: ContactSchedule) {
  if (!contact.active) return 'INACTIVE';
  if (contact.awayNow) return 'ON VACATION';
  if (contact.coveringFor.length && contact.allowedNow) return 'RECEIVING + COVERING';
  if (contact.coveringFor.length) return 'COVERING';
  if (contact.allowedNow) return 'RECEIVING';
  if (contact.mode === 'default') return 'TEXTS PAUSED';
  return 'OFF SCHEDULE';
}

function statusTone(contact: ContactSchedule) {
  if (!contact.active) return { background: '#eef2f5', color: '#5d6a75', borderColor: '#d8e0e5' };
  if (contact.awayNow) return { background: '#fff1ee', color: '#8a372a', borderColor: '#e6afa5' };
  if (contact.allowedNow) return { background: '#edf8f0', color: '#21673a', borderColor: '#a8d2b5' };
  return { background: '#fff8e8', color: '#7b590d', borderColor: '#e7c77e' };
}

export default function UnifiedBreakdownTextingPage() {
  const [contacts, setContacts] = useState<ContactSchedule[]>([]);
  const [admin, setAdmin] = useState<AdminStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [openSchedule, setOpenSchedule] = useState<number | null>(null);
  const [openAway, setOpenAway] = useState<number | null>(null);
  const [openPerson, setOpenPerson] = useState<number | null>(null);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [awayDrafts, setAwayDrafts] = useState<Record<number, AwayDraft>>({});
  const [newLabel, setNewLabel] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [sender, setSender] = useState('');
  const [editingConnection, setEditingConnection] = useState(false);
  const [testPhone, setTestPhone] = useState('');

  const today = localDateKey();

  async function load() {
    const [scheduleResponse, adminResponse] = await Promise.all([
      fetch('/api/admin/twilio/schedule', { cache: 'no-store' }),
      fetch('/api/admin/twilio', { cache: 'no-store' }),
    ]);
    const schedule = await scheduleResponse.json() as ScheduleResult;
    const adminStatus = await adminResponse.json() as AdminStatus;
    if (scheduleResponse.status === 401 || adminResponse.status === 401) {
      window.location.assign('/login?returnTo=/admin/twilio');
      return;
    }
    if (!scheduleResponse.ok || !Array.isArray(schedule.contacts)) {
      throw new Error(schedule.error || 'Breakdown text coverage could not be loaded.');
    }
    if (!adminResponse.ok) throw new Error(adminStatus.error || 'Twilio settings could not be loaded.');
    setContacts(schedule.contacts.map(hydrateContact));
    setAdmin(adminStatus);
    setAccountSid(current => current || adminStatus.connection.accountSid || '');
    setSender(current => current || adminStatus.connection.sender || '');
    setLoaded(true);
  }

  useEffect(() => {
    void load().catch(error => {
      setLoaded(true);
      setMessage(error instanceof Error ? error.message : 'Breakdown texting could not be loaded.');
    });
  }, []);

  const contactById = useMemo(() => new Map(contacts.map(contact => [contact.contactId, contact])), [contacts]);

  function activeCoverageNames(contact: ContactSchedule | undefined) {
    if (!contact) return '';
    if (contact.mode === 'always') return 'Always';
    return contact.windows.filter(window => window.allowedNow).map(window => window.label || 'Coverage').join(', ');
  }

  function coveringText(contact: ContactSchedule) {
    return contact.coveringFor.map(item => {
      const primary = contactById.get(item.contactId);
      const activeNames = activeCoverageNames(primary);
      return activeNames ? `${item.label} — ${activeNames}` : item.label;
    }).join('; ');
  }

  function patchContact(contactId: number, patch: Partial<ContactSchedule>) {
    setContacts(current => current.map(contact => contact.contactId === contactId ? { ...contact, ...patch } : contact));
  }

  function changeContactMode(contactId: number, mode: ContactScheduleMode) {
    setContacts(current => current.map(contact => {
      if (contact.contactId !== contactId) return contact;
      return {
        ...contact,
        mode,
        windows: mode === 'custom' && contact.windows.length === 0 ? [newCoverageWindow(1)] : contact.windows,
      };
    }));
  }

  function patchWindow(contactId: number, windowId: number, patch: Partial<CoverageWindow>) {
    setContacts(current => current.map(contact => contact.contactId === contactId ? {
      ...contact,
      windows: contact.windows.map(window => window.id === windowId ? { ...window, ...patch } : window),
    } : contact));
  }

  function toggleWindowDay(contactId: number, windowId: number, day: number) {
    setContacts(current => current.map(contact => {
      if (contact.contactId !== contactId) return contact;
      return {
        ...contact,
        windows: contact.windows.map(window => {
          if (window.id !== windowId) return window;
          const days = window.days.includes(day)
            ? window.days.filter(item => item !== day)
            : [...window.days, day].sort((a, b) => a - b);
          return { ...window, days };
        }),
      };
    }));
  }

  function addWindow(contactId: number) {
    setContacts(current => current.map(contact => contact.contactId === contactId ? {
      ...contact,
      windows: [...contact.windows, newCoverageWindow(contact.windows.length + 1)],
    } : contact));
  }

  function removeWindow(contactId: number, windowId: number) {
    setContacts(current => current.map(contact => contact.contactId === contactId ? {
      ...contact,
      windows: contact.windows.filter(window => window.id !== windowId),
    } : contact));
  }

  function patchAwayDraft(contactId: number, patch: Partial<AwayDraft>) {
    setAwayDrafts(current => ({
      ...current,
      [contactId]: { ...(current[contactId] || emptyAwayDraft()), ...patch },
    }));
  }

  async function postAdmin(action: string, extra: Record<string, unknown> = {}) {
    const response = await fetch('/api/admin/twilio', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    const result = await response.json() as AdminResult;
    if (!response.ok || !result.ok) throw new Error(result.error || 'Breakdown texting action failed.');
    if (result.status) {
      setAdmin(result.status);
      setAccountSid(result.status.connection.accountSid || '');
      setSender(result.status.connection.sender || '');
    }
    if (result.message) setMessage(result.message);
    return result;
  }

  async function toggleGlobalTexting() {
    if (!admin?.connection.configured) return;
    setBusy('global'); setMessage('');
    try {
      await postAdmin('set-enabled', { enabled: !admin.connection.enabled });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Live breakdown texting could not be changed.');
    } finally { setBusy(''); }
  }

  async function savePerson(contact: ContactSchedule) {
    setBusy(`person-${contact.contactId}`); setMessage('');
    try {
      await postAdmin('update-contact', {
        contactId: contact.contactId,
        contactLabel: contact.label,
        contactPhone: contact.phone,
        contactActive: contact.active,
      });
      await load();
      setOpenPerson(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown person could not be saved.');
    } finally { setBusy(''); }
  }

  async function addPerson() {
    if (!newLabel.trim() || !newPhone.trim()) {
      setMessage('Enter the person’s name and mobile number.');
      return;
    }
    setBusy('add-person'); setMessage('');
    try {
      await postAdmin('add-contact', { contactLabel: newLabel, contactPhone: newPhone, contactActive: true });
      setNewLabel(''); setNewPhone(''); setShowAddPerson(false);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown person could not be added.');
    } finally { setBusy(''); }
  }

  async function removePerson(contact: ContactSchedule) {
    if (!window.confirm(`Remove ${contact.label || contact.phone} from breakdown texts?`)) return;
    setBusy(`remove-person-${contact.contactId}`); setMessage('');
    try {
      await postAdmin('remove-contact', { contactId: contact.contactId });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Breakdown person could not be removed.');
    } finally { setBusy(''); }
  }

  async function saveSchedule(contact: ContactSchedule) {
    if (contact.mode === 'custom' && contact.windows.some(window => window.days.length === 0)) {
      setMessage(`Choose at least one day for every coverage window for ${contact.label}.`);
      return;
    }
    setBusy(`schedule-${contact.contactId}`); setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save-contact', contactId: contact.contactId, mode: contact.mode,
          windows: contact.windows.map(window => ({
            label: window.label,
            days: window.days,
            startTime: window.startTime,
            endTime: window.endTime,
            weekInterval: window.weekInterval,
            activeThisWeek: window.activeThisWeek,
          })),
        }),
      });
      const result = await response.json() as ScheduleResult;
      if (!response.ok || !result.ok || !Array.isArray(result.contacts)) {
        throw new Error(result.error || `The schedule for ${contact.label} could not be saved.`);
      }
      setContacts(result.contacts.map(hydrateContact));
      setMessage(result.message || `Schedule saved for ${contact.label}.`);
      setOpenSchedule(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The schedule for ${contact.label} could not be saved.`);
    } finally { setBusy(''); }
  }

  async function saveAway(contact: ContactSchedule) {
    const draft = awayDrafts[contact.contactId] || emptyAwayDraft();
    if (!draft.startDate || !draft.endDate) {
      setMessage(`Choose vacation start and end dates for ${contact.label}.`);
      return;
    }
    setBusy(`away-${contact.contactId}`); setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save-away',
          contactId: contact.contactId,
          startDate: draft.startDate,
          endDate: draft.endDate,
          backupContactId: draft.backupContactId ? Number(draft.backupContactId) : null,
          awayLabel: draft.label,
        }),
      });
      const result = await response.json() as ScheduleResult;
      if (!response.ok || !result.ok || !Array.isArray(result.contacts)) {
        throw new Error(result.error || `Vacation coverage for ${contact.label} could not be saved.`);
      }
      setContacts(result.contacts.map(hydrateContact));
      setAwayDrafts(current => ({ ...current, [contact.contactId]: emptyAwayDraft() }));
      setMessage(result.message || `Vacation coverage saved for ${contact.label}.`);
      setOpenAway(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Vacation coverage for ${contact.label} could not be saved.`);
    } finally { setBusy(''); }
  }

  async function removeAway(contact: ContactSchedule, period: AwayPeriod) {
    if (!window.confirm(`Cancel ${period.label} for ${contact.label} (${awayRange(period)})?`)) return;
    setBusy(`remove-away-${period.id}`); setMessage('');
    try {
      const response = await fetch('/api/admin/twilio/schedule', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'remove-away', contactId: contact.contactId, awayId: period.id }),
      });
      const result = await response.json() as ScheduleResult;
      if (!response.ok || !result.ok || !Array.isArray(result.contacts)) {
        throw new Error(result.error || `Vacation coverage for ${contact.label} could not be canceled.`);
      }
      setContacts(result.contacts.map(hydrateContact));
      setMessage(result.message || `Vacation coverage canceled for ${contact.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Vacation coverage for ${contact.label} could not be canceled.`);
    } finally { setBusy(''); }
  }

  function patchTemplate(key: string, patch: Partial<Template>) {
    setAdmin(current => current ? {
      ...current,
      templates: current.templates.map(template => template.key === key ? { ...template, ...patch } : template),
    } : current);
  }

  async function saveTemplate(template: Template) {
    setBusy(`template-${template.key}`); setMessage('');
    try {
      await postAdmin('save-template', {
        templateKey: template.key,
        templateBody: template.body,
        templateActive: template.active,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Text wording could not be saved.');
    } finally { setBusy(''); }
  }

  async function saveConnection() {
    if (!accountSid.trim() || !authToken.trim() || !sender.trim()) {
      setMessage('Enter the Twilio Account SID, Auth Token, and sending number or Messaging Service SID.');
      return;
    }
    setBusy('connection'); setMessage('');
    try {
      await postAdmin('save-connection', {
        accountSid, authToken, sender, enabled: Boolean(admin?.connection.enabled),
      });
      setAuthToken(''); setEditingConnection(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Twilio connection could not be saved.');
    } finally { setBusy(''); }
  }

  async function sendTest() {
    if (!testPhone.trim()) { setMessage('Enter a mobile number for the test text.'); return; }
    setBusy('test'); setMessage('');
    try {
      await postAdmin('test', { testPhone });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Test text could not be sent.');
    } finally { setBusy(''); }
  }

  return <section style={page}>
    <div style={hero}>
      <div>
        <div style={eyebrow}>SETUP · BREAKDOWN TEXTING</div>
        <h1 style={heading}>Breakdown Texting</h1>
        <p style={copy}>Manage who receives breakdown texts, normal office/on-call coverage, vacations, and backup handoffs in one place. Breakdown email still sends immediately.</p>
      </div>
      <div style={liveControl}>
        <span style={{ ...liveDot, background: admin?.connection.enabled ? '#2aa765' : '#c58b1b' }} />
        <div><strong>{admin?.connection.enabled ? 'LIVE TEXTS ON' : admin?.connection.configured ? 'LIVE TEXTS PAUSED' : 'TWILIO NOT CONNECTED'}</strong><div style={muted}>{admin?.connection.enabled ? 'New alerts follow the coverage below.' : 'No live breakdown texts are being sent.'}</div></div>
        {admin?.connection.configured && <button type="button" disabled={Boolean(busy)} onClick={() => void toggleGlobalTexting()} style={admin.connection.enabled ? pauseButton : primaryButton}>
          {busy === 'global' ? 'Saving…' : admin.connection.enabled ? 'Pause Live Texts' : 'Enable Live Texts'}
        </button>}
      </div>
    </div>

    {message && <div style={notice}>{message}</div>}

    <div style={sectionCard}>
      <div style={sectionHeader}>
        <div>
          <div style={eyebrow}>BREAKDOWN PEOPLE</div>
          <h2 style={subheading}>Coverage at a glance</h2>
          <p style={copy}>The cards stay compact. Open Schedule or Vacation only when you need to change something.</p>
        </div>
        <button type="button" onClick={() => setShowAddPerson(value => !value)} style={primaryButton}>{showAddPerson ? 'Cancel' : '+ Add Breakdown Person'}</button>
      </div>

      {showAddPerson && <div style={addPersonBox}>
        <label style={label}>Name<input style={input} value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder="Name" /></label>
        <label style={label}>Mobile number<input style={input} value={newPhone} onChange={event => setNewPhone(event.target.value)} inputMode="tel" placeholder="Mobile number" /></label>
        <button type="button" disabled={Boolean(busy)} onClick={() => void addPerson()} style={primaryButton}>{busy === 'add-person' ? 'Adding…' : 'Add Person'}</button>
      </div>}

      <div style={peopleGrid}>
        {contacts.map(contact => {
          const tone = statusTone(contact);
          const activeNames = activeCoverageNames(contact);
          const covering = coveringText(contact);
          const upcoming = contact.awayPeriods.filter(period => period.endDate >= today || period.awayNow);
          const draft = awayDrafts[contact.contactId] || emptyAwayDraft();
          return <article key={contact.contactId} style={{ ...personCard, opacity: contact.active ? 1 : .72 }}>
            <div style={personTop}>
              <div>
                <strong style={{ fontSize: 19 }}>{contact.label}</strong>
                <div style={muted}>{contact.phone}</div>
              </div>
              <span style={{ ...statusPill, ...tone }}>{statusText(contact)}</span>
            </div>

            {contact.awayNow && contact.activeAwayPeriod && <div style={awayBanner}>
              <strong>Vacation / Away through {contact.activeAwayPeriod.endDate}</strong>
              <span>{contact.activeAwayPeriod.backupLabel ? `${contact.activeAwayPeriod.backupLabel} is covering this person’s normal office/on-call windows.` : 'No backup person is assigned.'}</span>
            </div>}

            {contact.coveringFor.length > 0 && <div style={coverBanner}>
              <strong>Covering now</strong>
              <span>{covering || contact.coveringFor.map(item => item.label).join(', ')}</span>
            </div>}

            <div style={summaryBlock}>
              <div style={summaryRow}><span>Right now</span><strong>{contact.awayNow ? 'Away' : activeNames || (contact.mode === 'always' ? 'Always' : 'Off schedule')}</strong></div>
              <div style={summaryRow}><span>Normal coverage</span><strong>{contact.mode === 'default' ? 'Paused' : contact.mode === 'always' ? 'Always' : `${contact.windows.length} saved window${contact.windows.length === 1 ? '' : 's'}`}</strong></div>
              {contact.windows.map(window => <div key={window.id} style={windowSummaryRow}>
                <div><strong>{window.label || 'Coverage'}</strong><div style={muted}>{windowSummary(window)}</div></div>
                {window.allowedNow && <span style={smallGreenPill}>ACTIVE NOW</span>}
              </div>)}
              <div style={summaryRow}><span>Vacation / Away</span><strong>{upcoming.length ? `${upcoming.length} current/upcoming` : 'None scheduled'}</strong></div>
            </div>

            <div style={actionRow}>
              <button type="button" onClick={() => setOpenSchedule(openSchedule === contact.contactId ? null : contact.contactId)} style={secondaryButton}>{openSchedule === contact.contactId ? 'Close Schedule' : 'Edit Schedule'}</button>
              <button type="button" onClick={() => setOpenAway(openAway === contact.contactId ? null : contact.contactId)} style={vacationButton}>{openAway === contact.contactId ? 'Close Vacation' : 'Vacation / Away'}</button>
              <button type="button" onClick={() => setOpenPerson(openPerson === contact.contactId ? null : contact.contactId)} style={plainButton}>Person Settings</button>
            </div>

            {openSchedule === contact.contactId && <div style={editorPanel}>
              <div style={editorTitle}><div><div style={eyebrow}>NORMAL COVERAGE</div><strong>Office hours and on-call schedule</strong></div></div>
              <label style={label}>Texting for this person
                <select style={input} value={contact.mode} onChange={(event: ChangeEvent<HTMLSelectElement>) => changeContactMode(contact.contactId, event.target.value as ContactScheduleMode)}>
                  <option value="default">Pause scheduled breakdown texts</option>
                  <option value="always">Always text this person</option>
                  <option value="custom">Use this person’s coverage windows</option>
                </select>
              </label>

              {contact.mode === 'custom' && <div style={windowList}>
                {contact.windows.map((window, index) => <div key={window.id} style={windowEditor}>
                  <div style={windowHeader}>
                    <label style={{ ...label, flex: '1 1 260px' }}>Coverage name<input style={input} value={window.label} onChange={event => patchWindow(contact.contactId, window.id, { label: event.target.value })} placeholder={index === 0 ? 'Office Hours' : 'On Call Schedule'} /></label>
                    <button type="button" onClick={() => removeWindow(contact.contactId, window.id)} style={dangerOutlineButton}>Remove Window</button>
                  </div>
                  <div><div style={label}>Days this window starts</div><div style={dayGrid}>{DAYS.map(day => <label key={day.id} style={{ ...dayChip, borderColor: window.days.includes(day.id) ? '#4c7b5b' : '#d7e0e6', background: window.days.includes(day.id) ? '#edf7ef' : '#fff' }}><input type="checkbox" checked={window.days.includes(day.id)} onChange={() => toggleWindowDay(contact.contactId, window.id, day.id)} />{day.label}</label>)}</div></div>
                  <div style={threeColumn}>
                    <label style={label}>Start time<input type="time" style={input} value={window.startTime} onChange={event => patchWindow(contact.contactId, window.id, { startTime: event.target.value })} /></label>
                    <label style={label}>End time<input type="time" style={input} value={window.endTime} onChange={event => patchWindow(contact.contactId, window.id, { endTime: event.target.value })} /></label>
                    <label style={label}>Week rotation<select style={input} value={window.weekInterval} onChange={event => patchWindow(contact.contactId, window.id, { weekInterval: Number(event.target.value) === 2 ? 2 : 1 })}><option value={1}>Every week</option><option value={2}>Every other week</option></select></label>
                  </div>
                  {window.weekInterval === 2 && <label style={label}>Two-week rotation<select style={input} value={window.activeThisWeek ? 'on' : 'off'} onChange={event => patchWindow(contact.contactId, window.id, { activeThisWeek: event.target.value === 'on' })}><option value="on">This week ON, next week OFF</option><option value="off">This week OFF, next week ON</option></select></label>}
                </div>)}
                <button type="button" onClick={() => addWindow(contact.contactId)} style={secondaryButton}>+ Add Another Coverage Window</button>
              </div>}

              <div style={inlineHelp}>Use one window for <strong>Office Hours</strong> and another for <strong>On Call Schedule</strong>. Vacation backup automatically inherits whichever of these windows would be active at that time.</div>
              <button type="button" disabled={Boolean(busy)} onClick={() => void saveSchedule(contact)} style={primaryButton}>{busy === `schedule-${contact.contactId}` ? 'Saving…' : 'Save Schedule'}</button>
            </div>}

            {openAway === contact.contactId && <div style={awayEditor}>
              <div><div style={eyebrow}>VACATION / AWAY</div><strong>Temporarily hand coverage to a backup</strong><p style={smallCopy}>The normal schedule stays saved. The backup receives the exact office-hours or on-call alerts this person normally would have received. Coverage resumes automatically after the end date.</p></div>
              <div style={threeColumn}>
                <label style={label}>Start date<input type="date" style={input} value={draft.startDate} onChange={event => patchAwayDraft(contact.contactId, { startDate: event.target.value })} /></label>
                <label style={label}>End date<input type="date" style={input} value={draft.endDate} onChange={event => patchAwayDraft(contact.contactId, { endDate: event.target.value })} /></label>
                <label style={label}>Backup person<select style={input} value={draft.backupContactId} onChange={event => patchAwayDraft(contact.contactId, { backupContactId: event.target.value })}><option value="">No backup</option>{contacts.filter(option => option.contactId !== contact.contactId && option.active).map(option => <option key={option.contactId} value={option.contactId}>{option.label}</option>)}</select></label>
              </div>
              <label style={label}>Away label<input style={input} value={draft.label} onChange={event => patchAwayDraft(contact.contactId, { label: event.target.value })} maxLength={80} /></label>
              <button type="button" disabled={Boolean(busy) || !contact.active} onClick={() => void saveAway(contact)} style={vacationButton}>{busy === `away-${contact.contactId}` ? 'Saving…' : 'Save Vacation / Away'}</button>
              {upcoming.length > 0 && <div style={periodList}>{upcoming.map(period => <div key={period.id} style={periodRow}><div><strong>{period.label}</strong><div style={muted}>{awayRange(period)}{period.awayNow ? ' · AWAY NOW' : ''}</div><div style={muted}>Backup: {period.backupLabel || 'None'}</div></div><button type="button" onClick={() => void removeAway(contact, period)} style={dangerOutlineButton}>{busy === `remove-away-${period.id}` ? 'Canceling…' : 'Cancel Away'}</button></div>)}</div>}
            </div>}

            {openPerson === contact.contactId && <div style={editorPanel}>
              <div><div style={eyebrow}>PERSON SETTINGS</div><strong>Name, phone and active status</strong></div>
              <div style={twoColumn}>
                <label style={label}>Name<input style={input} value={contact.label} onChange={event => patchContact(contact.contactId, { label: event.target.value })} /></label>
                <label style={label}>Mobile number<input style={input} value={contact.phone} onChange={event => patchContact(contact.contactId, { phone: event.target.value })} inputMode="tel" /></label>
              </div>
              <label style={checkLabel}><input type="checkbox" checked={contact.active} onChange={event => patchContact(contact.contactId, { active: event.target.checked })} /> Active breakdown text user</label>
              <div style={actionRow}><button type="button" disabled={Boolean(busy)} onClick={() => void savePerson(contact)} style={primaryButton}>{busy === `person-${contact.contactId}` ? 'Saving…' : 'Save Person'}</button><button type="button" disabled={Boolean(busy)} onClick={() => void removePerson(contact)} style={dangerOutlineButton}>Remove Person</button></div>
            </div>}
          </article>;
        })}
        {!loaded && <div style={empty}>Loading breakdown people…</div>}
        {loaded && contacts.length === 0 && <div style={empty}>No breakdown text users yet. Add your first person above.</div>}
      </div>
    </div>

    <details style={advancedCard}>
      <summary style={advancedSummary}><div><div style={eyebrow}>ADVANCED</div><strong>Twilio Connection & Message Settings</strong><div style={muted}>Credentials, webhook, test text and message wording.</div></div><span>Open Advanced Settings</span></summary>
      <div style={advancedBody}>
        <div style={twoColumn}>
          <div style={innerCard}>
            <strong>Twilio connection</strong>
            <div style={summaryRow}><span>Status</span><strong>{admin?.connection.enabled ? 'LIVE' : admin?.connection.configured ? 'PAUSED' : 'NOT CONNECTED'}</strong></div>
            <div style={summaryRow}><span>Account SID</span><strong>{admin?.connection.accountSid || '—'}</strong></div>
            <div style={summaryRow}><span>Sending from</span><strong>{admin?.connection.sender || '—'}</strong></div>
            <label style={label}>Inbound Twilio webhook<div style={codeBox}>{admin?.webhookUrl || '—'}</div></label>
            <button type="button" onClick={() => setEditingConnection(value => !value)} style={secondaryButton}>{editingConnection || !admin?.connection.configured ? 'Hide Credentials' : 'Replace Twilio Credentials'}</button>
          </div>

          <div style={innerCard}>
            {(editingConnection || !admin?.connection.configured) && <>
              <strong>{admin?.connection.configured ? 'Replace Twilio credentials' : 'Twilio credentials'}</strong>
              <label style={label}>Account SID<input style={input} value={accountSid} onChange={event => setAccountSid(event.target.value)} autoComplete="off" placeholder="AC..." /></label>
              <label style={label}>Auth Token<input style={input} type="password" value={authToken} onChange={event => setAuthToken(event.target.value)} autoComplete="new-password" placeholder="Twilio Auth Token" /></label>
              <label style={label}>Twilio phone number or Messaging Service SID<input style={input} value={sender} onChange={event => setSender(event.target.value)} autoComplete="off" placeholder="+1989... or MG..." /></label>
              <p style={smallCopy}>The Auth Token is encrypted before D1 storage and is never shown back.</p>
              <button type="button" disabled={Boolean(busy)} onClick={() => void saveConnection()} style={primaryButton}>{busy === 'connection' ? 'Saving…' : 'Save Twilio Connection'}</button>
            </>}
            {admin?.connection.configured && <>
              <strong>Send test text</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}><input style={input} value={testPhone} onChange={event => setTestPhone(event.target.value)} placeholder="Mobile number" /><button type="button" disabled={Boolean(busy) || !admin.connection.enabled} onClick={() => void sendTest()} style={primaryButton}>{busy === 'test' ? 'Sending…' : 'Send Test'}</button></div>
            </>}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div><div style={eyebrow}>TEXT WORDING</div><strong>Messages Twilio reads from Cloudflare</strong></div>
          {(admin?.templates || []).map(template => <div key={template.key} style={templateCard}>
            <div style={sectionHeader}><div><strong>{template.label}</strong><div style={muted}>{template.key}</div></div><label style={checkLabel}><input type="checkbox" checked={template.active} onChange={event => patchTemplate(template.key, { active: event.target.checked })} /> Active</label></div>
            <textarea style={textarea} value={template.body} onChange={event => patchTemplate(template.key, { body: event.target.value })} rows={template.key === 'new_breakdown' ? 8 : 4} />
            <button type="button" disabled={Boolean(busy)} onClick={() => void saveTemplate(template)} style={primaryButton}>{busy === `template-${template.key}` ? 'Saving…' : 'Save Text'}</button>
          </div>)}
        </div>
      </div>
    </details>
  </section>;
}

const page: CSSProperties = { background: '#f3f5f7', padding: '0 clamp(14px,3vw,34px) 28px', color: '#182331' };
const hero: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: 18, border: '1px solid #d7e0e6', borderRadius: 14, background: '#fff' };
const liveControl: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 12, border: '1px solid #d4dee5', borderRadius: 10, background: '#f8fafb' };
const liveDot: CSSProperties = { width: 11, height: 11, borderRadius: 99, display: 'inline-block' };
const sectionCard: CSSProperties = { marginTop: 16, padding: 18, border: '1px solid #d7e0e6', borderRadius: 14, background: '#fff', boxShadow: '0 3px 14px rgba(15,32,48,.04)' };
const sectionHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' };
const heading: CSSProperties = { margin: '4px 0 0', fontSize: 28, color: '#102238' };
const subheading: CSSProperties = { margin: '4px 0 0', fontSize: 21, color: '#102238' };
const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: '.12em', color: '#415d74' };
const copy: CSSProperties = { margin: '6px 0 0', color: '#586979', lineHeight: 1.5, fontSize: 14 };
const smallCopy: CSSProperties = { margin: '5px 0 0', color: '#657482', lineHeight: 1.45, fontSize: 12 };
const muted: CSSProperties = { marginTop: 3, color: '#6b7b89', fontSize: 12 };
const notice: CSSProperties = { marginTop: 12, padding: '10px 12px', border: '1px solid #d8c17b', borderRadius: 9, background: '#fffdf2', fontSize: 13 };
const addPersonBox: CSSProperties = { marginTop: 14, display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) minmax(190px,1fr) auto', gap: 10, alignItems: 'end', padding: 14, border: '1px solid #cbd8e2', borderRadius: 10, background: '#f8fbfd' };
const peopleGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(390px,1fr))', gap: 14, marginTop: 16 };
const personCard: CSSProperties = { border: '1px solid #d8e1e7', borderRadius: 12, background: '#fbfcfd', padding: 15, display: 'grid', gap: 12, alignContent: 'start' };
const personTop: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' };
const statusPill: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: 30, padding: '0 9px', border: '1px solid', borderRadius: 999, fontSize: 11, fontWeight: 950, whiteSpace: 'nowrap' };
const summaryBlock: CSSProperties = { display: 'grid', gap: 7, padding: 11, border: '1px solid #dce4e9', borderRadius: 9, background: '#fff' };
const summaryRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontSize: 13 };
const windowSummaryRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', paddingTop: 7, borderTop: '1px solid #edf1f3', fontSize: 13 };
const smallGreenPill: CSSProperties = { padding: '4px 7px', borderRadius: 999, background: '#eaf8ef', color: '#1f6a3b', fontSize: 10, fontWeight: 950, whiteSpace: 'nowrap' };
const awayBanner: CSSProperties = { display: 'grid', gap: 3, padding: 10, border: '1px solid #e6afa5', borderRadius: 9, background: '#fff2ef', color: '#7c3328', fontSize: 12 };
const coverBanner: CSSProperties = { display: 'grid', gap: 3, padding: 10, border: '1px solid #a8d2b5', borderRadius: 9, background: '#edf8f0', color: '#245f38', fontSize: 12 };
const actionRow: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const editorPanel: CSSProperties = { display: 'grid', gap: 12, padding: 13, border: '1px solid #b9cad6', borderRadius: 10, background: '#fff' };
const awayEditor: CSSProperties = { display: 'grid', gap: 12, padding: 13, border: '1px solid #e5b4aa', borderRadius: 10, background: '#fff8f6' };
const editorTitle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' };
const windowList: CSSProperties = { display: 'grid', gap: 10 };
const windowEditor: CSSProperties = { display: 'grid', gap: 11, padding: 12, border: '1px solid #d8e1e7', borderRadius: 9, background: '#fbfcfd' };
const windowHeader: CSSProperties = { display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' };
const dayGrid: CSSProperties = { marginTop: 7, display: 'grid', gridTemplateColumns: 'repeat(7,minmax(48px,1fr))', gap: 6 };
const dayChip: CSSProperties = { minHeight: 38, border: '1px solid', borderRadius: 8, padding: '0 7px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 12, fontWeight: 850 };
const twoColumn: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 12 };
const threeColumn: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 };
const label: CSSProperties = { display: 'grid', gap: 5, color: '#485b6b', fontSize: 12, fontWeight: 900 };
const input: CSSProperties = { minHeight: 42, width: '100%', boxSizing: 'border-box', padding: '0 10px', border: '1px solid #cbd5dd', borderRadius: 8, background: '#fff', color: '#172536', fontSize: 15 };
const checkLabel: CSSProperties = { display: 'flex', gap: 7, alignItems: 'center', color: '#485b6b', fontSize: 12, fontWeight: 900 };
const inlineHelp: CSSProperties = { padding: 10, border: '1px solid #cbdce7', borderRadius: 8, background: '#f4f9fc', color: '#3f596c', fontSize: 12, lineHeight: 1.45 };
const primaryButton: CSSProperties = { minHeight: 40, border: 0, borderRadius: 8, padding: '8px 12px', background: '#0d1b2b', color: '#fff', fontWeight: 900, cursor: 'pointer' };
const secondaryButton: CSSProperties = { minHeight: 40, border: '1px solid #9fb3c4', borderRadius: 8, padding: '8px 11px', background: '#f7fafc', color: '#17324a', fontWeight: 900, cursor: 'pointer' };
const vacationButton: CSSProperties = { minHeight: 40, border: '1px solid #cb806f', borderRadius: 8, padding: '8px 11px', background: '#fff5f2', color: '#9a3c2b', fontWeight: 900, cursor: 'pointer' };
const plainButton: CSSProperties = { minHeight: 40, border: '1px solid #d0d9df', borderRadius: 8, padding: '8px 11px', background: '#fff', color: '#435667', fontWeight: 850, cursor: 'pointer' };
const pauseButton: CSSProperties = { minHeight: 40, border: '1px solid #c85142', borderRadius: 8, padding: '8px 11px', background: '#fff', color: '#a83226', fontWeight: 900, cursor: 'pointer' };
const dangerOutlineButton: CSSProperties = { minHeight: 38, border: '1px solid #d1a1a1', borderRadius: 8, padding: '7px 10px', background: '#fff7f7', color: '#8a2f2f', fontWeight: 900, cursor: 'pointer' };
const periodList: CSSProperties = { display: 'grid', gap: 8 };
const periodRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10, border: '1px solid #ead0ca', borderRadius: 8, background: '#fff' };
const empty: CSSProperties = { padding: 18, border: '1px dashed #cbd5dd', borderRadius: 10, color: '#64748b', textAlign: 'center' };
const advancedCard: CSSProperties = { marginTop: 16, border: '1px solid #cbd7df', borderRadius: 14, background: '#fff', overflow: 'hidden' };
const advancedSummary: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', cursor: 'pointer', padding: 16, listStyle: 'none' };
const advancedBody: CSSProperties = { borderTop: '1px solid #dce4e9', padding: 16, display: 'grid', gap: 16 };
const innerCard: CSSProperties = { display: 'grid', gap: 10, padding: 13, border: '1px solid #dce4e9', borderRadius: 10, background: '#fbfcfd' };
const codeBox: CSSProperties = { padding: 9, border: '1px solid #d8e0e5', borderRadius: 7, background: '#f4f7f9', fontFamily: 'monospace', fontSize: 11, overflowWrap: 'anywhere' };
const templateCard: CSSProperties = { display: 'grid', gap: 9, padding: 12, border: '1px solid #dce4e9', borderRadius: 9, background: '#fbfcfd' };
const textarea: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid #cbd5dd', borderRadius: 8, background: '#fff', color: '#172536', fontSize: 14, lineHeight: 1.45, resize: 'vertical' };
