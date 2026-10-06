'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import type { InvoiceRow } from '@/lib/types';
import { Clock, ExternalLink, Globe, LinkIcon } from '@/components/icons';
import {
  BASE_CURRENCY,
  fmtMoney,
  formatDay,
  INVOICE_STATUSES,
  InvoiceStatus,
  invoiceTotals,
  parsePayments,
  round2,
  STATUS_META,
} from '@/lib/invoices';
import { useInvoiceSettings } from '@/lib/invoice-settings';
import type { InvoiceRow as Row } from '@/lib/types';

/**
 * Analytics report in naira. Other-currency invoices are converted with their
 * own exchange rate (naira per unit); ones without a rate cannot be summed.
 */
function inBase(invoice: Row, amount: number): number | null {
  if (invoice.currency === BASE_CURRENCY) return amount;
  const rate = Number(invoice.exchange_rate);
  return rate > 0 ? round2(amount * rate) : null;
}

/** Invoices that count as billed: not drafts, not cancelled. */
const isBilled = (invoice: Row) => invoice.status !== 'draft' && invoice.status !== 'cancelled';

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  // Leading = + - @ would run as a formula in spreadsheet apps.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pctWidth(value: number, max: number) {
  if (!max) return '0%';
  return `${Math.max(2, Math.round((value / max) * 100))}%`;
}

