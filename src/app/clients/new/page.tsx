'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import { useCollections } from '@/lib/collections';
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABEL,
  DAY_MS,
  FORM_PARTS,
  draftDateFor,
  jobInvoiceWhen,
  parseTags,
  reminderDaysFor,
  INVOICE_WHEN_LABEL,
  type ClientRow,
  type ClientStatus,
  type ServiceTypeRow,
} from '@/lib/clients';
import { startOfDay } from '@/lib/dates';
import { send, useClientSettings, useServiceTypes } from '@/lib/use-clients';
import { draftFromType, serviceProblem, servicePayload, ServiceFields, type ServiceDraft } from '@/components/clients/service-fields';
import { AreaField, IconBox, Label, PartIcon, Seg, Switch, TextField, Tip } from '@/components/clients/ui';
import { Trash } from '@/components/icons';

interface ClientForm {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  whatsapp: boolean;
  website: string;
  status: ClientStatus;
  tags: string[];
  notes: string;
  service_notes: string;
  logins: string;
  billing_address: string;
  tax_id: string;
}

const EMPTY: ClientForm = {
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  whatsapp: true,
  website: '',
  status: 'active',
  tags: [],
  notes: '',
  service_notes: '',
  logins: '',
  billing_address: '',
  tax_id: '',
};

const fromClient = (c: ClientRow): ClientForm => ({
  name: c.name,
  contact_name: c.contact_name,
  email: c.email,
  phone: c.phone,
  whatsapp: !!c.whatsapp,
  website: c.website,
  status: c.status,
  tags: parseTags(c.tags),
  notes: c.notes,
  service_notes: c.service_notes,
  logins: c.logins,
  billing_address: c.billing_address,
  tax_id: c.tax_id,
});

const PART_LABEL: Record<string, string> = { website: 'Website', domain: 'Domain', hosting: 'Hosting', email: 'Email', maintenance: 'Maintenance plan' };

export default function NewClientPage() {
  return (
    <Shell>
      <Suspense fallback={null}>
        <LogClient />
      </Suspense>
    </Shell>
  );
}

