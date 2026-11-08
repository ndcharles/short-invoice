'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import {
  CLIENT_STATUS_LABEL,
  JOB_STATUS_LABEL,
  countdown,
  daysUntil,
  parseMeta,
  parseTags,
  type ClientNote,
  type ClientRow,
  type ComingUp,
  type JobStatus,
  type ServiceRow,
} from '@/lib/clients';
import { fmtMoney, invoiceStatusPill } from '@/lib/invoices';
import type { InvoiceRow } from '@/lib/types';
import { send, useClientSettings, useServiceTypes } from '@/lib/use-clients';
import { useMe, useTeam } from '@/lib/team';
import { showToast } from '@/components/toast';
import { useConfirm } from '@/components/invoices/choice-modal';
import { ServiceDialog, RenewDialog, VisitDialog } from '@/components/clients/dialogs';
import { IconBox, initialsOf } from '@/components/clients/ui';
import { Edit, More, Plus } from '@/components/icons';
import { usePopoverDismiss } from '@/lib/popover';

interface Detail {
  client: ClientRow;
  services: ServiceRow[];
  invoices: InvoiceRow[];
  notes: ClientNote[];
  coming_up: ComingUp[];
  totals: { unpaid: number; overdue_invoices: number; billed_this_year: number; invoices_this_year: number };
}

const STATUS_TONE: Record<string, string> = { active: 'green', prospect: 'blue', past: '' };

export default function ClientViewPage() {
  return (
    <Shell>
      <Suspense fallback={null}>
        <ClientView />
      </Suspense>
    </Shell>
  );
}

