'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABEL,
  DAY_MS,
  MODE_LABEL,
  REPEATS_LABEL,
  draftDateFor,
  modesFor,
  reminderDays,
  type ClientRow,
  type ClientStatus,
  type ServiceTypeRow,
  type TypePart,
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
  whatsapp_number: string;
  website: string;
  status: ClientStatus;
  notes: string;
  service_notes: string;
  logins: string;
  address_street: string;
  address_city: string;
  address_country: string;
  tax_id: string;
}

const EMPTY: ClientForm = {
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  whatsapp: true,
  whatsapp_number: '',
  website: '',
  status: 'active',
  notes: '',
  service_notes: '',
  logins: '',
  address_street: '',
  address_city: '',
  address_country: '',
  tax_id: '',
};

const fromClient = (c: ClientRow): ClientForm => ({
  name: c.name,
  contact_name: c.contact_name,
  email: c.email,
  phone: c.phone,
  whatsapp: !!c.whatsapp,
  whatsapp_number: c.whatsapp_number ?? '',
  website: c.website,
  status: c.status,
  notes: c.notes,
  service_notes: c.service_notes,
  logins: c.logins,
  address_street: c.address_street,
  address_city: c.address_city,
  address_country: c.address_country,
  tax_id: c.tax_id,
});

