'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import { CLIENT_STATUS_LABEL, countdown, daysUntil, dueBucket, type ClientSummary, type DueRow } from '@/lib/clients';
import { fmtMoney } from '@/lib/invoices';
import { send, useClientSettings } from '@/lib/use-clients';
import { initialsOf, PartIcon } from '@/components/clients/ui';
import { Plus, Search } from '@/components/icons';

type Tab = 'all' | 'active' | 'prospect' | 'past';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'prospect', label: 'Prospects' },
  { id: 'past', label: 'Past' },
];
const SORTS = [
  { id: 'next', label: 'Next date first' },
  { id: 'name', label: 'Name' },
  { id: 'unpaid', label: 'Most unpaid' },
] as const;
const STATUS_TONE: Record<string, string> = { active: 'green', prospect: 'blue', past: '' };

export default function ClientsPage() {
  const router = useRouter();
  const cfg = useClientSettings();
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [due, setDue] = useState<DueRow[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('next');
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (archived) params.set('archived', '1');
    Promise.all([send<{ clients: ClientSummary[] }>('GET', `/api/clients?${params}`), send<{ services: DueRow[] }>('GET', '/api/clients/due')])
      .then(([list, dueList]) => {
        if (cancelled) return;
        setClients(list.clients);
        setDue(dueList.services);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load clients'));
    return () => {
      cancelled = true;
    };
  }, [search, archived]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: 0, active: 0, prospect: 0, past: 0 };
    for (const client of clients ?? []) {
      c.all += 1;
      c[client.status] += 1;
    }
    return c;
  }, [clients]);
  const strip = useMemo(() => {
    const out = { overdue: 0, week: 0, month: 0 };
    for (const s of due) {
      const b = dueBucket(s.next_date as number);
      if (b === 'overdue') out.overdue += 1;
      else if (b === 'week') out.week += 1;
      else if (b === 'month') out.month += 1;
    }
    return out;
  }, [due]);

  const rows = useMemo(() => {
    const list = (clients ?? []).filter((c) => tab === 'all' || c.status === tab);
    return list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'unpaid') return b.unpaid - a.unpaid;
      return (a.next_date ?? Infinity) - (b.next_date ?? Infinity) || a.name.localeCompare(b.name);
    });
  }, [clients, tab, sort]);

  return (
    <Shell>
      <div className="ct-page">
        <div className="page-header">
          <div className="page-title">Clients</div>
          <Link className="btn btn-primary" href="/clients/new">
            <Plus />
            <span>New client</span>
          </Link>
        </div>

        <div className="ct-strip" style={{ marginBottom: 16 }}>
          <button className="ct-tile" onClick={() => router.push('/clients/due#overdue')}>
            <div className="k">Overdue</div>
            <div className="v">{strip.overdue}</div>
            <div className={`s${strip.overdue ? ' red' : ''}`}>{strip.overdue ? 'Renew or follow up' : 'Nothing overdue'}</div>
          </button>
          <button className="ct-tile" onClick={() => router.push('/clients/due#week')}>
            <div className="k">Due in 7 days</div>
            <div className="v">{strip.week}</div>
            <div className="s amber">This week</div>
          </button>
          <button className="ct-tile" onClick={() => router.push('/clients/due#month')}>
            <div className="k">Due in 30 days</div>
            <div className="v">{strip.month}</div>
            <div className="s">This month</div>
          </button>
        </div>

        <div className="list-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`list-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)} style={{ border: 0, background: 'none', font: 'inherit' }}>
              {t.label} <span className="list-tab-count">{counts[t.id]}</span>
            </button>
          ))}
        </div>

        <div className="toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
          <select className="ct-input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <label className="ct-check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Show archived
          </label>
          <div className="toolbar-spacer" style={{ flex: 1 }} />
          <div className="search">
            <Search />
            <input placeholder="Search name, contact, email or website" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {error && <div className="ct-error">{error}</div>}

        {clients === null || !cfg.loaded ? (
          <div className="ct-empty">Loading…</div>
        ) : clients.length === 0 && !search && !archived ? (
          <div className="empty">
            <h3>No clients yet</h3>
            <p>Log your first client and what they have with you. Their renewals, schedules and jobs then remind you on time.</p>
            <Link className="btn btn-primary" href="/clients/new">
              <Plus />
              <span>New client</span>
            </Link>
          </div>
        ) : rows.length === 0 ? (
          <div className="ct-empty">No clients match.</div>
        ) : (
          <div className="ct-table">
            <div className="ct-table-inner">
              <div className="ct-row head ct-cols-clients">
                <span>Client</span>
                <span>Services</span>
                <span>Next date</span>
                <span>Unpaid</span>
                <span>Status</span>
              </div>
              {rows.map((c) => {
                const left = c.next_date === null ? null : daysUntil(c.next_date);
                const tone = left === null ? '' : left < 0 ? 'red' : left <= 30 ? 'amber' : '';
                return (
                  <div key={c.id} className="ct-row link ct-cols-clients" onClick={() => router.push(`/clients/view?id=${encodeURIComponent(c.id)}`)}>
                    <div className="ct-who">
                      <span className="ct-avatar">{initialsOf(c.name)}</span>
                      <div>
                        <Link className="ct-strong" href={`/clients/view?id=${encodeURIComponent(c.id)}`} onClick={(e) => e.stopPropagation()} style={{ display: 'block' }}>
                          {c.name}
                        </Link>
                        <div className="ct-muted">{[c.contact_name, c.website].filter(Boolean).join(' · ') || '—'}</div>
                      </div>
                    </div>
                    <div className="ct-icons" aria-label={`${c.services} services`}>
                      {c.services === 0 ? (
                        <span className="ct-muted" style={{ border: 0, width: 'auto' }}>None yet</span>
                      ) : (
                        c.parts.slice(0, 5).map((p) => (
                          <span key={p} title={p}>
                            <PartIcon part={p} size={13} />
                          </span>
                        ))
                      )}
                    </div>
                    <div>
                      {c.next_date === null ? (
                        <span className="ct-muted">Nothing coming up</span>
                      ) : (
                        <>
                          <div className="ct-muted" style={{ color: 'var(--foreground)' }}>{c.next_name} · {cfg.fmt(c.next_date)}</div>
                          <span className={`ct-chipline ${tone}`}>{countdown(c.next_date)}</span>
                        </>
                      )}
                    </div>
                    <div className="ct-num">
                      {c.unpaid > 0 ? fmtMoney(c.unpaid, cfg.currency) : '—'}
                      {c.overdue_invoices > 0 && <div className="ct-muted" style={{ color: '#991b1b' }}>{c.overdue_invoices} overdue</div>}
                    </div>
                    <span className={`ct-chipline ${STATUS_TONE[c.status]}`} style={{ justifySelf: 'start' }}>{CLIENT_STATUS_LABEL[c.status]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <div className="pagination">
            <div>Showing {rows.length} of {counts.all} clients</div>
          </div>
        )}
      </div>
    </Shell>
  );
}
