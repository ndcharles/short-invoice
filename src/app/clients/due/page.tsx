'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/layout/shell';
import { countdown, dueBucket, REPEATS_LABEL, STATUS_LABEL, serviceLabel, type DueBucket, type DueRow, type Status } from '@/lib/clients';
import { fmtMoney } from '@/lib/invoices';
import { send, useClientSettings } from '@/lib/use-clients';
import { showToast } from '@/components/toast';
import { DoneDialog, RenewDialog } from '@/components/clients/dialogs';
import { IconBox } from '@/components/clients/ui';

const GROUPS: { id: DueBucket; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'later', label: 'Later' },
];

/** Every client's renewals, schedules and job due dates, soonest first. */
export default function DueDatesPage() {
  const cfg = useClientSettings();
  const [rows, setRows] = useState<DueRow[] | null>(null);
  const [filter, setFilter] = useState('');
  const [laterOpen, setLaterOpen] = useState(false);
  const [renewing, setRenewing] = useState<DueRow | null>(null);
  const [doing, setDoing] = useState<DueRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await send<{ rows: DueRow[] }>('GET', '/api/clients/due')).rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load');
    }
  }, []);
  useEffect(() => {
    // Loading data for this view from the API, not deriving state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const names = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.service.name))).sort(), [rows]);
  const grouped = useMemo(() => {
    const out: Record<DueBucket, DueRow[]> = { overdue: [], week: [], month: [], later: [] };
    for (const r of rows ?? []) if (!filter || r.service.name === filter) out[dueBucket(r.date)].push(r);
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
    const sv = r.service;
    if (r.what === 'renews') return <button className="btn btn-outline btn-sm" onClick={() => setRenewing(r)}>Renew</button>;
    if (r.what === 'scheduled')
      return (
        <button className="btn btn-outline btn-sm" onClick={() => setDoing(r)}>
          Mark done
        </button>
      );
    const next: Status = sv.status === 'not_started' ? 'in_progress' : 'delivered';
    return (
      <button className="btn btn-outline btn-sm" onClick={() => void act(async () => {
        const res = await send<{ invoice: { number: string } | null }>('PATCH', `/api/clients/services/${sv.id}`, { status: next });
        return res.invoice ? `${sv.name}: draft invoice ${res.invoice.number} created` : `${sv.name}: ${STATUS_LABEL[next].toLowerCase()}`;
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
            <div className="ct-sub">Renewals, scheduled dates and work due, across every client.</div>
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
            <p>Services with a renewal date, a scheduled date or a due date show up here.</p>
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
                        const sv = r.service;
                        const tone = g.id === 'overdue' ? 'red' : g.id === 'week' ? 'amber' : '';
                        const invoiced = (sv.invoiced ?? []).includes(r.what === 'due' ? 'due' : r.date);
                        const what =
                          r.what === 'due' ? `Due · ${STATUS_LABEL[sv.status]}` : r.what === 'scheduled' ? `Scheduled · ${REPEATS_LABEL[sv.repeats].toLowerCase()}` : 'Renewal';
                        const amount = sv.amount * (r.what === 'due' ? sv.quantity || 1 : 1);
                        return (
                          <div key={`${sv.id}-${r.what}`} className="ct-row ct-cols-due">
                            <div className="ct-who">
                              <IconBox part={sv.type_part} kind={sv.recurs ?? undefined} />
                              <div>
                                <div className="ct-strong">{serviceLabel(sv)}</div>
                                <div className="ct-muted">{what}</div>
                              </div>
                            </div>
                            <Link className="ct-strong" href={`/clients/view?id=${encodeURIComponent(sv.client_id)}`}>{r.client_name}</Link>
                            <div>
                              <div>{cfg.fmt(r.date)}</div>
                              <span className={`ct-chipline ${tone}`}>{countdown(r.date)}</span>
                            </div>
                            <div>
                              <div className="ct-num">{amount > 0 ? fmtMoney(amount, sv.currency) : '—'}</div>
                              {invoiced && <span className="ct-chipline blue">Invoiced</span>}
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
      {doing && (
        <DoneDialog service={doing.service} clientName={doing.client_name} onClose={() => setDoing(null)} onDone={(m) => { showToast(m); void load(); }} />
      )}
      {renewing && (
        <RenewDialog service={renewing.service} clientName={renewing.client_name} onClose={() => setRenewing(null)} onDone={(m) => { showToast(m); void load(); }} />
      )}
    </Shell>
  );
}