/** The built-in services that get their own card on this form. */
const CORE: TypePart[] = ['website', 'email', 'maintenance'];

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
  const [form, setForm] = useState<ClientForm>(EMPTY);
  const [billingOpen, setBillingOpen] = useState(false);
  const [parts, setParts] = useState<Record<string, { on: boolean; draft: ServiceDraft }> | null>(null);
  const [others, setOthers] = useState<ServiceDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editId);

  const set = <K extends keyof ClientForm>(key: K, value: ClientForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const core = useMemo(() => (types ?? []).filter((t) => t.part && CORE.includes(t.part) && t.show_in_add), [types]);

  // The built-in cards start from their types; everything is off until switched on.
  useEffect(() => {
    if (!types || parts) return;
    const next: Record<string, { on: boolean; draft: ServiceDraft }> = {};
    for (const type of core) next[type.id] = { on: false, draft: draftFromType(type) };
    // The part cards start from the service types once they arrive from the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParts(next);
  }, [types, parts, core]);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const data = await send<{ client: ClientRow }>('GET', `/api/clients/${encodeURIComponent(editId)}`);
        setForm(fromClient(data.client));
        const c = data.client;
        setBillingOpen(!!(c.address_street || c.address_city || c.address_country || c.tax_id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the client');
      } finally {
        setLoaded(true);
      }
    })();
  }, [editId]);

  const addable = (types ?? []).filter((t) => (!t.part || t.part === 'other') && t.show_in_add);
  const onServices = useMemo(
    () => [...core.filter((t) => parts?.[t.id]?.on).map((t) => parts![t.id].draft), ...others],
    [core, parts, others]
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
      const body = { ...form, name: form.name.trim(), whatsapp_number: form.whatsapp ? '' : form.whatsapp_number };
      if (editId) {
        await send('PATCH', `/api/clients/${encodeURIComponent(editId)}`, body);
        router.push(`/clients/view?id=${encodeURIComponent(editId)}`);
        return;
      }
      const data = await send<{ client: ClientRow }>('POST', '/api/clients', {
        ...body,
        services: onServices.map(servicePayload),
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

  const partCard = (type: ServiceTypeRow) => {
    const entry = parts?.[type.id];
    if (!entry) return null;
    const label = type.name;
    const key = type.id;
    return (
      <div key={key} className={`ct-svc${entry.on ? ' on' : ''}`}>
        <div className="ct-svc-head">
          <IconBox part={type.part} muted={!entry.on} />
          <span className="ct-svc-name">{label}</span>
          {!entry.on && <span className="ct-svc-off">Not with us</span>}
          <span className="ct-svc-actions">
            <Switch on={entry.on} label={`${label} is with us`} onChange={(on) => setParts((p) => ({ ...p!, [key]: { ...p![key], on } }))} />
          </span>
        </div>
        {entry.on && (
          <div className="ct-svc-body">
            <ServiceFields
              draft={entry.draft}
              idPrefix={`p-${type.part}`}
              symbol={cfg.symbol}
              onChange={(draft) => setParts((p) => ({ ...p!, [key]: { ...p![key], draft } }))}
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
                {!form.whatsapp && (
                  <TextField
                    id="c-wa"
                    type="tel"
                    label="WhatsApp number"
                    value={form.whatsapp_number}
                    maxLength={40}
                    tip="Used by the WhatsApp button when the phone number is not on WhatsApp."
                    onChange={(v) => set('whatsapp_number', v)}
                  />
                )}
                <TextField
                  id="c-site"
                  label="Main website or domain"
                  value={form.website}
                  maxLength={253}
                  placeholder="example.com"
                  tip="Type it once. The website, email and maintenance plan all use it."
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
                <AreaField
                  id="c-notes"
                  label="Notes about the client"
                  rows={3}
                  value={form.notes}
                  tip="Anything you would want to remember before calling them."
                  onChange={(v) => set('notes', v)}
                />
              </div>

              {billingOpen ? (
                <div className="ct-billing">
                  <div className="ct-billing-head">
                    <span>Billing details</span>
                    <Tip text="Fills “Invoiced To” on their invoices, with the contact person and email above. Changing it here does not change invoices already made." />
                  </div>
                  <div className="ct-grid three">
                    <TextField id="c-street" label="Street address" value={form.address_street} placeholder="12 Allen Avenue" onChange={(v) => set('address_street', v)} />
                    <TextField id="c-city" label="City, State, Postal code" value={form.address_city} placeholder="Ikeja, Lagos 100001" onChange={(v) => set('address_city', v)} />
                    <TextField id="c-country" label="Country" value={form.address_country} maxLength={100} placeholder="Nigeria" onChange={(v) => set('address_country', v)} />
                    <TextField id="c-tax" label="Tax ID" value={form.tax_id} maxLength={60} onChange={(v) => set('tax_id', v)} />
                  </div>
                </div>
              ) : (
                <div className="ct-billing closed">
                  <button type="button" className="btn btn-ghost btn-sm" aria-expanded={false} onClick={() => setBillingOpen(true)}>
                    + Add billing details
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="ct-card">
            <div className="ct-card-head">
              <div>
                <h2>
                  What do they have with us?
                  <Tip text="Switching a service off hides it. What you typed is kept until you save, so switching it back on brings it back." />
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
                  {core.map(partCard)}

                  <div className={`ct-svc${others.length ? ' on' : ''}`}>
                    <div className="ct-svc-head">
                      <IconBox muted={!others.length} />
                      <span className="ct-svc-name">Other services</span>
                      <Tip text="Anything you sell that is not one of the services above. The list comes from Settings → Clients → Service types. Pick Something else for anything not in the list." />
                    </div>
                    <div className="ct-svc-body">
                      <div className="ct-chips">
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#525252' }}>Add</span>
                        {addable.map((t: ServiceTypeRow) => (
                          <button key={t.id} type="button" className="ct-chip-add" onClick={() => setOthers((o) => [...o, draftFromType(t)])}>
                            <PartIcon part={t.part} size={12} />
                            {t.name}
                          </button>
                        ))}
                      </div>
                      {others.map((draft, index) => (
                        <div key={index} className="ct-svc on">
                          <div className="ct-svc-head">
                            <IconBox part={draft.typePart} kind={draft.mode} />
                            <span className="ct-svc-name">{draft.typePart === 'other' ? draft.name || 'Something else' : draft.typeName}</span>
                            <span className="ct-kind">{MODE_LABEL[draft.mode]}</span>
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
            const name = s.typePart === 'other' ? s.name || 'Something else' : s.name || s.typeName;
            const fixed = !modesFor(s.typePart).length;
            const rows: [string, string][] = [];
            const due = fixed || s.mode === 'oneoff' ? s.due_at : null;
            const next = fixed || s.mode !== 'oneoff' ? s.next_at : null;
            const recurs = next === null ? null : fixed ? 'renews' : s.mode === 'oneoff' ? null : s.mode;
            const open = s.status === 'not_started' || s.status === 'in_progress';
            if (due !== null && open) {
              for (const d of reminderDays('due', type, cfg.rules)) {
                const at = due - d * DAY_MS;
                if (at >= today) rows.push([`Due reminder, ${d} ${d === 1 ? 'day' : 'days'} before`, cfg.fmt(at)]);
              }
            }
            if (next !== null && recurs) {
              for (const d of reminderDays(recurs, type, cfg.rules)) {
                const at = next - d * DAY_MS;
                if (at >= today) rows.push([recurs === 'scheduled' ? 'Scheduled reminder' : `Renewal reminder, ${d} ${d === 1 ? 'day' : 'days'} before`, cfg.fmt(at)]);
              }
            }
            if (!rows.length) rows.push([due === null && next === null ? 'No date yet' : 'Nothing ahead', 'No reminders']);
            const drafts: string[] = [];
            if (due !== null || (!fixed && s.mode === 'oneoff')) {
              if (s.status !== 'cancelled' && s.amount > 0 && cfg.rules.jobInvoice !== 'none') drafts.push(cfg.rules.jobInvoice === 'start' ? 'When the work starts' : 'When it is delivered');
            }
            if (next !== null && recurs && cfg.rules.autoDraft && s.amount > 0) {
              const at = draftDateFor({ recurs, repeats: fixed ? 'yearly' : s.repeats, next_at: next, amount: s.amount }, cfg.rules);
              if (at !== null) drafts.push(at <= today ? 'The morning after you save' : cfg.fmt(at));
            }
            const how = fixed ? (next !== null ? 'Renews yearly' : 'One-off') : s.mode === 'oneoff' ? 'One-off' : `${MODE_LABEL[s.mode]} · ${REPEATS_LABEL[s.repeats].toLowerCase()}`;
            return (
              <div key={i} className="ct-next-block">
                <div className="ct-next-title">
                  <PartIcon part={s.typePart} kind={s.mode} />
                  {name}
                </div>
                <div className="ct-next-sub">{how}</div>
                {rows.map(([k, v]) => (
                  <div key={k + v} className="ct-next-row">
                    <span>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
                {drafts.map((d) => (
                  <div key={d} className="ct-next-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                    <span className="ct-chipline blue">Draft invoice</span>
                    <span>{d}</span>
                  </div>
                ))}
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
