'use client';

import React, { useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { SaveBar, SettingsCard, SettingsLayout, SettingsRow, SettingToggle } from '@/components/settings/settings-ui';
import { useSettingsForm } from '@/lib/settings-form';
import {
  CLIENT_SETTING_DEFAULTS,
  CYCLE_LABEL,
  INVOICE_WHEN,
  INVOICE_WHEN_LABEL,
  KIND_HELP,
  KIND_LABEL,
  parseDays,
  type ServiceTypeRow,
  type TypeKind,
} from '@/lib/clients';
import { fmtMoney } from '@/lib/invoices';
import { send, useClientSettings, useServiceTypes } from '@/lib/use-clients';
import { showToast } from '@/components/toast';
import { PartIcon, Switch, Tip, MoneyField, Label } from '@/components/clients/ui';
import { Portal } from '@/components/portal';
import { Edit, Plus, XIcon } from '@/components/icons';

type Key = keyof typeof CLIENT_SETTING_DEFAULTS;

export default function ClientSettingsPage() {
  const { draft, set, dirty, saving, error, save, discard } = useSettingsForm();
  const { types, reload } = useServiceTypes();
  const cfg = useClientSettings();
  const [editing, setEditing] = useState<ServiceTypeRow | 'new' | null>(null);
  const [running, setRunning] = useState(false);
  const get = (key: Key) => draft?.[key] ?? CLIENT_SETTING_DEFAULTS[key];

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await send<{ reminders: unknown[]; drafted: unknown[]; email: string; error?: string }>('POST', '/api/clients/daily-run');
      const what =
        r.email === 'sent'
          ? `Sent ${r.reminders.length} reminders`
          : r.email === 'nothing'
            ? 'No reminders due today'
            : r.email === 'off'
              ? 'Reminder emails are off'
              : `Reminders not sent: ${r.error ?? r.email}`;
      showToast(`${what}. ${r.drafted.length} draft ${r.drafted.length === 1 ? 'invoice' : 'invoices'} created.`, r.email === 'failed' || r.email === 'not set up' ? 'info' : 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not run', 'info');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Shell>
      <SettingsLayout title="Clients" subtitle="Service types, reminders, and what happens when something renews or a job is done.">
        {!draft ? (
          <div className="settings-card"><div className="settings-card-body" style={{ color: 'var(--muted-foreground)' }}>{error ?? 'Loading settings…'}</div></div>
        ) : (
          <>
            {error && <div className="settings-card"><div className="settings-card-body" style={{ color: 'var(--destructive)' }}>{error}</div></div>}

            <SettingsCard
              title="Service types"
              subtitle="Every type works one of three ways: it renews, it is visited, or it is a one-off job. Each type sets the defaults for new services."
              foot={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', width: '100%' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditing('new')}>
                    <Plus /> Add service type
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>A type that is in use can be edited, but not deleted. Services already added keep how they work until you change them.</span>
                </div>
              }
            >
              {!types ? (
                <div style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>Loading…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {types.map((t) => (
                    <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,1.5fr) 36px', gap: 14, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                      <div className="ct-who">
                        <span className="ct-icon"><PartIcon part={t.part} kind={t.kind} /></span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 500 }}>{t.name}</span>
                            <span className="ct-kind">{KIND_LABEL[t.kind]}</span>
                            {!t.show_in_add && <span className="ct-kind">Hidden</span>}
                          </div>
                          <div className="ct-muted">{t.used ?? 0} {t.used === 1 ? 'service' : 'services'}</div>
                        </div>
                      </div>
                      <span style={{ fontSize: 13 }}>{t.kind === 'job' || t.kind === 'any' ? 'Once' : CYCLE_LABEL[t.cycle]}</span>
                      <span className="ct-num" style={{ fontSize: 13 }}>{t.price > 0 ? `${fmtMoney(t.price, cfg.currency)}${t.price_unit === 'each' ? ' each' : ''}` : 'Not set'}</span>
                      <span style={{ fontSize: 13, color: '#404040' }}>{reminderSummary(t, get)}</span>
                      <button className="icon-btn" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Edit /></button>
                    </div>
                  ))}
                </div>
              )}
            </SettingsCard>

            <SettingsCard title="Reminders" subtitle="When we nudge your team, and who we nudge. Reminders are for your team, never the client.">
              <SettingsRow label="Send reminder emails" help="One email each morning (8 AM Lagos time) listing what is due.">
                <SettingToggle on={get('clients_reminders_on') !== 'false'} onToggle={() => set('clients_reminders_on', get('clients_reminders_on') === 'false' ? 'true' : 'false')} />
              </SettingsRow>
              <SettingsRow label="Before something renews" help="Days ahead, separated by commas. A service type can have its own list.">
                <input className="input" value={get('clients_reminder_days')} onChange={(e) => set('clients_reminder_days', e.target.value)} placeholder="60, 30, 14, 7" />
              </SettingsRow>
              <SettingsRow label="Before a job is due" help="For one-off jobs, such as an LMS setup.">
                <input className="input" value={get('clients_job_reminder_days')} onChange={(e) => set('clients_job_reminder_days', e.target.value)} placeholder="7, 1" />
              </SettingsRow>
              <SettingsRow label="When it is overdue" help="Until you renew it, mark it delivered, or end the service. 0 means never.">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13 }}>Remind every</span>
                  <input className="input" style={{ width: 70 }} value={get('clients_overdue_every')} onChange={(e) => set('clients_overdue_every', e.target.value)} />
                  <span style={{ fontSize: 13 }}>days</span>
                </div>
              </SettingsRow>
              <SettingsRow label="Who gets reminders" help="Emails separated by commas. Empty sends them to the owners.">
                <input className="input" value={get('clients_reminder_emails')} onChange={(e) => set('clients_reminder_emails', e.target.value)} placeholder="you@company.com, colleague@company.com" />
              </SettingsRow>
              <SettingsRow label="Run now" help="Sends today's reminders and makes today's drafts now. Reminders already sent today are not sent again. Uses the mail server from Settings → Invoice.">
                <button className="btn btn-outline btn-sm" onClick={() => void runNow()} disabled={running || dirty}>
                  {running ? 'Running…' : "Send today's reminders now"}
                </button>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="Renewals and invoices" subtitle="What happens when a service comes up for renewal, or a job is finished. You always review and send invoices yourself.">
              <SettingsRow label="Draft renewal invoices ahead of time" help="The daily run makes a draft for each renewal and each month of a maintenance plan that has a price.">
                <SettingToggle on={get('clients_auto_draft') !== 'false'} onToggle={() => set('clients_auto_draft', get('clients_auto_draft') === 'false' ? 'true' : 'false')} />
              </SettingsRow>
              <SettingsRow label="Yearly services" help="Days before the renewal date.">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="input" style={{ width: 80 }} value={get('clients_draft_days_yearly')} onChange={(e) => set('clients_draft_days_yearly', e.target.value)} />
                  <span style={{ fontSize: 13 }}>days before</span>
                </div>
              </SettingsRow>
              <SettingsRow label="Monthly services" help="Days before the date (renewal or scheduled date).">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="input" style={{ width: 80 }} value={get('clients_draft_days_monthly')} onChange={(e) => set('clients_draft_days_monthly', e.target.value)} />
                  <span style={{ fontSize: 13 }}>days before</span>
                </div>
              </SettingsRow>
              <SettingsRow label="Invoice for a one-off job" help="The default for new jobs. You can change it per job.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {INVOICE_WHEN.map((w) => (
                    <label key={w} className="ct-check" style={{ fontSize: 13 }}>
                      <input type="radio" name="job-invoice" checked={get('clients_job_invoice') === w} onChange={() => set('clients_job_invoice', w)} />
                      {INVOICE_WHEN_LABEL[w]}
                    </label>
                  ))}
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="Schedule checklists" subtitle="What you do each time a scheduled service comes round. A plan gets the steps for what it looks after: website and hosting, domain and email, or both.">
              <SettingsRow label="Website and hosting" help="One step per line.">
                <textarea className="input" rows={5} value={lines(draft.clients_checklist_site)} onChange={(e) => set('clients_checklist_site', toList(e.target.value))} />
              </SettingsRow>
              <SettingsRow label="Domain and email" help="One step per line.">
                <textarea className="input" rows={4} value={lines(draft.clients_checklist_mail)} onChange={(e) => set('clients_checklist_mail', toList(e.target.value))} />
              </SettingsRow>
            </SettingsCard>

            <ImportExport />
          </>
        )}
        <SaveBar visible={dirty} saving={saving} onDiscard={discard} onSave={() => void save()} />
      </SettingsLayout>
      {editing && (
        <TypeDialog
          type={editing === 'new' ? null : editing}
          symbol={cfg.symbol}
          defaults={{ renews: get('clients_reminder_days'), job: get('clients_job_reminder_days') }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </Shell>
  );
}

function reminderSummary(t: ServiceTypeRow, get: (key: Key) => string): string {
  if (t.kind === 'visits') return 'On each scheduled date';
  if (t.kind === 'any') return 'Follows the way you set it up';
  const days = parseDays(t.reminder_days).length ? parseDays(t.reminder_days) : parseDays(get(t.kind === 'job' ? 'clients_job_reminder_days' : 'clients_reminder_days'));
  return days.length ? `${days.join(' · ')} days before${t.kind === 'job' ? ' it is due' : ''}` : 'None';
}

/** New or edit a service type. Changing how it works applies to new services; ones already added keep theirs. */
function TypeDialog({ type, symbol, defaults, onClose, onSaved }: {
  type: ServiceTypeRow | null;
  symbol: string;
  defaults: { renews: string; job: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(type?.name ?? '');
  const [kind, setKind] = useState<TypeKind>(type?.kind ?? 'job');
  const [cycle, setCycle] = useState(type?.cycle === 'monthly' ? 'monthly' : 'yearly');
  const [price, setPrice] = useState(Number(type?.price) || 0);
  const [unit, setUnit] = useState<'once' | 'each'>(type?.price_unit ?? 'once');
  const [days, setDays] = useState(type?.reminder_days ?? '');
  const [invoiceWhen, setInvoiceWhen] = useState(type?.invoice_when ?? '');
  const [show, setShow] = useState(type ? !!type.show_in_add : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { name, kind, cycle, price, price_unit: unit, reminder_days: days, invoice_when: invoiceWhen, show_in_add: show };
      if (type) await send('PATCH', `/api/service-types/${type.id}`, body);
      else await send('POST', '/api/service-types', body);
      showToast(type ? 'Service type saved' : 'Service type created');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    setSaving(true);
    try {
      await send('DELETE', `/api/service-types/${type!.id}`);
      showToast('Service type deleted');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
      setSaving(false);
    }
  };
  const canDelete = !!type && !type.part && !(type.used ?? 0);

  return (
    <Portal>
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal ct-dialog sm" role="dialog" aria-modal="true" aria-label={type ? 'Edit service type' : 'New service type'}>
          <div className="modal-header">
            <div className="modal-title">
              {type ? 'Edit service type' : 'New service type'}
              {type && <span style={{ display: 'block', fontSize: 12.5, fontWeight: 400, color: 'var(--muted-foreground)' }}>{type.name} · used by {type.used ?? 0}</span>}
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close"><XIcon /></button>
          </div>
          <div className="ct-dialog-body">
            {error && <div className="ct-error" role="alert">{error}</div>}
            <div className="ct-field">
              <Label htmlFor="t-name" required>Name</Label>
              <input id="t-name" type="text" value={name} maxLength={60} placeholder="LMS setup" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="ct-field">
              <Label tip="The default for new services of this type. You can still pick another way on each service, and services already added keep theirs.">How does it work?</Label>
              <div className="ct-radios-row" role="radiogroup" aria-label="How does it work?">
                {(['renews', 'visits', 'job'] as const).map((k) => (
                  <label key={k} className={`ct-radio${kind === k ? ' on' : ''}`}>
                    <input type="radio" name="t-kind" checked={kind === k} onChange={() => setKind(k)} />
                    <span>
                      <span className="t">{KIND_LABEL[k]}</span>
                      <span className="d">{KIND_HELP[k]}</span>
                    </span>
                  </label>
                ))}
              </div>
              {kind === 'any' && <div className="ct-muted">You choose how each one works when you add it.</div>}
            </div>
            {(kind === 'renews' || kind === 'visits') && (
              <div className="ct-field">
                <Label>{kind === 'visits' ? 'Repeats' : 'Billing cycle'}</Label>
                <select value={cycle} onChange={(e) => setCycle(e.target.value as 'yearly' | 'monthly')}>
                  <option value="yearly">Yearly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            )}
            {kind !== 'any' && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <MoneyField id="t-price" label="Default price" symbol={symbol} value={price} onChange={setPrice} tip="Used for new services of this type. Ones already added keep their own price." />
                </div>
                {kind === 'job' && (
                  <select className="ct-input" style={{ width: 'auto' }} value={unit} onChange={(e) => setUnit(e.target.value as 'once' | 'each')} aria-label="Charged once or each">
                    <option value="once">once</option>
                    <option value="each">each</option>
                  </select>
                )}
              </div>
            )}
            {(kind === 'renews' || kind === 'job') && (
              <div className="ct-field">
                <Label htmlFor="t-days" tip="Empty uses the list in Reminders. Ones already added keep following this type.">
                  {kind === 'job' ? 'Remind us before it is due (days)' : 'Remind us before it renews (days)'}
                </Label>
                <input id="t-days" type="text" value={days} placeholder={kind === 'job' ? defaults.job : defaults.renews} onChange={(e) => setDays(e.target.value)} />
              </div>
            )}
            {kind === 'job' && (
              <div className="ct-field">
                <Label htmlFor="t-inv">Invoice</Label>
                <select id="t-inv" value={invoiceWhen} onChange={(e) => setInvoiceWhen(e.target.value)}>
                  <option value="">Settings default</option>
                  {INVOICE_WHEN.map((w) => <option key={w} value={w}>{INVOICE_WHEN_LABEL[w]}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 500, fontSize: 13 }}>Show in the Add list</span>
              <Tip text="Turn off to hide it from the Add buttons without deleting it." />
              <span style={{ marginLeft: 'auto' }}><Switch on={show} onChange={setShow} label="Show in the Add list" /></span>
            </div>
          </div>
          <div className="modal-footer">
            {type ? (
              <button className="btn btn-ghost" onClick={() => void remove()} disabled={saving || !canDelete} title={canDelete ? '' : 'A type that is in use, or built in, cannot be deleted.'} style={{ color: canDelete ? 'var(--destructive)' : undefined }}>
                Delete
              </button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void submit()} disabled={saving || !name.trim()}>
                {saving ? 'Saving…' : type ? 'Save changes' : 'Create service type'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

const lines = (json: string | undefined) => {
  try {
    const list = JSON.parse(json ?? '[]');
    return Array.isArray(list) ? list.join('\n') : '';
  } catch {
    return '';
  }
};
const toList = (text: string) => JSON.stringify(text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30));

interface Candidate {
  name: string;
  email: string;
  invoices: number;
}

/** Bring in clients already on your invoices, and download every client and service as a spreadsheet. */
function ImportExport() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const data = await send<{ candidates: Candidate[] }>('GET', '/api/clients/import/candidates');
      setCandidates(data.candidates);
      setPicked(data.candidates.map((c) => c.name));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not look through invoices', 'info');
    }
  };
  const runImport = async () => {
    setBusy(true);
    try {
      const data = await send<{ imported: number }>('POST', '/api/clients/import', { names: picked });
      showToast(`${data.imported} ${data.imported === 1 ? 'client' : 'clients'} added. Their invoices are linked.`);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not import', 'info');
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = async () => {
    setBusy(true);
    try {
      const [list, due] = await Promise.all([
        send<{ clients: { id: string; name: string; contact_name: string; email: string; phone: string; website: string; status: string }[] }>('GET', '/api/clients'),
        send<{ services: { client_id: string; name: string; kind: string; cycle: string; next_date: number | null; price: number; currency: string }[] }>('GET', '/api/clients/due'),
      ]);
      const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Client', 'Contact', 'Email', 'Phone', 'Website', 'Status', 'Service', 'How it works', 'Cycle', 'Next date', 'Price', 'Currency']];
      for (const c of list.clients) {
        const services = due.services.filter((s) => s.client_id === c.id);
        if (!services.length) rows.push([c.name, c.contact_name, c.email, c.phone, c.website, c.status, '', '', '', '', '', '']);
        for (const s of services) {
          rows.push([c.name, c.contact_name, c.email, c.phone, c.website, c.status, s.name, s.kind, s.cycle, s.next_date ? new Date(s.next_date).toISOString().slice(0, 10) : '', String(s.price), s.currency]);
        }
      }
      const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clients-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not export', 'info');
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsCard title="Import and export" subtitle="Start from the clients already on your invoices, or take everything out as a spreadsheet.">
      <SettingsRow label="Import from invoices" help="Client names on invoices that are not a client yet. Their email and address come from the latest invoice, and those invoices are linked.">
        {candidates === null ? (
          <button className="btn btn-outline btn-sm" onClick={() => void load()}>Find clients on my invoices</button>
        ) : candidates.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Every client on your invoices is already here.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {candidates.map((c) => (
              <label key={c.name} className="ct-check" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={picked.includes(c.name)} onChange={() => setPicked((p) => (p.includes(c.name) ? p.filter((n) => n !== c.name) : [...p, c.name]))} />
                {c.name}
                <span className="ct-muted">{[c.email, `${c.invoices} ${c.invoices === 1 ? 'invoice' : 'invoices'}`].filter(Boolean).join(' · ')}</span>
              </label>
            ))}
            <div>
              <button className="btn btn-primary btn-sm" onClick={() => void runImport()} disabled={busy || !picked.length}>
                Import {picked.length} {picked.length === 1 ? 'client' : 'clients'}
              </button>
            </div>
          </div>
        )}
      </SettingsRow>
      <SettingsRow label="Export" help="Every client and their active services, as a CSV file for Excel or Google Sheets.">
        <button className="btn btn-outline btn-sm" onClick={() => void exportCsv()} disabled={busy}>Download CSV</button>
      </SettingsRow>
    </SettingsCard>
  );
}