function exportCsv(rows: Row[]) {
  const header = ['Number', 'Client', 'Email', 'Status', 'Currency', 'Issued', 'Due', 'Subtotal', 'Discount', 'Charges', 'Tax', 'Total', 'Paid', 'Balance', 'Exchange rate (NGN)', 'Equivalent', 'Folder', 'Tag'];
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const lines = rows.map((inv) => {
    const t = invoiceTotals(inv);
    const rate = Number(inv.exchange_rate) || 0;
    const equivalent = rate > 0 ? (Number(inv.equivalent_amount) > 0 ? Number(inv.equivalent_amount) : inv.currency === BASE_CURRENCY ? round2(t.grand / rate) : round2(t.grand * rate)) : '';
    return [inv.number, inv.client_name, inv.client_email, inv.status, inv.currency, day(inv.issued_at), day(inv.due_at), t.subtotal, t.discount, t.charges, t.tax, t.grand, t.paid, t.balance, rate || '', equivalent, inv.folder, inv.tag ?? '']
      .map(csvCell)
      .join(',');
  });
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function InvoiceAnalyticsPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const cfg = useInvoiceSettings();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/invoices?status=all');
        const data = await res.json();
        if (!cancelled) setInvoices(data.invoices ?? []);
      } catch (err) {
        console.error('Failed to load invoice analytics:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const grandOf = (inv: Row) => inBase(inv, invoiceTotals(inv).grand) ?? 0;
    const billed = invoices.filter(isBilled);
    const unconverted = billed.filter((inv) => inBase(inv, 1) === null);
    const totals = billed.map((inv) => ({ inv, t: invoiceTotals(inv) }));
    const totalValue = totals.reduce((sum, r) => sum + (inBase(r.inv, r.t.grand) ?? 0), 0);
    const outstanding = totals.reduce((sum, r) => sum + (inBase(r.inv, r.t.balance) ?? 0), 0);
    const collected = totals.reduce((sum, r) => sum + (inBase(r.inv, r.t.paid) ?? 0), 0);
    const overdueValue = totals
      .filter((r) => r.inv.status === 'overdue')
      .reduce((sum, r) => sum + (inBase(r.inv, r.t.balance) ?? 0), 0);
    const clients = new Set(invoices.map((inv) => inv.client_name));

    // Payment velocity: days from issue to each payment date.
    const speeds: number[] = [];
    for (const inv of invoices) {
      for (const payment of parsePayments(inv.payments)) {
        const paidAt = Date.parse(payment.date);
        if (!Number.isNaN(paidAt)) speeds.push((paidAt - inv.issued_at) / 86_400_000);
      }
    }
    const avgDays = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const fastest = speeds.length ? Math.min(...speeds) : 0;
    const slowest = speeds.length ? Math.max(...speeds) : 0;

    // Month on month counts over the last 8 months.
    const now = new Date();
    const months: { label: string; count: number; value: number }[] = [];
    for (let i = 7; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const rows = billed.filter((inv) => inv.issued_at >= d.getTime() && inv.issued_at < next.getTime());
      months.push({
        label: MONTHS[d.getMonth()],
        count: rows.length,
        value: rows.reduce((sum, inv) => sum + grandOf(inv), 0),
      });
    }

    // Per-status counts + value.
    const byStatus = INVOICE_STATUSES.map((s) => {
      const rows = invoices.filter((inv) => inv.status === s.id);
      return {
        ...s,
        count: rows.length,
        value: rows.reduce((sum, inv) => sum + grandOf(inv), 0),
      };
    });

    // Clients by amount + their status mix.
    const clientMap = new Map<string, { name: string; total: number; statuses: Record<string, number> }>();
    for (const inv of invoices) {
      const entry = clientMap.get(inv.client_name) ?? { name: inv.client_name, total: 0, statuses: {} };
      if (isBilled(inv)) entry.total += grandOf(inv);
      entry.statuses[inv.status] = (entry.statuses[inv.status] ?? 0) + 1;
      clientMap.set(inv.client_name, entry);
    }
    const clientsByAmount = [...clientMap.values()].sort((a, b) => b.total - a.total).slice(0, 6);

    // Payment methods by count + value.
    const methodMap = new Map<string, { name: string; count: number; value: number }>();
    for (const inv of invoices) {
      for (const payment of parsePayments(inv.payments)) {
        const entry = methodMap.get(payment.method) ?? { name: payment.method, count: 0, value: 0 };
        entry.count += 1;
        entry.value += inBase(inv, Number(payment.amount || 0)) ?? 0;
        methodMap.set(payment.method, entry);
      }
    }
    const methods = [...methodMap.values()].sort((a, b) => b.value - a.value);

    return {
      totalValue,
      outstanding,
      collected,
      overdueValue,
      billedCount: billed.length,
      unconverted: unconverted.length,
      clientCount: clients.size,
      avgDays,
      fastest,
      slowest,
      months,
      byStatus,
      clientsByAmount,
      methods,
      lastInvoice: [...invoices].sort((a, b) => b.issued_at - a.issued_at)[0],
    };
  }, [invoices]);

  const maxStatus = Math.max(...stats.byStatus.map((s) => s.value), 1);
  const maxClient = Math.max(...stats.clientsByAmount.map((c) => c.total), 1);
  const maxMethodValue = Math.max(...stats.methods.map((m) => m.value), 1);
  const maxMethodCount = Math.max(...stats.methods.map((m) => m.count), 1);

  const renderChart = () => {
    const points = stats.months;
    if (points.length < 2) return null;
    const width = 800;
    const height = 220;
    const top = 30;
    const bottom = 200;
    const maxVal = Math.max(...points.map((p) => p.value), 1);
    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = bottom - (p.value / maxVal) * (bottom - top);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = coords.join(' L ');
    const area = `M0,${bottom} L ${line} L${width},${bottom} Z`;
    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="invfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a0a0a" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0a0a0a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#invfill)" />
        <path d={`M ${line}`} fill="none" stroke="#0a0a0a" strokeWidth="1.5" />
      </svg>
    );
  };

  return (
    <Shell>
      <div className="page-header">
        <div className="page-title">
          <span>Analytics</span>
          <span className="placeholder-veil" style={{ marginLeft: '6px' }}>Invoices</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline btn-sm" disabled={invoices.length === 0} onClick={() => exportCsv(invoices)}>
            <ExternalLink />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading analytics…</div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label"><LinkIcon width="11" height="11" /><span>Total invoices</span></div>
              <div className="stat-value">{invoices.length}</div>
              <div className="stat-delta">{stats.clientCount} unique clients · {stats.billedCount} issued</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Globe /><span>Total invoiced</span></div>
              <div className="stat-value">{fmtMoney(stats.totalValue, 'NGN')}</div>
              <div className="stat-delta">
                Issued invoices, excluding drafts and cancelled
                {stats.unconverted > 0 ? ` · ${stats.unconverted} without an exchange rate not counted` : ''}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Globe /><span>Collected</span></div>
              <div className="stat-value">{fmtMoney(stats.collected, 'NGN')}</div>
              <div className="stat-delta">Payments logged</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Clock /><span>Outstanding</span></div>
              <div className="stat-value">{fmtMoney(stats.outstanding, 'NGN')}</div>
              <div className="stat-delta">{stats.overdueValue > 0 ? `${fmtMoney(stats.overdueValue, 'NGN')} overdue` : 'Nothing overdue'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Clock /><span>Avg days to payment</span></div>
              <div className="stat-value" style={{ fontSize: '18px' }}>
                {stats.avgDays ? `${stats.avgDays.toFixed(1)} days` : '—'}
              </div>
              <div className="stat-delta">
                {stats.fastest ? `Fastest ${stats.fastest.toFixed(0)}d · Slowest ${stats.slowest.toFixed(0)}d` : 'No payments yet'}
              </div>
            </div>
          </div>

          {stats.lastInvoice && (
            <div className="split" style={{ gridTemplateColumns: '1fr' }}>
              <div className="split-card">
                <h4><span>Latest invoice</span><span className="placeholder-veil">Activity</span></h4>
                <div className="bar-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{stats.lastInvoice.number} · {stats.lastInvoice.client_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                      Issued {formatDay(stats.lastInvoice.issued_at, cfg.dateFormat)} · Due {formatDay(stats.lastInvoice.due_at, cfg.dateFormat)}
                    </div>
                  </div>
                  <span className={`inv-status ${STATUS_META[stats.lastInvoice.status as InvoiceStatus]?.cls ?? 'inv-status-draft'}`}>
                    <span className="inv-status-dot" />
                    {STATUS_META[stats.lastInvoice.status as InvoiceStatus]?.label ?? 'Draft'}
                  </span>
                  <div className="bar-count">{fmtMoney(invoiceTotals(stats.lastInvoice).grand, stats.lastInvoice.currency)}</div>
                </div>
              </div>
            </div>
          )}

          <div className="chart-card">
            <div className="chart-header">
              <div className="chart-title">Invoices processed month on month</div>
              <div style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>Value invoiced, last 8 months (₦)</div>
            </div>
            <div className="chart-placeholder">{renderChart()}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted-foreground)', marginTop: '6px' }}>
              {stats.months.map((m, i) => (
                <span key={`${m.label}-${i}`}>{m.label}</span>
              ))}
            </div>
          </div>

          <div className="split">
            <div className="split-card">
              <h4><span>Invoices by status</span><span className="placeholder-veil">{invoices.length} total</span></h4>
              {stats.byStatus.map((s) => (
                <div className="bar-row" key={s.id}>
                  <div />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`inv-status ${STATUS_META[s.id].cls}`}>
                        <span className="inv-status-dot" />
                        {s.label}
                      </span>
                    </div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(s.value, maxStatus) }} />
                    </div>
                  </div>
                  <div className="bar-count">{s.count}</div>
                </div>
              ))}
            </div>

            <div className="split-card">
              <h4><span>Payment methods by value</span><span className="placeholder-veil">Payments</span></h4>
              {stats.methods.length === 0 && (
                <div className="bar-row"><div /><div style={{ color: 'var(--muted-foreground)' }}>No payments logged</div><div /></div>
              )}
              {stats.methods.map((m) => (
                <div className="bar-row" key={m.name}>
                  <div>💳</div>
                  <div>
                    <div style={{ fontWeight: 500 }}>{m.name}</div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(m.value, maxMethodValue) }} />
                    </div>
                  </div>
                  <div className="bar-count">{fmtMoney(m.value, 'NGN')}</div>
                </div>
              ))}
            </div>

            <div className="split-card">
              <h4><span>Payment methods by count</span><span className="placeholder-veil">Payments</span></h4>
              {stats.methods.length === 0 && (
                <div className="bar-row"><div /><div style={{ color: 'var(--muted-foreground)' }}>No payments logged</div><div /></div>
              )}
              {stats.methods.map((m) => (
                <div className="bar-row" key={m.name}>
                  <div />
                  <div>
                    <div style={{ fontWeight: 500 }}>{m.name}</div>
                    <div className="bar-track" style={{ marginTop: '4px' }}>
                      <div className="bar-fill" style={{ width: pctWidth(m.count, maxMethodCount) }} />
                    </div>
                  </div>
                  <div className="bar-count">{m.count}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="split" style={{ gridTemplateColumns: '1fr' }}>
            <div className="split-card">
              <h4><span>Client by invoice amount</span><span className="placeholder-veil">Top {stats.clientsByAmount.length}</span></h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                  {stats.clientsByAmount.map((c) => (
                    <div className="bar-row" key={c.name}>
                      <div />
                      <div>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        <div className="bar-track" style={{ marginTop: '4px' }}>
                          <div className="bar-fill" style={{ width: pctWidth(c.total, maxClient) }} />
                        </div>
                      </div>
                      <div className="bar-count">{fmtMoney(c.total, 'NGN')}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px', fontWeight: 500 }}>
                    Distribution of statuses per client
                  </div>
                  {stats.clientsByAmount.map((c) => (
                    <div className="bar-row" key={`${c.name}-mix`} style={{ gridTemplateColumns: '1fr auto' }}>
                      <div style={{ fontWeight: 500 }}>{c.name}</div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {Object.entries(c.statuses).map(([status, count]) => (
                          <span key={status} className={`inv-status ${STATUS_META[status as InvoiceStatus]?.cls ?? 'inv-status-draft'}`}>
                            <span className="inv-status-dot" />
                            {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </>
      )}
    </Shell>
  );
}
