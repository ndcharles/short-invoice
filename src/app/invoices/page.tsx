'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import { InvoiceCard } from '@/components/invoices/invoice-card';
import type { InvoiceRow } from '@/lib/types';
import { ChevronDown, Filter, FolderIcon, More, Plus, Refresh, Search, Sort } from '@/components/icons';
import { useCollections, useSettings } from '@/lib/collections';
import { parseList } from '@/lib/settings-json';
import { CanvasAccount, InvoiceCanvas, InvoiceDraft } from '@/components/invoices/invoice-canvas';
import { InvoiceGuideModal } from '@/components/invoices/invoice-guide-modal';
import { XIcon } from '@/components/icons';
import { usePopoverDismiss } from '@/lib/popover';
import { discountAmount, draftTotals, InvoiceStatus, INVOICE_STATUSES, computeTotals } from '@/lib/invoices';

const PAGE_SIZE = 25;
const SORTS = [
  { id: 'issued', label: 'Newest first' },
  { id: 'due', label: 'Due soonest' },
  { id: 'amount', label: 'Highest amount' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0 });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'all' | InvoiceStatus>('all');
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('Invoices');
  const [sortOrder, setSortOrder] = useState<SortId>('issued');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [openMenu, setOpenMenu] = useState<'folder' | 'sort' | 'more' | null>(null);
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const settings = useSettings();
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const canvasAccounts = parseList<CanvasAccount>(settings?.inv_accounts, []);
  const canvasTagline = {
    on: settings?.inv_tagline_on === 'true',
    text: settings?.inv_tagline_text ?? '',
    color: settings?.inv_tagline_color ?? '#1d4ed8',
  };
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { items: folders } = useCollections('folders');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ status });
        if (search.trim()) params.set('search', search.trim());
        if (folderFilter && folderFilter !== 'All') params.set('folder', folderFilter);
        const res = await fetch(`/api/invoices?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        setInvoices(data.invoices ?? []);
        if (data.counts) setCounts(data.counts);
      } catch (err) {
        console.error('Failed to load invoices:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, search, folderFilter, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  const openCreate = useCallback(() => {
    const prefix = settings?.inv_number_prefix ?? 'INV-';
    const padding = Number(settings?.inv_number_padding ?? 6) || 6;
    const next = Number(settings?.inv_next_number ?? 1) || 1;
    setDraft({
      number: `${prefix}${String(next).padStart(padding, '0')}`, // preview only; the server owns the sequence
      clientName: '',
      clientContact: '',
      clientAddr1: '',
      clientAddr2: '',
      clientCountry: '',
      clientEmail: '',
      issuedAt: Date.now(),
      dueAt: Date.now() + 30 * 86_400_000,
      currency: 'NGN',
      status: 'draft',
      items: [{ name: 'Services', desc: '', qty: 1, unitPrice: 0 }],
      charges: 0,
      discount: 0,
      discountType: 'value' as const,
      equivalentAmount: 0,
      exchangeRate: Number(settings?.inv_usd_rate ?? 0) || 0,
      taxRate: 0.075,
      terms: settings?.inv_terms_note ?? 'Net 30. Late payments accrue 1.5% interest per month.',
      notes: '',
      paymentMethod: 'Paystack (Debit/Credit Cards)',
    });
    setCreateError(null);
    setCreateOpen(true);
  }, [settings]);

  const submitCreate = useCallback(async () => {
    if (!draft) return;
    if (!draft.clientName.trim()) {
      setCreateError('A client name is required');
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const totalsForDraft = draftTotals(draft);
      const subtotal = totalsForDraft.subtotal;
      const total = totalsForDraft.grand;
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: draft.clientName,
          client_email: draft.clientEmail,
          client_address: [draft.clientName, draft.clientContact, draft.clientAddr1, draft.clientAddr2, draft.clientCountry]
            .filter(Boolean)
            .join('\n'),
          issued_at: draft.issuedAt,
          due_at: draft.dueAt,
          currency: draft.currency,
          status: draft.status,
          items: draft.items,
          subtotal,
          tax_rate: draft.taxRate,
          discount: discountAmount(draft),
          charges: draft.charges,
          discount_type: draft.discountType,
          total,
          notes: draft.notes,
          folder: folderFilter === 'All' ? 'Invoices' : folderFilter,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create invoice');
      setCreateOpen(false);
      router.push(`/invoices/edit?id=${encodeURIComponent(data.invoice.id)}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create invoice');
    } finally {
      setBusy(false);
    }
  }, [draft, folderFilter, router]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'c' || e.key === 'C') &&
        !busy &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        openCreate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, openCreate]);

  const closeToolbarMenu = useCallback(() => setOpenMenu(null), []);
  usePopoverDismiss(openMenu !== null, closeToolbarMenu);

  const visible = useMemo(() => {
    const rows = [...invoices];
    rows.sort((a, b) => {
      if (sortOrder === 'due') return a.due_at - b.due_at;
      if (sortOrder === 'amount') {
        return computeTotals(b as never).grand - computeTotals(a as never).grand;
      }
      return b.issued_at - a.issued_at;
    });
    return rows;
  }, [invoices, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = visible.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = (currentPage - 1) * PAGE_SIZE + paged.length;
  const isEmpty = !loading && (counts.all ?? 0) === 0;

  const handleStatusChange = async (id: string, next: InvoiceStatus) => {
    await fetch(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this invoice? The record will be removed permanently.')) return;
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
    refresh();
  };

  const handleDuplicate = async (invoice: InvoiceRow) => {
    await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: invoice.client_name,
        client_email: invoice.client_email,
        client_address: invoice.client_address,
        issued_at: Date.now(),
        due_at: Date.now() + 30 * 86_400_000,
        currency: invoice.currency,
        status: 'draft',
        items: JSON.parse(invoice.items || '[]'),
        subtotal: invoice.subtotal,
        tax_rate: invoice.tax_rate,
        discount: invoice.discount,
        total: invoice.total,
        notes: invoice.notes,
        terms: invoice.terms,
        folder: invoice.folder,
        tag: invoice.tag,
      }),
    });
    refresh();
  };

  const handleLogPayment = async (invoice: InvoiceRow) => {
    const raw = prompt(`Amount received for ${invoice.number} (${invoice.currency}):`);
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const payments = JSON.parse(invoice.payments || '[]');
    payments.push({ amount, date: new Date().toISOString().slice(0, 10), method: 'Bank transfer', note: '' });

    const totals = computeTotals(invoice as never);
    const paid = totals.paid + amount;
    const nextStatus: InvoiceStatus = paid >= totals.grand - 0.01 ? 'paid' : 'partially-paid';

    await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payments, status: nextStatus }),
    });
    refresh();
  };

  const activeFolder = folders.find((f) => f.name === folderFilter);

  return (
    <Shell>
      <div className="page-header">
        <div className="page-title">
          <span>Invoices</span>
          <button className="how-to-btn" title="How to Guide" onClick={() => setGuideOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>How to Guide</span>
          </button>
          <ChevronDown className="page-title-chevron" />
        </div>
        <button className="btn btn-primary" onClick={openCreate} disabled={busy}>
          <Plus />
          <span>{busy ? 'Creating…' : 'Create invoice'}</span>
          <kbd>C</kbd>
        </button>
      </div>

      <div className={`list-tabs${isEmpty ? ' is-dim' : ''}`}>
        <button className={`list-tab ${status === 'all' ? 'active' : ''}`} onClick={() => { setStatus('all'); setPage(1); }}>
          All invoices <span className="list-tab-count">{counts.all ?? 0}</span>
        </button>
        {INVOICE_STATUSES.map((s) => (
          <button
            key={s.id}
            className={`list-tab ${status === s.id ? 'active' : ''}`}
            onClick={() => { setStatus(s.id); setPage(1); }}
          >
            {s.label} <span className="list-tab-count">{counts[s.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className={`toolbar${isEmpty ? ' is-dim' : ''}`} ref={toolbarRef}>
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
              <div className={`dropdown-item${folderFilter === 'All' ? ' is-current' : ''}`} onClick={() => { setFolderFilter('All'); setPage(1); setOpenMenu(null); }}>
                <FolderIcon width="12" height="12" />
                <span>All folders</span>
              </div>
              {folders.map((f) => (
                <div key={f.id} className={`dropdown-item${folderFilter === f.name ? ' is-current' : ''}`} onClick={() => { setFolderFilter(f.name); setPage(1); setOpenMenu(null); }}>
                  <span className={`fs-swatch ${f.color}`} style={{ width: '14px', height: '14px' }}>
                    <FolderIcon width="8" height="8" />
                  </span>
                  <span>{f.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-outline btn-sm" disabled={isEmpty}>
          <Filter />
          <span>Filter</span>
          <ChevronDown />
        </button>

        <div className="toolbar-menu" data-popover-root>
          <button className="btn btn-outline btn-sm" disabled={isEmpty} onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}>
            <Sort />
            <span>Sort</span>
            <ChevronDown />
          </button>
          {openMenu === 'sort' && (
            <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0 }}>
              {SORTS.map((s) => (
                <div key={s.id} className={`dropdown-item${sortOrder === s.id ? ' is-current' : ''}`} onClick={() => { setSortOrder(s.id); setPage(1); setOpenMenu(null); }}>
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
            placeholder="Search by number or client"
            value={search}
            disabled={isEmpty}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {!isEmpty && (
          <div className="toolbar-menu" data-popover-root>
            <button className="icon-btn" onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')} aria-label="More">
              <More />
            </button>
            {openMenu === 'more' && (
              <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', right: 0 }}>
                <div className="dropdown-item" onClick={() => { setOpenMenu(null); refresh(); }}>
                  <Refresh />
                  <span>Refresh</span>
                  <span className="kbd-hint">R</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
          <p>Create your first invoice to start billing clients and tracking payments.</p>
          <button className="btn btn-primary" onClick={openCreate} disabled={busy}>
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
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onLogPayment={handleLogPayment}
            />
          ))}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="pagination">
          <div>
            Viewing {rangeStart}–{rangeEnd} of {visible.length} invoices
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
      {/* Create invoice modal (design: create-invoice.html) */}
      {createOpen && draft && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div className="modal invoice-modal" role="dialog" aria-label="New invoice">
            <div className="modal-header">
              <div className="modal-title">
                <span style={{ color: 'var(--muted-foreground)' }}>Invoices</span>
                <span className="breadcrumb-chev">›</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>New invoice</span>
                <span className="draft-saved">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Draft saved
                </span>
              </div>
              <button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Close">
                <XIcon />
              </button>
            </div>
            {createError && (
              <div style={{ margin: '12px 20px 0', padding: '8px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}>
                {createError}
              </div>
            )}
            <div className="modal-body">
              <InvoiceCanvas
                draft={draft}
                onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                accounts={canvasAccounts}
                tagline={canvasTagline}
                defaultTerms={settings?.inv_terms_note}
                variant="modal"
                payTo={{
                  name: settings?.inv_legal_name ?? '',
                  addr1: settings?.inv_address_1 ?? '',
                  addr2: settings?.inv_address_2 ?? '',
                  email: settings?.inv_contact_email ?? '',
                  taxId: settings?.inv_tax_id ?? '—',
                }}
              />
            </div>
            <div className="modal-footer">
              <div style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
                Required: client name. The number comes from your Invoice settings sequence.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={submitCreate} disabled={busy}>
                  <span>{busy ? 'Creating…' : 'Create invoice'}</span>
                  <kbd>↵</kbd>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {guideOpen && <InvoiceGuideModal onClose={() => setGuideOpen(false)} />}
    </Shell>
  );
}