function ClientView() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const cfg = useClientSettings();
  const { types } = useServiceTypes();
  const { me } = useMe();
  const admin = me?.role === 'admin';
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [renewing, setRenewing] = useState<ServiceRow | null>(null);
  const [visiting, setVisiting] = useState<ServiceRow | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [ask, confirmModal] = useConfirm();
  usePopoverDismiss(menu !== null, () => setMenu(null));

  const load = useCallback(async () => {
    try {
      setData(await send<Detail>('GET', `/api/clients/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the client');
    }
  }, [id]);
  useEffect(() => {
    // Loading data for this view from the API, not deriving state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = async (fn: () => Promise<string | null>) => {
    try {
      const message = await fn();
      if (message) showToast(message);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const services = useMemo(() => data?.services ?? [], [data]);
  const active = services.filter((s) => !s.ended_at);
  const ended = services.filter((s) => s.ended_at);
  const overdue = active.filter((s) => s.next_date !== null && daysUntil(s.next_date) < 0);
  const next = active.filter((s) => s.next_date !== null && daysUntil(s.next_date) >= 0).sort((a, b) => (a.next_date ?? 0) - (b.next_date ?? 0))[0];
  const unpaidInvoices = (data?.invoices ?? []).filter((inv) => inv.status === 'overdue');

  if (error) return <div className="ct-page"><div className="ct-error">{error}</div></div>;
  if (!data || !cfg.loaded) return <div className="ct-page ct-empty">Loading…</div>;
  const { client, totals } = data;
  const tags = parseTags(client.tags);
  const phoneDigits = client.phone.replace(/[^\d]/g, '');

  const setJob = (s: ServiceRow, job_status: JobStatus) =>
    act(async () => {
      const res = await send<{ invoice: { number: string } | null }>('PATCH', `/api/clients/services/${s.id}`, { job_status });
      return res.invoice ? `${s.name}: ${JOB_STATUS_LABEL[job_status].toLowerCase()}. Draft invoice ${res.invoice.number} created.` : `${s.name}: ${JOB_STATUS_LABEL[job_status].toLowerCase()}`;
    });

  const primaryAction = (s: ServiceRow) => {
    if (s.ended_at) return null;
    if (s.kind === 'renews')
      return s.next_date === null ? null : (
        <button className={`btn btn-sm ${s.next_date !== null && daysUntil(s.next_date) < 0 ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRenewing(s)}>
          {s.next_date !== null && daysUntil(s.next_date) < 0 ? 'Renew now' : 'Renew'}
        </button>
      );
    if (s.kind === 'visits')
      return s.next_date === null ? null : (
        <button className="btn btn-outline btn-sm" onClick={() => setVisiting(s)}>
          Mark done
        </button>
      );
    if (s.job_status === 'not_started') return <button className="btn btn-outline btn-sm" onClick={() => void setJob(s, 'in_progress')}>Start</button>;
    return <button className="btn btn-outline btn-sm" onClick={() => void setJob(s, 'delivered')}>Mark delivered</button>;
  };

  const dateCell = (s: ServiceRow) => {
    if (s.ended_at) return <div className="ct-muted">{s.kind === 'job' ? 'Delivered' : 'Ended'} {cfg.fmt(s.ended_at)}</div>;
    if (s.next_date === null) return <div className="ct-muted">No date</div>;
    const left = daysUntil(s.next_date);
    const tone = left < 0 ? 'red' : left <= 30 ? 'amber' : '';
    const word = s.kind === 'job' ? 'Due' : s.kind === 'visits' ? 'Next scheduled' : left < 0 ? 'Was due' : 'Renews';
    return (
      <div>
        <div>{word} {cfg.fmt(s.next_date)}</div>
        <span className={`ct-chipline ${tone}`} style={{ marginTop: 3 }}>{countdown(s.next_date)}</span>
      </div>
    );
  };

  const subLine = (s: ServiceRow) => {
    const meta = parseMeta(s.meta);
    const bits = [
      s.kind === 'job' ? `One-off job · ${JOB_STATUS_LABEL[(s.job_status || 'not_started') as JobStatus]}` : s.cycle === 'monthly' ? 'Monthly' : 'Yearly',
      meta.registrar,
      meta.provider,
      meta.plan,
      meta.mailboxes ? `${meta.mailboxes} mailboxes` : '',
      meta.built_with,
      meta.looks_after?.length ? `looks after ${meta.looks_after.join(', ').toLowerCase()}` : '',
      s.details && s.kind !== 'renews' ? s.details.split('\n')[0] : '',
    ].filter(Boolean);
    return bits.join(' · ');
  };

  const serviceRow = (s: ServiceRow) => (
    <div key={s.id} className="ct-row ct-cols-services">
      <div className="ct-who">
        <IconBox part={s.part} kind={s.kind} muted={!!s.ended_at} />
        <div>
          <div className="ct-strong">{s.name}</div>
          <div className="ct-muted">{subLine(s)}</div>
        </div>
      </div>
      {dateCell(s)}
      <div>
        <div className="ct-num" style={{ fontWeight: 500 }}>
          {s.price > 0 ? fmtMoney(s.kind === 'job' ? s.price * (s.quantity || 1) : s.price, s.currency) : '—'}
        </div>
        <div className="ct-muted">
          {s.kind === 'job' ? (s.quantity > 1 ? `${s.quantity} × ${fmtMoney(s.price, s.currency)}` : 'once') : s.cycle === 'monthly' ? 'per month' : 'per year'}
          {s.invoice_id && (
            <> · <Link href={`/invoices/edit?id=${encodeURIComponent(s.invoice_id)}`}>invoice</Link></>
          )}
        </div>
      </div>
      <div className="ct-actions" data-popover-root style={{ position: 'relative' }}>
        {primaryAction(s)}
        <button className="icon-btn" aria-label={`More actions for ${s.name}`} onClick={() => setMenu(menu === s.id ? null : s.id)}>
          <More />
        </button>
        {menu === s.id && (
          <div className="dropdown" data-popover data-align="end" style={{ top: 'calc(100% + 4px)', right: 0, minWidth: 180 }}>
            <div className="dropdown-item" onClick={() => { setMenu(null); setEditing(s); }}>Edit</div>
            {s.kind === 'job' && s.job_status !== 'delivered' && s.job_status !== 'not_started' && (
              <div className="dropdown-item" onClick={() => { setMenu(null); void setJob(s, 'not_started'); }}>Mark not started</div>
            )}
            {s.kind === 'job' && s.job_status === 'delivered' && (
              <div className="dropdown-item" onClick={() => { setMenu(null); void setJob(s, 'in_progress'); }}>Reopen (in progress)</div>
            )}
            {s.kind !== 'job' && (
              <div className="dropdown-item" onClick={() => { setMenu(null); void act(async () => {
                await send('PATCH', `/api/clients/services/${s.id}`, { ended: !s.ended_at });
                return s.ended_at ? `${s.name} restored` : `${s.name} ended. No more reminders for it.`;
              }); }}>
                {s.ended_at ? 'Restore' : 'End this service'}
              </div>
            )}
            {admin && (
              <div className="dropdown-item" style={{ color: 'var(--destructive)' }} onClick={() => { setMenu(null); void (async () => {
                const ok = await ask({ title: `Remove ${s.name}?`, message: 'It is removed from this client with its reminders. Invoices already made stay.', confirmLabel: 'Remove', destructive: true });
                if (ok) await act(async () => { await send('DELETE', `/api/clients/services/${s.id}`); return `${s.name} removed`; });
              })(); }}>
                Remove
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="ct-page">
      <nav className="ct-crumbs" aria-label="Breadcrumb">
        <Link href="/clients">Clients</Link>
        <span aria-hidden="true">›</span>
        <strong>{client.name}</strong>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <span className="ct-avatar lg">{initialsOf(client.name)}</span>
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <h1 className="ct-h1" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {client.name}
            <span className={`ct-chipline ${STATUS_TONE[client.status]}`}>{CLIENT_STATUS_LABEL[client.status]}</span>
            {client.archived ? <span className="ct-chipline">Archived</span> : null}
          </h1>
          <div className="ct-sub">
            {[client.contact_name, client.website, ...tags].filter(Boolean).join(' · ') || 'No contact details yet'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {client.email && <a className="btn btn-outline btn-sm" href={`mailto:${client.email}`}>Email</a>}
          {client.whatsapp && phoneDigits ? (
            <a className="btn btn-outline btn-sm" href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          ) : null}
          <Link className="btn btn-outline btn-sm" href={`/clients/new?id=${encodeURIComponent(client.id)}`}>
            <Edit /> Edit
          </Link>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)} disabled={!types}>
            <Plus /> Add service
          </button>
        </div>
      </div>

      {(overdue.length > 0 || unpaidInvoices.length > 0) && (
        <div className="ct-banner" role="status" style={{ marginBottom: 16 }}>
          <strong>Needs attention:</strong>
          <span>
            {[
              ...overdue.map((s) => `${s.name} ${s.kind === 'job' ? 'was due' : 'expired'} ${cfg.fmt(s.next_date)}`),
              ...unpaidInvoices.map((inv) => `${inv.number} is overdue`),
            ].join(' · ')}
          </span>
        </div>
      )}

      <div className="ct-layout">
        <aside className="ct-rail left">
          <section className="ct-card">
            <div className="ct-card-head"><h2>Contact</h2></div>
            <div className="ct-card-body ct-kv">
              {client.contact_name && <div><span className="k">Contact person</span><span className="v">{client.contact_name}</span></div>}
              {client.email && <div><span className="k">Email</span><span className="v">{client.email}</span></div>}
              {client.phone && <div><span className="k">Phone{client.whatsapp ? ' (also WhatsApp)' : ''}</span><span className="v">{client.phone}</span></div>}
              {client.website && <div><span className="k">Main website or domain</span><span className="v">{client.website}</span></div>}
              {client.billing_address && <div><span className="k">Billing address</span><span className="v">{client.billing_address}</span></div>}
              {client.tax_id && <div><span className="k">Tax ID</span><span className="v">{client.tax_id}</span></div>}
              {!client.contact_name && !client.email && !client.phone && !client.website && <div className="ct-muted">No contact details yet.</div>}
            </div>
          </section>
          <section className="ct-card">
            <div className="ct-card-head"><h2>Good to know</h2></div>
            <div className="ct-card-body ct-kv">
              <div><span className="k">Where the logins are kept</span><span className="v">{client.logins || '—'}</span></div>
              <div><span className="k">Notes about the client</span><span className="v">{client.notes || '—'}</span></div>
              <div><span className="k">Notes about their services</span><span className="v">{client.service_notes || '—'}</span></div>
            </div>
          </section>
        </aside>

        <div className="ct-main">
          <div className="ct-strip">
            <div className="ct-tile">
              <div className="k">Services</div>
              <div className="v">{active.length}</div>
              <div className={`s${overdue.length ? ' red' : ''}`}>{overdue.length ? `${overdue.length} overdue` : 'None overdue'}</div>
            </div>
            <div className="ct-tile">
              <div className="k">Next date</div>
              <div className="v">{next?.next_date ? cfg.fmt(next.next_date).replace(/ \d{4}$/, '') : '—'}</div>
              <div className="s amber">{next ? `${next.name}, ${countdown(next.next_date as number)}` : 'Nothing coming up'}</div>
            </div>
            <div className="ct-tile">
              <div className="k">Unpaid</div>
              <div className="v">{fmtMoney(totals.unpaid, cfg.currency)}</div>
              <div className={`s${totals.overdue_invoices ? ' red' : ''}`}>{totals.overdue_invoices ? `${totals.overdue_invoices} overdue` : 'Nothing overdue'}</div>
            </div>
            <div className="ct-tile">
              <div className="k">Billed this year</div>
              <div className="v">{fmtMoney(totals.billed_this_year, cfg.currency)}</div>
              <div className="s">{totals.invoices_this_year} {totals.invoices_this_year === 1 ? 'invoice' : 'invoices'}</div>
            </div>
          </div>

          <section className="ct-card">
            <div className="ct-card-head">
              <h2>Services <span className="list-tab-count">{active.length}</span></h2>
              <button className="btn btn-outline btn-sm" onClick={() => setAdding(true)} disabled={!types}>
                <Plus /> Add service
              </button>
            </div>
            {active.length === 0 && ended.length === 0 ? (
              <div className="ct-empty">Nothing with us yet. Add the first service.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div className="ct-table-inner">
                  <div className="ct-row head ct-cols-services">
                    <span>Service</span>
                    <span>Next date</span>
                    <span>Price</span>
                    <span />
                  </div>
                  {active.map(serviceRow)}
                  {ended.length > 0 && (
                    <div className="ct-row" style={{ display: 'block', background: 'var(--muted-2)', fontSize: 12.5 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowEnded(!showEnded)}>
                        {showEnded ? 'Hide' : 'Show'} ended or delivered ({ended.length})
                      </button>
                    </div>
                  )}
                  {showEnded && ended.map(serviceRow)}
                </div>
              </div>
            )}
          </section>

          <section className="ct-card">
            <div className="ct-card-head">
              <div>
                <h2>Coming up for this client</h2>
                <p>Reminders, schedules and invoice drafts, in date order.</p>
              </div>
            </div>
            {data.coming_up.length === 0 ? (
              <div className="ct-empty">Nothing scheduled.</div>
            ) : (
              <div>
                {data.coming_up.map((e, i) => (
                  <div key={i} className="ct-timeline-row">
                    <span className="d">{cfg.fmt(e.date).replace(/ \d{4}$/, '')}</span>
                    <span className="t">{e.text}</span>
                    {e.kind === 'draft' && <span className="ct-chipline blue">Draft invoice</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="ct-card">
            <div className="ct-card-head">
              <div>
                <h2>Invoices</h2>
                <p>Invoices made from this client&apos;s services.</p>
              </div>
            </div>
            {data.invoices.length === 0 ? (
              <div className="ct-empty">No invoices yet. Renewing a service or delivering a job drafts one.</div>
            ) : (
              <div>
                {data.invoices.map((inv) => {
                  const pill = invoiceStatusPill(inv.status);
                  return (
                    <div key={inv.id} className="ct-row link" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,2fr) minmax(0,1fr) 110px' }} onClick={() => router.push(`/invoices/edit?id=${encodeURIComponent(inv.id)}`)}>
                      <span className="ct-strong">{inv.number}</span>
                      <span className="ct-muted">{JSON.parse(inv.items || '[]')[0]?.name ?? ''}</span>
                      <span className="ct-num">{fmtMoney(Number(inv.total), inv.currency)}</span>
                      <span className={`inv-status ${pill.cls}`} style={{ justifySelf: 'end' }}>
                        <span className="inv-status-dot" />
                        {pill.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <NotesCard clientId={client.id} notes={data.notes} me={me?.email ?? ''} admin={admin} fmt={cfg.fmt} onChanged={load} />

          {admin && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => void act(async () => {
                await send('PATCH', `/api/clients/${client.id}`, { archived: !client.archived });
                return client.archived ? 'Client restored' : 'Client archived. They no longer get reminders.';
              })}>
                {client.archived ? 'Restore client' : 'Archive client'}
              </button>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--destructive)' }} onClick={() => void (async () => {
                const ok = await ask({ title: `Delete ${client.name}?`, message: 'The client and their services are removed for good. Their invoices stay in Invoices.', confirmLabel: 'Delete', destructive: true });
                if (!ok) return;
                await send('DELETE', `/api/clients/${client.id}`);
                router.push('/clients');
              })()}>
                Delete client
              </button>
            </div>
          )}
        </div>
      </div>

      {(adding || editing) && types && (
        <ServiceDialog
          client={client}
          service={editing}
          types={types}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(message) => { showToast(message); void load(); }}
        />
      )}
      {visiting && (
        <VisitDialog
          service={visiting}
          clientName={client.name}
          onClose={() => setVisiting(null)}
          onDone={(message) => { showToast(message); void load(); }}
        />
      )}
      {renewing && (
        <RenewDialog
          service={renewing}
          clientName={client.name}
          onClose={() => setRenewing(null)}
          onDone={(message) => { showToast(message); void load(); }}
        />
      )}
      {confirmModal}
    </div>
  );
}

/** Notes and activity: anything worth keeping about the client, optionally with a "remind me on" date. */
function NotesCard({ clientId, notes, me, admin, fmt, onChanged }: {
  clientId: string;
  notes: ClientNote[];
  me: string;
  admin: boolean;
  fmt: (ms: number | null | undefined) => string;
  onChanged: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [remind, setRemind] = useState('');
  const [saving, setSaving] = useState(false);
  const { nameOf } = useTeam();
  const add = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await send('POST', `/api/clients/${encodeURIComponent(clientId)}/notes`, { text, remind_at: remind || null });
      setText('');
      setRemind('');
      showToast(remind ? `Note saved. You will be reminded on ${fmt(Date.parse(`${remind}T00:00:00Z`))}.` : 'Note saved');
      await onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the note', 'info');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="ct-card">
      <div className="ct-card-head">
        <div>
          <h2>Notes and activity</h2>
          <p>Calls, promises and anything to remember. Only your team sees these.</p>
        </div>
      </div>
      <div className="ct-card-body">
        <div className="ct-field">
          <label className="ct-label" htmlFor="note-text">New note</label>
          <textarea id="note-text" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Called Adaeze. She will pay the SSL invoice by Friday." />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div className="ct-field" style={{ width: 200 }}>
            <label className="ct-label" htmlFor="note-remind">Remind me on (optional)</label>
            <input id="note-remind" type="date" value={remind} onChange={(e) => setRemind(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => void add()} disabled={saving || !text.trim()}>
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>
      {notes.length > 0 && (
        <div>
          {notes.map((n) => (
            <div key={n.id} className="ct-timeline-row">
              <span className="d">{fmt(n.at).replace(/ \d{4}$/, '')}</span>
              <span className="t">
                <span style={{ whiteSpace: 'pre-wrap', textDecoration: n.done && n.remind_at ? 'line-through' : undefined }}>{n.text}</span>
                <span className="ct-muted" style={{ display: 'block' }}>
                  {nameOf(n.author)}
                  {n.remind_at ? ` · reminder ${fmt(n.remind_at)}${n.done ? ' (done)' : ''}` : ''}
                </span>
              </span>
              <span style={{ display: 'flex', gap: 4 }}>
                {n.remind_at && (
                  <button className="btn btn-ghost btn-sm" onClick={() => void send('PATCH', `/api/clients/notes/${n.id}`, { done: !n.done }).then(onChanged)}>
                    {n.done ? 'Not done' : 'Done'}
                  </button>
                )}
                {(n.author === me || admin) && (
                  <button className="btn btn-ghost btn-sm" aria-label="Delete note" onClick={() => void send('DELETE', `/api/clients/notes/${n.id}`).then(onChanged)}>
                    Delete
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
