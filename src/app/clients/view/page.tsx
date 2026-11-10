'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import {
  CLIENT_STATUS_LABEL,
  PER_LABEL,
  REPEATS_LABEL,
  STATUS_LABEL,
  countdown,
  datesOf,
  daysUntil,
  isActive,
  serviceLabel,
  workOpen,
  type ClientNote,
  type ClientRow,
  type ComingUp,
  type ServiceRow,
  type Status,
} from '@/lib/clients';
import { fmtMoney, invoiceStatusPill } from '@/lib/invoices';
import type { InvoiceRow } from '@/lib/types';
import { send, useClientSettings, useServiceTypes } from '@/lib/use-clients';
import { useMe, useTeam } from '@/lib/team';
import { showToast } from '@/components/toast';
import { useConfirm } from '@/components/invoices/choice-modal';
import { DoneDialog, ServiceDialog, RenewDialog } from '@/components/clients/dialogs';
import { IconBox, initialsOf } from '@/components/clients/ui';
import { Edit, More, Plus } from '@/components/icons';
import { usePopoverDismiss } from '@/lib/popover';
import { Portal } from '@/components/portal';

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
  const [doing, setDoing] = useState<ServiceRow | null>(null);
  const [menu, setMenu] = useState<{ id: string; left: number; top: number; up: boolean } | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [ask, confirmModal] = useConfirm();
  const closeMenu = useCallback(() => setMenu(null), []);
  usePopoverDismiss(menu !== null, closeMenu);
  useEffect(() => {
    if (!menu) return;
    // The menu is drawn above the page at a fixed spot, so it closes when the page scrolls under it.
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [menu, closeMenu]);

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
  // Cancelled or ended, or delivered with nothing coming back: tucked under "Show ended or delivered".
  const finished = (s: ServiceRow) => !isActive(s) || (s.status === 'delivered' && s.next_at === null);
  const active = services.filter((s) => !finished(s));
  const ended = services.filter(finished);
  const dated = active.flatMap((s) => datesOf(s).map((d) => ({ s, ...d })));
  const overdue = dated.filter((d) => daysUntil(d.date) < 0);
  const next = dated.filter((d) => daysUntil(d.date) >= 0).sort((a, b) => a.date - b.date)[0];
  const unpaidInvoices = (data?.invoices ?? []).filter((inv) => inv.status === 'overdue');

  if (error) return <div className="ct-page"><div className="ct-error">{error}</div></div>;
  if (!data || !cfg.loaded) return <div className="ct-page ct-empty">Loading…</div>;
  const { client, totals } = data;
  const waDigits = (client.whatsapp ? client.phone : client.whatsapp_number).replace(/[^\d]/g, '');

  const setStatus = (s: ServiceRow, status: Status) =>
    act(async () => {
      const res = await send<{ invoice: { number: string } | null }>('PATCH', `/api/clients/services/${s.id}`, { status });
      return res.invoice ? `${s.name}: ${STATUS_LABEL[status].toLowerCase()}. Draft invoice ${res.invoice.number} created.` : `${s.name}: ${STATUS_LABEL[status].toLowerCase()}`;
    });

  const primaryAction = (s: ServiceRow) => {
    if (!isActive(s)) return null;
    if (workOpen(s) && (s.due_at !== null || s.recurs === null)) {
      return s.status === 'not_started' ? (
        <button className="btn btn-outline btn-sm" onClick={() => void setStatus(s, 'in_progress')}>Start</button>
      ) : (
        <button className="btn btn-outline btn-sm" onClick={() => void setStatus(s, 'delivered')}>Mark delivered</button>
      );
    }
    if (s.next_at === null) return null;
    const late = daysUntil(s.next_at) < 0;
    if (s.recurs === 'renews')
      return (
        <button className={`btn btn-sm ${late ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRenewing(s)}>
          {late ? 'Renew now' : 'Renew'}
        </button>
      );
    if (s.recurs === 'scheduled')
      return (
        <button className="btn btn-outline btn-sm" onClick={() => setDoing(s)}>
          Mark done
        </button>
      );
    return null;
  };

  const dateCell = (s: ServiceRow) => {
    if (s.ended_at) return <div className="ct-muted">{s.status === 'cancelled' ? 'Cancelled' : 'Ended'} {cfg.fmt(s.ended_at)}</div>;
    const dates = datesOf(s);
    if (!dates.length) return <div className="ct-muted">{s.status === 'delivered' ? 'Delivered' : 'No date'}</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {dates.map((d) => {
          const left = daysUntil(d.date);
          const tone = left < 0 ? 'red' : left <= 30 ? 'amber' : '';
          const word = d.what === 'due' ? 'Due' : d.what === 'scheduled' ? 'Next' : left < 0 ? 'Was due to renew' : 'Renews';
          return (
            <div key={d.what}>
              <div>{word} {cfg.fmt(d.date)}</div>
              <span className={`ct-chipline ${tone}`} style={{ marginTop: 3 }}>{countdown(d.date)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const subLine = (s: ServiceRow) => {
    const parts = s.parts ?? [];
    const prov = (p: string) => parts.find((x) => x.part === p);
    const email = prov('email');
    const bits =
      s.type_part === 'maintenance'
        ? [parts.length ? `looks after ${parts.map((p) => (p.part === 'other' && p.provider ? p.provider : p.part)).join(', ').toLowerCase()}` : '']
        : [
            prov('website')?.provider,
            prov('domain')?.provider ? `domain: ${prov('domain')!.provider}` : '',
            prov('hosting')?.provider ? `hosting: ${prov('hosting')!.provider}` : '',
            email?.provider,
            email?.count ? `${email.count} mailboxes` : '',
            prov('other')?.provider,
          ];
    const how = s.recurs === 'scheduled' ? `Scheduled ${REPEATS_LABEL[s.repeats].toLowerCase()}` : s.recurs === 'renews' ? `Renews ${REPEATS_LABEL[s.repeats].toLowerCase()}` : 'One-off';
    return [STATUS_LABEL[s.status], how, ...bits, s.details ? s.details.split('\n')[0] : ''].filter(Boolean).join(' · ');
  };

  const openMenu = (s: ServiceRow, el: HTMLElement) => {
    if (menu?.id === s.id) return setMenu(null);
    const r = el.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 220;
    setMenu({ id: s.id, left: Math.max(8, Math.min(r.right - 200, window.innerWidth - 208)), top: up ? r.top - 4 : r.bottom + 4, up });
  };

  const menuFor = (s: ServiceRow) => (
    <Portal>
      <div
        className="dropdown ct-floating-menu"
        data-popover
        role="menu"
        style={{ position: 'fixed', left: menu!.left, right: 'auto', top: menu!.top, transform: menu!.up ? 'translateY(-100%)' : undefined, width: 200 }}
      >
        <div className="dropdown-item" role="menuitem" onClick={() => { setMenu(null); setEditing(s); }}>Edit</div>
        {s.status === 'in_progress' && (
          <div className="dropdown-item" role="menuitem" onClick={() => { setMenu(null); void setStatus(s, 'not_started'); }}>Mark not started</div>
        )}
        {s.status === 'delivered' && (
          <div className="dropdown-item" role="menuitem" onClick={() => { setMenu(null); void setStatus(s, 'in_progress'); }}>Reopen (in progress)</div>
        )}
        {s.status !== 'cancelled' && s.recurs !== null && (
          <div className="dropdown-item" role="menuitem" onClick={() => { setMenu(null); void act(async () => {
            await send('PATCH', `/api/clients/services/${s.id}`, { ended: !s.ended_at });
            return s.ended_at ? `${s.name} restored` : `${s.name} ended. No more reminders for it.`;
          }); }}>
            {s.ended_at ? 'Restore' : 'End this service'}
          </div>
        )}
        {s.status === 'cancelled' ? (
          <div className="dropdown-item" role="menuitem" onClick={() => { setMenu(null); void setStatus(s, 'not_started'); }}>Restore</div>
        ) : (
          <div className="dropdown-item" role="menuitem" onClick={() => { setMenu(null); void setStatus(s, 'cancelled'); }}>Cancel</div>
        )}
        {admin && (
          <div className="dropdown-item" role="menuitem" style={{ color: 'var(--destructive)' }} onClick={() => { setMenu(null); void (async () => {
            const ok = await ask({ title: `Remove ${s.name}?`, message: 'It is removed from this client with its reminders. Invoices already made stay.', confirmLabel: 'Remove', destructive: true });
            if (ok) await act(async () => { await send('DELETE', `/api/clients/services/${s.id}`); return `${s.name} removed`; });
          })(); }}>
            Remove
          </div>
        )}
      </div>
    </Portal>
  );

  const serviceRow = (s: ServiceRow) => {
    const oneoff = s.recurs === null;
    const total = oneoff ? s.amount * (s.quantity || 1) : s.amount;
    return (
      <div key={s.id} className="ct-row ct-cols-services">
        <div className="ct-who">
          <IconBox part={s.type_part} kind={s.recurs ?? undefined} muted={finished(s)} />
          <div>
            <div className="ct-strong">{serviceLabel(s)}</div>
            <div className="ct-muted">{subLine(s)}</div>
          </div>
        </div>
        {dateCell(s)}
        <div>
          <div className="ct-num" style={{ fontWeight: 500 }}>{total > 0 ? fmtMoney(total, s.currency) : '—'}</div>
          <div className="ct-muted">{oneoff ? (s.quantity > 1 ? `${s.quantity} × ${fmtMoney(s.amount, s.currency)}` : 'once') : PER_LABEL[s.repeats].replace('/ ', 'per ')}</div>
        </div>
        <div className="ct-actions" data-popover-root>
          {primaryAction(s)}
          <button className="icon-btn" aria-label={`More actions for ${s.name}`} aria-expanded={menu?.id === s.id} onClick={(e) => openMenu(s, e.currentTarget)}>
            <More />
          </button>
          {menu?.id === s.id && menuFor(s)}
        </div>
      </div>
    );
  };

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
            {[client.contact_name, client.website].filter(Boolean).join(' · ') || 'No contact details yet'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {client.email && <a className="btn btn-outline btn-sm" href={`mailto:${client.email}`}>Email</a>}
          {waDigits ? (
            <a className="btn btn-outline btn-sm" href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
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
              ...overdue.map((d) => `${d.s.name} ${d.what === 'due' ? 'was due' : d.what === 'renews' ? 'expired' : 'was scheduled'} ${cfg.fmt(d.date)}`),
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
              {!client.whatsapp && client.whatsapp_number && <div><span className="k">WhatsApp</span><span className="v">{client.whatsapp_number}</span></div>}
              {client.website && <div><span className="k">Main website or domain</span><span className="v">{client.website}</span></div>}
              {(client.address_street || client.address_city || client.address_country) && (
                <div><span className="k">Billing address</span><span className="v">{[client.address_street, client.address_city, client.address_country].filter(Boolean).join(', ')}</span></div>
              )}
              {client.tax_id && <div><span className="k">Tax ID</span><span className="v">{client.tax_id}</span></div>}
              {!client.contact_name && !client.email && !client.phone && !client.website && !client.address_street && !client.address_city && <div className="ct-muted">No contact details yet.</div>}
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
              <div className="v">{next ? cfg.fmt(next.date).replace(/ \d{4}$/, '') : '—'}</div>
              <div className="s amber">{next ? `${next.s.name}, ${countdown(next.date)}` : 'Nothing coming up'}</div>
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
              <div className="ct-empty">No invoices yet. Renewing a service or delivering work drafts one.</div>
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
      {doing && (
        <DoneDialog
          service={doing}
          clientName={client.name}
          onClose={() => setDoing(null)}
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
