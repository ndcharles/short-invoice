'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import type { InvoiceView } from '@/lib/types';
import { Clock, ExternalLink, Globe, LinkIcon } from '@/components/icons';
import { daysUntil, fmtMoney, INVOICE_STATUSES, parsePayments, STATUS_META, toNaira } from '@/lib/invoices';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AGEING = [
  { id: 'current', label: 'Not yet due', test: (d: number) => d >= 0 },
  { id: '1-30', label: '1–30 days overdue', test: (d: number) => d < 0 && d >= -30 },
  { id: '31-60', label: '31–60 days overdue', test: (d: number) => d < -30 && d >= -60 },
  { id: '61-90', label: '61–90 days overdue', test: (d: number) => d < -60 && d >= -90 },
  { id: '90+', label: 'Over 90 days overdue', test: (d: number) => d < -90 },
];

function pctWidth(value: number, max: number) {
  if (!max || value <= 0) return '0%';
  return `${Math.max(2, Math.round((value / max) * 100))}%`;
}

const naira = (amount: number) => fmtMoney(amount, 'NGN').replace(/\.\d\d$/, '');

export default function InvoiceAnalyticsPage() {
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState<6 | 12>(12);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/invoices?status=all')
      .then((res) => res.json())
      .then((data) => !cancelled && setInvoices(data.invoices ?? []))
      .catch((err) => console.error('Failed to load invoice analytics:', err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    // Everything is reported in naira; foreign invoices need their exchange rate.
    const live = invoices.filter((inv) => inv.display_status !== 'draft' && inv.display_status !== 'cancelled');
    const convertible = live.filter((inv) => toNaira(1, inv.currency, inv.exchange_rate) !== null);
    const skipped = live.length - convertible.length;
    const ngn = (inv: InvoiceView, amount: number) => toNaira(amount, inv.currency, inv.exchange_rate) ?? 0;

    let invoiced = 0;
    let collected = 0;
    let outstanding = 0;
    let overdue = 0;
    const ageing = AGEING.map((b) => ({ ...b, value: 0, count: 0 }));
    const methodMap = new Map<string, { name: string; count: number; value: number }>();
    const clientMap = new Map<string, { name: string; total: number; balance: number; count: number }>();
    const payDays: number[] = [];

    const now = new Date();
    const series = Array.from({ length: months }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1));
      return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getUTCMonth()], invoiced: 0, collected: 0 };
    });
    const byKey = new Map(series.map((s) => [s.key, s]));

    for (const inv of convertible) {
      const total = ngn(inv, inv.totals.total);
      const balance = ngn(inv, inv.totals.balance);
      invoiced += total;
      outstanding += balance;
      if (inv.display_status === 'overdue') overdue += balance;
      if (balance > 0) {
        const bucket = ageing.find((b) => b.test(daysUntil(inv.due_at)));
        if (bucket) {
          bucket.value += balance;
          bucket.count += 1;
        }
      }
      const issuedKey = new Date(inv.issued_at).toISOString().slice(0, 7);
      const month = byKey.get(issuedKey);
      if (month) month.invoiced += total;

      const client = clientMap.get(inv.client_name) ?? { name: inv.client_name, total: 0, balance: 0, count: 0 };
      client.total += total;
      client.balance += balance;
      client.count += 1;
      clientMap.set(inv.client_name, client);

      const payments = parsePayments(inv.payments);
      for (const p of payments) {
        const value = ngn(inv, p.amount);
        collected += value;
        const paidMonth = byKey.get(p.date.slice(0, 7));
        if (paidMonth) paidMonth.collected += value;
        const method = methodMap.get(p.method || 'Other') ?? { name: p.method || 'Other', count: 0, value: 0 };
        method.count += 1;
        method.value += value;
        methodMap.set(method.name, method);
      }
      if (inv.display_status === 'paid' && payments.length) {
        const last = Date.parse(`${payments[payments.length - 1].date}T00:00:00Z`);
        if (!Number.isNaN(last)) payDays.push(Math.max(0, (last - inv.issued_at) / 86_400_000));
      }
    }

    const byStatus = INVOICE_STATUSES.map((s) => {
      const rows = invoices.filter((inv) => inv.display_status === s.id);
      return { ...s, count: rows.length, value: rows.reduce((sum, inv) => sum + (toNaira(inv.totals.total, inv.currency, inv.exchange_rate) ?? 0), 0) };
    });

    return {
      invoiced,
      collected,
      outstanding,
      overdue,
      skipped,
      liveCount: live.length,
      clients: new Set(live.map((inv) => inv.client_name)).size,
      avgDays: payDays.length ? payDays.reduce((a, b) => a + b, 0) / payDays.length : null,
      series,
      ageing,
      byStatus,
      methods: [...methodMap.values()].sort((a, b) => b.value - a.value),
      clientsByAmount: [...clientMap.values()].sort((a, b) => b.total - a.total).slice(0, 8),
    };
  }, [invoices, months]);

  const exportCsv = () => {
    const header = ['number', 'client', 'reference', 'status', 'currency', 'total', 'paid', 'balance', 'exchange_rate', 'total_ngn', 'issued', 'due'];
    const rows = invoices.map((inv) => [
      inv.number,
      inv.client_name,
      inv.reference,
      inv.display_status,
      inv.currency,
      inv.totals.total,
      inv.totals.paid,
      inv.totals.balance,
      inv.exchange_rate || '',
      toNaira(inv.totals.total, inv.currency, inv.exchange_rate) ?? '',
      new Date(inv.issued_at).toISOString().slice(0, 10),
      new Date(inv.due_at).toISOString().slice(0, 10),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderChart = () => {
    const points = stats.series;
    const width = 800;
    const height = 220;
    const top = 20;
    const bottom = 200;
    const maxVal = Math.max(...points.map((p) => Math.max(p.invoiced, p.collected)), 1);
    const path = (key: 'invoiced' | 'collected') =>
      points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, points.length - 1)) * width).toFixed(1)},${(bottom - (p[key] / maxVal) * (bottom - top)).toFixed(1)}`)
        .join(' ');
    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Invoiced and collected per month">
        <path d={path('invoiced')} fill="none" stroke="#0a0a0a" strokeWidth="1.8" />
        <path d={path('collected')} fill="none" stroke="#16a34a" strokeWidth="1.8" strokeDasharray="5 4" />
      </svg>
    );
  };

  const maxStatus = Math.max(...stats.byStatus.map((s) => s.value), 1);
  const maxClient = Math.max(...stats.clientsByAmount.map((c) => c.total), 1);
  const maxMethod = Math.max(...stats.methods.map((m) => m.value), 1);
  const maxAgeing = Math.max(...stats.ageing.map((b) => b.value), 1);

  return (
    <Shell>
      <div className="page-header">
        <div className="page-title">
          <span>Invoice analytics</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline btn-sm" onClick={() => setMonths(months === 12 ? 6 : 12)}>
            <Clock />
            <span>Last {months} months</span>
          </button>
          <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={!invoices.length}>
            <ExternalLink />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading analytics…</div>
      ) : (
        <>
          {stats.skipped > 0 && (
            <div style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: '12px', background: '#fef3c7', color: '#92400e' }}>
              {stats.skipped} foreign-currency invoice{stats.skipped === 1 ? ' is' : 's are'} left out because {stats.skipped === 1 ? 'it has' : 'they have'} no exchange
              rate. Tick “Show NGN equivalent” on {stats.skipped === 1 ? 'it' : 'them'} to include {stats.skipped === 1 ? 'it' : 'them'}.
            </div>
          )}

          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label"><LinkIcon width="11" height="11" /><span>Invoiced</span></div>
              <div className="stat-value">{naira(stats.invoiced)}</div>
              <div className="stat-delta">{stats.liveCount} invoices · {stats.clients} clients</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Globe /><span>Collected</span></div>
              <div className="stat-value">{naira(stats.collected)}</div>
              <div className="stat-delta">{stats.invoiced ? Math.round((stats.collected / stats.invoiced) * 100) : 0}% of invoiced</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Clock /><span>Outstanding</span></div>
              <div className="stat-value">{naira(stats.outstanding)}</div>
              <div className="stat-delta">Of which {naira(stats.overdue)} overdue</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Clock /><span>Avg. days to get paid</span></div>
              <div className="stat-value" style={{ fontSize: '18px' }}>{stats.avgDays === null ? '—' : `${stats.avgDays.toFixed(0)} days`}</div>
              <div className="stat-delta">From invoice date to final payment</div>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <div className="chart-title">Invoiced vs collected, per month (₦)</div>
              <div style={{ fontSize: '12px', color: 'var(--muted-foreground)', display: 'flex', gap: 12 }}>
                <span>━ Invoiced</span>
                <span style={{ color: '#16a34a' }}>┅ Collected</span>
              </div>
            </div>
            <div className="chart-placeholder">{renderChart()}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted-foreground)', marginTop: '6px' }}>
              {stats.series.map((m) => (
                <span key={m.key} title={`Invoiced ${naira(m.invoiced)} · Collected ${naira(m.collected)}`}>{m.label}</span>
              ))}
            </div>
          </div>

          <div className="split">
            <div className="split-card">
              <h4><span>Receivables ageing</span><span className="placeholder-veil">Unpaid balances</span></h4>
              {stats.ageing.map((b) => (
                <div className="bar-row" key={b.id}>
                  <div />
                  <div>
                    <div style={{ fontWeight: 500 }}>{b.label}</div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(b.value, maxAgeing), background: b.id === 'current' ? undefined : '#b91c1c' }} />
                    </div>
                  </div>
                  <div className="bar-count">{naira(b.value)}</div>
                </div>
              ))}
            </div>

            <div className="split-card">
              <h4><span>By status</span><span className="placeholder-veil">{invoices.length} total</span></h4>
              {stats.byStatus.map((s) => (
                <div className="bar-row" key={s.id}>
                  <div />
                  <div>
                    <span className={`inv-status ${STATUS_META[s.id].cls}`}>
                      <span className="inv-status-dot" />
                      {s.label} · {s.count}
                    </span>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(s.value, maxStatus) }} />
                    </div>
                  </div>
                  <div className="bar-count">{naira(s.value)}</div>
                </div>
              ))}
            </div>

            <div className="split-card">
              <h4><span>Payment methods</span><span className="placeholder-veil">By value</span></h4>
              {stats.methods.length === 0 && (
                <div className="bar-row"><div /><div style={{ color: 'var(--muted-foreground)' }}>No payments logged yet</div><div /></div>
              )}
              {stats.methods.map((m) => (
                <div className="bar-row" key={m.name}>
                  <div />
                  <div>
                    <div style={{ fontWeight: 500 }}>{m.name} · {m.count}</div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(m.value, maxMethod) }} />
                    </div>
                  </div>
                  <div className="bar-count">{naira(m.value)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="split" style={{ gridTemplateColumns: '1fr' }}>
            <div className="split-card">
              <h4><span>Top clients</span><span className="placeholder-veil">Invoiced, with balance still due</span></h4>
              {stats.clientsByAmount.length === 0 && (
                <div className="bar-row"><div /><div style={{ color: 'var(--muted-foreground)' }}>No sent invoices yet</div><div /></div>
              )}
              {stats.clientsByAmount.map((c) => (
                <div className="bar-row" key={c.name}>
                  <div />
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {c.name} <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}>· {c.count} invoice{c.count === 1 ? '' : 's'}{c.balance > 0 ? ` · ${naira(c.balance)} due` : ''}</span>
                    </div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(c.total, maxClient) }} />
                    </div>
                  </div>
                  <div className="bar-count">{naira(c.total)}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', margin: '8px 0 24px' }}>
            Drafts and cancelled invoices are excluded from the totals. Foreign amounts are converted at each invoice’s own
            exchange rate.
          </div>
        </>
      )}
    </Shell>
  );
}