function LogClient() {
  const router = useRouter();
  const editId = useSearchParams().get('id');
  const { types } = useServiceTypes();
  const cfg = useClientSettings();
  const { items: tagItems } = useCollections('tags');
  const [form, setForm] = useState<ClientForm>(EMPTY);
  const [billingOpen, setBillingOpen] = useState(false);
  const [parts, setParts] = useState<Record<string, { on: boolean; draft: ServiceDraft }> | null>(null);
  const [others, setOthers] = useState<ServiceDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editId);

  const set = <K extends keyof ClientForm>(key: K, value: ClientForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const typeByPart = useMemo(() => new Map((types ?? []).filter((t) => t.part).map((t) => [t.part as string, t])), [types]);

  // The five parts start from their types; everything is off until switched on.
  useEffect(() => {
    if (!types || parts) return;
    const next: Record<string, { on: boolean; draft: ServiceDraft }> = {};
    for (const part of FORM_PARTS) {
      const type = typeByPart.get(part);
      if (type) next[part] = { on: false, draft: draftFromType(type) };
    }
    // The part cards start from the service types once they arrive from the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParts(next);
  }, [types, parts, typeByPart]);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const data = await send<{ client: ClientRow }>('GET', `/api/clients/${encodeURIComponent(editId)}`);
        setForm(fromClient(data.client));
        setBillingOpen(!!(data.client.billing_address || data.client.tax_id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the client');
      } finally {
        setLoaded(true);
      }
    })();
  }, [editId]);

  const addable = (types ?? []).filter((t) => (!t.part || t.part === 'other' || t.part === 'ssl') && t.show_in_add);
  const onServices = useMemo(
    () => [...FORM_PARTS.filter((p) => parts?.[p]?.on).map((p) => parts![p].draft), ...others],
    [parts, others]
  );

  const save = async (another: boolean) => {
    if (!form.name.trim()) {
      setError('Add the client or business name');
      return;
    }
    const problem = editId ? null : onServices.map(serviceProblem).find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, name: form.name.trim() };
      if (editId) {
        await send('PATCH', `/api/clients/${encodeURIComponent(editId)}`, body);
        router.push(`/clients/view?id=${encodeURIComponent(editId)}`);
        return;
      }
      const data = await send<{ client: ClientRow }>('POST', '/api/clients', {
        ...body,
        services: onServices.map((d) => servicePayload(d, true)),
      });
      if (another) {
        setForm(EMPTY);
        setParts(null);
        setOthers([]);
        window.scrollTo({ top: 0 });
      } else {
        router.push(`/clients/view?id=${encodeURIComponent(data.client.id)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const partCard = (part: string) => {
    const entry = parts?.[part];
    if (!entry) return null;
    const label = PART_LABEL[part];
    return (
      <div key={part} className={`ct-svc${entry.on ? ' on' : ''}`}>
        <div className="ct-svc-head">
          <IconBox part={part} muted={!entry.on} />
          <span className="ct-svc-name">{label}</span>
          {!entry.on && <span className="ct-svc-off">Not with us</span>}
          <span className="ct-svc-actions">
            <Switch on={entry.on} label={`${label} is with us`} onChange={(on) => setParts((p) => ({ ...p!, [part]: { ...p![part], on } }))} />
          </span>
        </div>
        {entry.on && (
          <div className="ct-svc-body">
            <ServiceFields
              draft={entry.draft}
              idPrefix={`p-${part}`}
              symbol={cfg.symbol}
              allowKindChange
              onChange={(draft) => setParts((p) => ({ ...p!, [part]: { ...p![part], draft } }))}
            />
          </div>
        )}
      </div>
    );
  };

  if (!loaded) return <div className="ct-page ct-empty">Loading…</div>;

  return (
    <div className="ct-page">
      <nav className="ct-crumbs" aria-label="Breadcrumb">
        <Link href="/clients">Clients</Link>
        <span aria-hidden="true">›</span>
        <strong>{editId ? form.name || 'Client' : 'New client'}</strong>
      </nav>

      <div className="ct-layout">
        <div className="ct-main">
          <div>
            <h1 className="ct-h1">{editId ? 'Edit client' : 'Log a new client'}</h1>
            <p className="ct-sub">
              {editId ? 'Their details. Services are changed on the client page.' : 'Only the name is required. Add what they have with us now, or come back to it later.'}
            </p>
          </div>

          {error && <div className="ct-error" role="alert">{error}</div>}

          <section className="ct-card">
            <div className="ct-card-head">
              <div>
                <h2>Who is this client?</h2>
                <p>The basics, so you can find them and reach them fast.</p>
              </div>
            </div>
            <div className="ct-card-body">
              <div className="ct-grid">
                <div className="full">
                  <TextField id="c-name" label="Client or business name" required value={form.name} onChange={(v) => set('name', v)} />
                </div>
                <TextField id="c-contact" label="Contact person" value={form.contact_name} onChange={(v) => set('contact_name', v)} />
                <TextField id="c-email" type="email" label="Email" value={form.email} onChange={(v) => set('email', v)} />
                <div className="ct-field">
                  <TextField id="c-phone" type="tel" label="Phone" value={form.phone} maxLength={40} onChange={(v) => set('phone', v)} />
                  <label className="ct-check">
                    <input type="checkbox" checked={form.whatsapp} onChange={(e) => set('whatsapp', e.target.checked)} />
                    Same number on WhatsApp
                  </label>
                </div>
                <TextField
                  id="c-site"
                  label="Main website or domain"
                  value={form.website}
                  maxLength={253}
                  placeholder="example.com"
                  tip="Type it once. The website, domain, hosting, email and maintenance all use it."
                  onChange={(v) => set('website', v)}
                />
                <div className="ct-field">
                  <Label tip="Prospect: still talking. Active: paying you. Past: no longer a client (no reminders).">Status</Label>
                  <Seg
                    label="Status"
                    value={form.status}
                    options={CLIENT_STATUSES.map((s) => ({ id: s, label: CLIENT_STATUS_LABEL[s] }))}
                    onChange={(v) => set('status', v)}
                  />
                </div>
                {tagItems.length > 0 && (
                  <div className="ct-field">
                    <Label tip="Tags come from Settings → General.">Tags</Label>
                    <div className="ct-pills">
                      {tagItems.map((t) => {
                        const on = form.tags.includes(t.name);
                        return (
                          <label key={t.id} className={`ct-pill${on ? ' on' : ''}`}>
                            <input type="checkbox" checked={on} onChange={() => set('tags', on ? form.tags.filter((n) => n !== t.name) : [...form.tags, t.name])} />
                            {t.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                <AreaField
                  id="c-notes"
                  label="Notes about the client"
                  rows={3}
                  value={form.notes}
                  tip="Anything you would want to remember before calling them."
                  onChange={(v) => set('notes', v)}
                />
                {billingOpen ? (
                  <>
                    <AreaField id="c-billing" label="Billing address" value={form.billing_address} tip="Shown on their invoices." onChange={(v) => set('billing_address', v)} />
                    <TextField id="c-tax" label="Tax ID" value={form.tax_id} maxLength={60} onChange={(v) => set('tax_id', v)} />
                  </>
                ) : (
                  <div className="full">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBillingOpen(true)}>
                      Add billing address or tax ID
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="ct-card">
            <div className="ct-card-head">
              <div>
                <h2>
                  What do they have with us?
                  <Tip text="Switching a part off hides it. What you typed is kept until you save, so switching it back on brings it back." />
                </h2>
                <p>{editId ? 'Add, renew or end services on the client page.' : 'Switch on only what applies to this client. Anything left off gets no reminders or invoices.'}</p>
              </div>
              {editId && (
                <Link className="btn btn-outline btn-sm" href={`/clients/view?id=${encodeURIComponent(editId)}`}>
                  Open client page
                </Link>
              )}
            </div>
            <div className="ct-card-body">
              <div className="ct-field" style={{ maxWidth: 460 }}>
                <TextField
                  id="c-logins"
                  label="Where the logins are kept"
                  value={form.logins}
                  placeholder="Bitwarden › Clients › Their name"
                  tip="Typed once for everything below. Say where the login lives. Never type a password here."
                  onChange={(v) => set('logins', v)}
                />
              </div>

              {!editId && parts && (
                <>
                  <div className="ct-group">
                    <div className="ct-group-label">
                      Website, domain and hosting
                      {form.website && <span className="muted">for {form.website}</span>}
                      <Tip text="Often sold together, but each part is optional. All three use the main website or domain above." />
                    </div>
                    {partCard('website')}
                    {partCard('domain')}
                    {partCard('hosting')}
                  </div>
                  {partCard('email')}
                  {partCard('maintenance')}

                  <div className={`ct-svc${others.length ? ' on' : ''}`}>
                    <div className="ct-svc-head">
                      <IconBox muted={!others.length} />
                      <span className="ct-svc-name">Other services</span>
                      <Tip text="Anything you sell that is not one of the parts above. The list comes from Settings → Clients → Service types. Pick Something else for anything not in the list." />
                    </div>
                    <div className="ct-svc-body">
                      <div className="ct-chips">
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#525252' }}>Add</span>
                        {addable.map((t: ServiceTypeRow) => (
                          <button key={t.id} type="button" className="ct-chip-add" onClick={() => setOthers((o) => [...o, draftFromType(t)])}>
                            <PartIcon part={t.part} kind={t.kind} size={12} />
                            {t.name}
                          </button>
                        ))}
                      </div>
                      {others.map((draft, index) => (
                        <div key={index} className="ct-svc on">
                          <div className="ct-svc-head">
                            <IconBox part={draft.part} kind={draft.kind} />
                            <span className="ct-svc-name">{draft.typeKind === 'any' ? draft.name || 'Something else' : draft.name}</span>
                            <span className="ct-kind">{draft.kind === 'job' ? 'One-off job' : draft.kind === 'visits' ? 'Schedule' : 'Renews'}</span>
                            <span className="ct-svc-actions">
                              <button type="button" className="icon-btn" aria-label="Remove this service" onClick={() => setOthers((o) => o.filter((_, i) => i !== index))}>
                                <Trash />
                              </button>
                            </span>
                          </div>
                          <div className="ct-svc-body">
                            <ServiceFields
                              draft={draft}
                              idPrefix={`o-${index}`}
                              symbol={cfg.symbol}
                              allowKindChange
                              onChange={(next) => setOthers((o) => o.map((d, i) => (i === index ? next : d)))}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <AreaField
                id="c-service-notes"
                label="Notes about their services"
                value={form.service_notes}
                tip="One place for anything about this client's services. Not shared with the client."
                onChange={(v) => set('service_notes', v)}
              />
            </div>
          </section>

          <div className="ct-savebar">
            <div>
              <span style={{ fontSize: 13, marginRight: 6 }}>{saving ? 'Saving…' : 'Ready to save'}</span>
              <button type="button" onClick={() => router.push(editId ? `/clients/view?id=${encodeURIComponent(editId)}` : '/clients')} disabled={saving}>
                Cancel
              </button>
              {!editId && (
                <button type="button" onClick={() => void save(true)} disabled={saving}>
                  Save and add another
                </button>
              )}
              <button type="button" className="primary" onClick={() => void save(false)} disabled={saving}>
                {editId ? 'Save changes' : 'Save client'}
              </button>
            </div>
          </div>
        </div>

        {!editId && <WhatHappensNext services={onServices} cfg={cfg} types={types ?? []} />}
      </div>
    </div>
  );
}

/** The right rail: reminders and invoice drafts each switched-on service will get. */
function WhatHappensNext({ services, cfg, types }: { services: ServiceDraft[]; cfg: ReturnType<typeof useClientSettings>; types: ServiceTypeRow[] }) {
  const [today] = useState(() => startOfDay(Date.now()));
  const byId = new Map(types.map((t) => [t.id, t]));
  const recipients = cfg.settings.clients_reminder_emails || 'the owners';
  return (
    <aside className="ct-rail">
      <section className="ct-card">
        <div className="ct-card-head">
          <div>
            <h2>What happens next</h2>
            <p>From your defaults in Settings → Clients.</p>
          </div>
        </div>
        <div className="ct-next">
          {services.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Nothing yet. Switch on what they have with us to see their reminders here.</div>}
          {services.map((s, i) => {
            const type = byId.get(s.type_id) ?? null;
            const name = s.name || 'Something else';
            const rows: [string, string][] = [];
            if (s.next_date === null) {
              rows.push(['No date yet', 'No reminders']);
            } else if (s.kind === 'visits') {
              rows.push(['Schedule reminder', cfg.fmt(s.next_date)]);
            } else {
              for (const d of reminderDaysFor(s, type, cfg.rules)) {
                const at = s.next_date - d * DAY_MS;
                if (at >= today) rows.push([`Reminder, ${d} ${d === 1 ? 'day' : 'days'} before`, cfg.fmt(at)]);
              }
            }
            let draft: string | null = null;
            if (s.kind === 'job') draft = INVOICE_WHEN_LABEL[jobInvoiceWhen(s, type, cfg.rules)];
            else if (cfg.rules.autoDraft && s.price > 0) {
              const at = draftDateFor(s, cfg.rules);
              if (at !== null) draft = at <= today ? 'The morning after you save' : cfg.fmt(at);
            }
            return (
              <div key={i} className="ct-next-block">
                <div className="ct-next-title">
                  <PartIcon part={s.part} kind={s.kind} />
                  {name}
                </div>
                <div className="ct-next-sub">
                  {s.kind === 'job' ? 'One-off job' : s.cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                  {s.next_date !== null ? ` · ${s.kind === 'job' ? 'due' : s.kind === 'visits' ? 'next scheduled' : 'renews'} ${cfg.fmt(s.next_date)}` : ''}
                </div>
                {rows.map(([k, v]) => (
                  <div key={k} className="ct-next-row">
                    <span>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
                {draft && (
                  <div className="ct-next-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                    <span className="ct-chipline blue">Draft invoice</span>
                    <span>{draft}</span>
                  </div>
                )}
              </div>
            );
          })}
          <div className="ct-next-block" style={{ fontSize: 12.5, color: '#525252' }}>
            Reminders go to {recipients}, by email each morning.
          </div>
        </div>
        <div className="ct-note">Nothing is sent to the client. Draft invoices wait for you to review and send them.</div>
      </section>
    </aside>
  );
}
