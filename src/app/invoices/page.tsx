'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import { InvoiceCard, type InvoiceAction } from '@/components/invoices/invoice-card';
import { InvoiceGuideModal } from '@/components/invoices/invoice-guide-modal';
import type { InvoiceView } from '@/lib/types';
import { ChevronDown, FolderIcon, Plus, Search, Sort } from '@/components/icons';
import { useCollections, useSettings } from '@/lib/collections';
import { usePopoverDismiss } from '@/lib/popover';
import { fmtMoney, INVOICE_STATUSES, parsePayments, toNaira, type InvoiceStatus } from '@/lib/invoices';

const PAGE_SIZE = 25;
const SORTS = [
  { id: 'issued', label: 'Newest first' },
  { id: 'due', label: 'Due soonest' },
  { id: 'balance', label: 'Largest balance' },
  { id: 'client', label: 'Client A–Z' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

async function call(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' || method === 'DELETE' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Naira totals across invoices; foreign invoices without a rate are counted separately. */
function summarise(invoices: InvoiceView[]) {
  const monthStart = new Date();
  const monthKey = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`;
  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  let collected = 0;
  let unconverted = 0;
  for (const inv of invoices) {
    const rate = inv.exchange_rate;
    if (inv.display_status === 'sent' || inv.display_status === 'partially-paid' || inv.display_status === 'overdue') {
      const due = toNaira(inv.totals.balance, inv.currency, rate);
      if (due === null) unconverted += 1;
      else {
        outstanding += due;
        if (inv.display_status === 'overdue') {
          overdue += due;
          overdueCount += 1;
        }
      }
    }
    for (const p of parsePayments(inv.payments)) {
      if (!p.date.startsWith(monthKey)) continue;
      const value = toNaira(p.amount, inv.currency, rate);
      if (value !== null) collected += value;
    }
  }
  return { outstanding, overdue, overdueCount, collected, unconverted };
}

export default function InvoicesPage() {
  const router = useRouter();
  const settings = useSettings();
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [all, setAll] = useState<InvoiceView[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0 });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'all' | InvoiceStatus>('all');
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('All');
  const [sortOrder, setSortOrder] = useState<SortId>('issued');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [openMenu, setOpenMenu] = useState<'folder' | 'sort' | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ status: 'all' });
    if (folderFilter !== 'All') params.set('folder', folderFilter);
    call(`/api/invoices?${params}`)
      .then((data) => {
        if (cancelled) return;
        setAll(data.invoices ?? []);
        setCounts(data.counts ?? { all: 0 });
      })
      .catch((err) => !cancelled && setNotice(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [folderFilter, reloadKey]);

  // Status tabs and search filter the loaded list locally (no extra requests).
  useEffect(() => {
    const q = search.trim().toLowerCase();
    queueMicrotask(() =>
      setInvoices(
        all.filter(
          (inv) =>
            (status === 'all' || inv.display_status === status) &&
            (!q || [inv.number, inv.client_name, inv.reference, inv.client_email].some((v) => (v ?? '').toLowerCase().includes(q)))
        )
      )
    );
  }, [all, status, search]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  const create = useCallback(() => router.push('/invoices/edit?new=1'), [router]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        create();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [create]);

  usePopoverDismiss(openMenu !== null, useCallback(() => setOpenMenu(null), []));

  const visible = useMemo(() => {
    const rows = [...invoices];
    rows.sort((a, b) => {
      if (sortOrder === 'due') return a.due_at - b.due_at;
      if (sortOrder === 'balance') return (toNaira(b.totals.balance, b.currency, b.exchange_rate) ?? 0) - (toNaira(a.totals.balance, a.currency, a.exchange_rate) ?? 0);
      if (sortOrder === 'client') return a.client_name.localeCompare(b.client_name);
      return b.issued_at - a.issued_at;
    });
    return rows;
  }, [invoices, sortOrder]);

  const kpis = useMemo(() => summarise(all), [all]);
  const tagColors = useMemo(() => new Map(tags.map((t) => [t.name, t.color])), [tags]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const isEmpty = !loading && (counts.all ?? 0) === 0 && folderFilter === 'All';
  const activeFolder = folders.find((f) => f.name === folderFilter);

  const onAction = async (action: InvoiceAction, inv: InvoiceView) => {
    setNotice(null);
    try {
      switch (action) {
        case 'pay':
          router.push(`/invoices/edit?id=${encodeURIComponent(inv.id)}&pay=1`);
          return;
        case 'link':
          await navigator.clipboard.writeText(`${window.location.origin}/s/i/${inv.share_token}`);
          setNotice(`Client link for ${inv.number} copied.`);
          return;
        case 'duplicate': {
          const data = await call(`/api/invoices/${inv.id}/duplicate`, 'POST');
          router.push(`/invoices/edit?id=${encodeURIComponent(data.invoice.id)}`);
          return;
        }
        case 'sent':
          await call(`/api/invoices/${inv.id}`, 'PATCH', { status: 'sent' });
          break;
        case 'cancel':
          if (!confirm(`Cancel ${inv.number}? It stays on record but no longer counts as owed.`)) return;
          await call(`/api/invoices/${inv.id}`, 'PATCH', { status: 'cancelled' });
          break;
        case 'reopen':
          await call(`/api/invoices/${inv.id}`, 'PATCH', { status: inv.sent_at ? 'sent' : 'draft' });
          break;
        case 'delete': {
          const warning =
            inv.status === 'draft'
              ? `Delete draft ${inv.number}?`
              : `Delete ${inv.number} permanently? Cancelling is usually better: it keeps your invoice numbers continuous.`;
          if (!confirm(warning)) return;
          await call(`/api/invoices/${inv.id}`, 'DELETE');
          break;
        }
      }
      refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Shell>
      <div className="page-header">
        <div className="page-title">
          <span>Invoices</span>
          <button className="how-to-btn" title="How invoice statuses work" onClick={() => setGuideOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>How it works</span>
          </button>
        </div>
        <button className="btn btn-primary" onClick={create}>
          <Plus />
          <span>Create invoice</span>
          <kbd>C</kbd>
        </button>
      </div>

      {!isEmpty && !loading && (
        <div className="inv-kpis">
          <div className="inv-kpi">
            <div className="inv-kpi-label">Outstanding</div>
            <div className="inv-kpi-value">{fmtMoney(kpis.outstanding, 'NGN')}</div>
            <div className="inv-kpi-sub">
              {kpis.unconverted ? `+${kpis.unconverted} foreign invoice${kpis.unconverted === 1 ? '' : 's'} without a rate` : 'Sent and unpaid, in naira'}
            </div>
          </div>
          <div className={`inv-kpi${kpis.overdueCount ? ' is-alert' : ''}`}>
            <div className="inv-kpi-label">Overdue</div>
            <div className="inv-kpi-value">{fmtMoney(kpis.overdue, 'NGN')}</div>
            <div className="inv-kpi-sub">
              {kpis.overdueCount} invoice{kpis.overdueCount === 1 ? '' : 's'} past due
            </div>
          </div>
          <div className="inv-kpi">
            <div className="inv-kpi-label">Collected this month</div>
            <div className="inv-kpi-value">{fmtMoney(kpis.collected, 'NGN')}</div>
            <div className="inv-kpi-sub">Payments logged, in naira</div>
          </div>
          <div className="inv-kpi">
            <div className="inv-kpi-label">Drafts</div>
            <div className="inv-kpi-value">{counts.draft ?? 0}</div>
            <div className="inv-kpi-sub">Not sent yet</div>
          </div>
        </div>
      )}

      <div className={`list-tabs${isEmpty ? ' is-dim' : ''}`}>
        <button className={`list-tab ${status === 'all' ? 'active' : ''}`} onClick={() => { setStatus('all'); setPage(1); }}>
          All <span className="list-tab-count">{counts.all ?? 0}</span>
        </button>
        {INVOICE_STATUSES.map((s) => (
          <button key={s.id} className={`list-tab ${status === s.id ? 'active' : ''}`} onClick={() => { setStatus(s.id); setPage(1); }}>
            {s.label} <span className="list-tab-count">{counts[s.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className={`toolbar${isEmpty ? ' is-dim' : ''}`}>
        <div className="toolbar-menu" data-popover-root>
          <button className="folder-filter" onClick={() => setOpenMenu(openMenu === 'folder' ? null : 'folder')}>
            <span className={`fs-swatch ${activeFolder?.color ?? 'green'}`}>
              <FolderIcon />
            </span>
            <span>{folderFilter === 'All' ? 'All folders' : folderFilter}</span>
            <ChevronDown className="chev" />
          </button>
          {openMenu === 'folder' && (
            <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0 }}>
              {['All', ...folders.map((f) => f.name)].map((name) => (
                <div
                  key={name}
                  className={`dropdown-item${folderFilter === name ? ' is-current' : ''}`}
                  onClick={() => {
                    setFolderFilter(name);
                    setPage(1);
                    setOpenMenu(null);
                  }}
                >
                  <FolderIcon width="12" height="12" />
                  <span>{name === 'All' ? 'All folders' : name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-menu" data-popover-root>
          <button className="btn btn-outline btn-sm" disabled={isEmpty} onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}>
            <Sort />
            <span>{SORTS.find((s) => s.id === sortOrder)?.label}</span>
            <ChevronDown />
          </button>
          {openMenu === 'sort' && (
            <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0 }}>
              {SORTS.map((s) => (
                <div key={s.id} className={`dropdown-item${sortOrder === s.id ? ' is-current' : ''}`} onClick={() => { setSortOrder(s.id); setOpenMenu(null); }}>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-spacer" />

        <div className="search">
          <Search />
          <input
            placeholder="Search number, client or reference"
            value={search}
            disabled={isEmpty}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {notice && (
        <div role="status" style={{ margin: '0 0 10px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: '12px', background: 'var(--muted)' }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div className="link-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="link-card" style={{ opacity: 0.4 }}>
              <div className="favicon" />
              <div className="link-info">
                <span className="link-alias" style={{ color: 'var(--subtle-foreground)' }}>loading…</span>
              </div>
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="empty">
          <div className="empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
          </div>
          <h3>No invoices yet</h3>
          <p>Create your first invoice. Set your company details and bank accounts in Settings → Invoice first so they print on it.</p>
          <button className="btn btn-primary" onClick={create}>
            <Plus />
            <span>Create invoice</span>
            <kbd>C</kbd>
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Search width="24" height="24" />
          </div>
          <h3>No invoices found</h3>
          <p>Try a different status, folder or search term.</p>
          <button className="btn btn-outline" onClick={() => { setSearch(''); setStatus('all'); setFolderFilter('All'); }}>
            <span>Clear filters</span>
          </button>
        </div>
      ) : (
        <div className="link-list">
          {paged.map((invoice) => (
            <InvoiceCard
              key={invoice.id}
              invoice={invoice}
              dateFormat={settings?.date_format}
              tagColor={invoice.tag ? tagColors.get(invoice.tag) : undefined}
              onAction={onAction}
            />
          ))}
        </div>
      )}

      {!loading && visible.length > PAGE_SIZE && (
        <div className="pagination">
          <div>
            Viewing {(currentPage - 1) * PAGE_SIZE + 1}–{(currentPage - 1) * PAGE_SIZE + paged.length} of {visible.length} invoices
          </div>
          <div className="pagination-btns">
            <button className="btn btn-outline btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              Previous
            </button>
            <button className="btn btn-outline btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
              Next
            </button>
          </div>
        </div>
      )}

      {guideOpen && <InvoiceGuideModal onClose={() => setGuideOpen(false)} />}
    </Shell>
  );
}
