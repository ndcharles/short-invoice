'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/layout/shell';
import { countdown, dueBucket, JOB_STATUS_LABEL, type DueBucket, type DueRow, type JobStatus } from '@/lib/clients';
import { fmtMoney } from '@/lib/invoices';
import { send, useClientSettings } from '@/lib/use-clients';
import { showToast } from '@/components/toast';
import { RenewDialog, VisitDialog } from '@/components/clients/dialogs';
import { IconBox } from '@/components/clients/ui';

const GROUPS: { id: DueBucket; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'later', label: 'Later' },
];

/** Every client's renewals, visits and job due dates, soonest first. */
export default function DueDatesPage() {
  const cfg = useClientSettings();
  const [rows, setRows] = useState<DueRow[] | null>(null);
  const [filter, setFilter] = useState('');
  const [laterOpen, setLaterOpen] = useState(false);
  const [renewing, setRenewing] = useState<DueRow | null>(null);
  const [visiting, setVisiting] = useState<DueRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await send<{ services: DueRow[] }>('GET', '/api/clients/due')).services);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load');
    }
  }, []);
  useEffect(() => {
    // Loading data for this view from the API, not deriving state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const names = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.name))).sort(), [rows]);
  const grouped = useMemo(() => {
    const out: Record<DueBucket, DueRow[]> = { overdue: [], week: [], month: [], later: [] };
    for (const r of rows ?? []) if (!filter || r.name === filter) out[dueBucket(r.next_date as number)].push(r);
    return out;
  }, [rows, filter]);

  const act = async (fn: () => Promise<string>) => {
    try {
      showToast(await fn());
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'info');
    }
  };

  const action = (r: DueRow) => {
    if (r.kind === 'renews') return <button className="btn btn-outline btn-sm" onClick={() => setRenewing(r)}>Renew</button>;
    if (r.kind === 'visits')
      return (
        <button className="btn btn-outline btn-sm" onClick={() => setVisiting(r)}>
          Mark visit done
        </button>
      );
    const next: JobStatus = r.job_status === 'not_started' ? 'in_progress' : 'delivered';
    return (
      <button className="btn btn-outline btn-sm" onClick={() => void act(async () => {
        const res = await send<{ invoice: { number: string } | null }>('PATCH', `/api/clients/services/${r.id}`, { job_status: next });
        return res.invoice ? `${r.name}: draft invoice ${res.invoice.number} created` : `${r.name}: ${JOB_STATUS_LABEL[next].toLowerCase()}`;
      })}>
        {next === 'in_progress' ? 'Start' : 'Mark delivered'}
      </button>
    );
  };

  return (
    <Shell>
      <div className="ct-page">
        <nav className="ct-crumbs" aria-label="Breadcrumb">
          <Link href="/clients">Clients</Link>
          <span aria-hidden="true">›</span>
          <strong>Due dates</strong>
        </nav>
        <div className="page-header" style={{ paddingTop: 0 }}>
          <div>
            <div className="page-title">Due dates</div>
            <div className="ct-sub">Renewals, maintenance visits and one-off jobs across every client.</div>
          </div>
        </div>

        {names.length > 1 && (
          <div className="ct-pills" style={{ marginBottom: 8 }}>
            <button type="button" className={`ct-pill${!filter ? ' on' : ''}`} onClick={() => setFilter('')}>All</button>
            {names.map((n) => (
              <button key={n} type="button" className={`ct-pill${filter === n ? ' on' : ''}`} onClick={() => setFilter(filter === n ? '' : n)}>{n}</button>
            ))}
          </div>
        )}

        {error && <div className="ct-error">{error}</div>}
        {rows === null || !cfg.loaded ? (
          <div className="ct-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <h3>Nothing due</h3>
            <p>Services with a renewal date, a visit date or a due date show up here.</p>
          </div>
        ) : (
          GROUPS.map((g) => {
            const list = grouped[g.id];
            if (!list.length) return null;
            const collapsed = g.id === 'later' && !laterOpen;
            return (
              <section key={g.id} id={g.id}>
                <div className="ct-group-title">
                  {g.id === 'later' ? (
                    <button type="button" onClick={() => setLaterOpen(!laterOpen)} aria-expanded={!collapsed}>
                      {collapsed ? '▸' : '▾'} {g.label}
                    </button>
                  ) : (
                    g.label
                  )}
                  <span className="list-tab-count">{list.length}</span>
                </div>
                {!collapsed && (
                  <div className="ct-table">
                    <div className="ct-table-inner">
                      {list.map((r) => {
                        const tone = g.id === 'overdue' ? 'red' : g.id === 'week' ? 'amber' : '';
                        const invoiced = r.invoiced_for !== null && r.invoiced_for === r.next_date;
                        return (
                          <div key={r.id} className="ct-row ct-cols-due">
                            <div className="ct-who">
                              <IconBox part={r.part} kind={r.kind} />
                              <div>
                                <div className="ct-strong">{r.name}</div>
                                <div className="ct-muted">{r.kind === 'job' ? `One-off job · ${JOB_STATUS_LABEL[(r.job_status || 'not_started') as JobStatus]}` : r.kind === 'visits' ? 'Visit' : 'Renewal'}</div>
                              </div>
                            </div>
                            <Link className="ct-strong" href={`/clients/view?id=${encodeURIComponent(r.client_id)}`}>{r.client_name}</Link>
                            <div>
                              <div>{cfg.fmt(r.next_date)}</div>
                              <span className={`ct-chipline ${tone}`}>{countdown(r.next_date as number)}</span>
                            </div>
                            <div>
                              <div className="ct-num">{r.price > 0 ? fmtMoney(r.kind === 'job' ? r.price * (r.quantity || 1) : r.price, r.currency) : '—'}</div>
                              {invoiced && r.invoice_id && (
                                <Link className="ct-chipline blue" href={`/invoices/edit?id=${encodeURIComponent(r.invoice_id)}`}>Draft ready</Link>
                              )}
                            </div>
                            <div className="ct-actions">{action(r)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
      {visiting && (
        <VisitDialog service={visiting} clientName={visiting.client_name} onClose={() => setVisiting(null)} onDone={(m) => { showToast(m); void load(); }} />
      )}
      {renewing && (
        <RenewDialog service={renewing} clientName={renewing.client_name} onClose={() => setRenewing(null)} onDone={(m) => { showToast(m); void load(); }} />
      )}
    </Shell>
  );
}
