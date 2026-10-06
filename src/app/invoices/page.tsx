'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import { InvoiceCard } from '@/components/invoices/invoice-card';
import type { InvoiceRow } from '@/lib/types';
import { ChevronDown, Filter, FolderIcon, More, Plus, Refresh, Search, Sort } from '@/components/icons';
import { useCollections } from '@/lib/collections';
import { InvoiceCanvas, InvoiceDraft } from '@/components/invoices/invoice-canvas';
import { InvoiceGuideModal } from '@/components/invoices/invoice-guide-modal';
import { LogPaymentModal, PaymentDraft } from '@/components/invoices/invoice-modals';
import { useConfirm } from '@/components/invoices/choice-modal';
import { XIcon } from '@/components/icons';
import { usePopoverDismiss } from '@/lib/popover';
import { draftFromInvoice, draftProblem, invoicePayload, newInvoiceDraft, useInvoiceSettings } from '@/lib/invoice-settings';
import { InvoiceStatus, INVOICE_STATUSES, invoiceTotals, parsePayments } from '@/lib/invoices';

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
  const [folderFilter, setFolderFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<SortId>('issued');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [openMenu, setOpenMenu] = useState<'folder' | 'filter' | 'sort' | 'more' | null>(null);
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const cfg = useInvoiceSettings();
  const [ask, confirmModal] = useConfirm();
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [paying, setPaying] = useState<InvoiceRow | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ status });
        if (search.trim()) params.set('search', search.trim());
        if (folderFilter && folderFilter !== 'All') params.set('folder', folderFilter);
        if (tagFilter) params.set('tag', tagFilter);
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
  }, [status, search, folderFilter, tagFilter, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  const openCreate = useCallback(() => {
    const next = newInvoiceDraft(cfg);
    // New invoices land in the folder being viewed, else the default from Settings.
    if (folderFilter !== 'All') next.folder = folderFilter;
    if (tagFilter) next.tag = tagFilter;
    setDraft(next);
    setCreateError(null);
    setCreateOpen(true);
  }, [cfg, folderFilter, tagFilter]);

  const submitCreate = useCallback(async () => {
    if (!draft) return;
    const problem = draftProblem(draft);
    if (problem) {
      setCreateError(problem);
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const payload = invoicePayload(draft);
      // The previewed number is only a guess; let the server assign the next
      // one in the sequence unless a different number was typed.
      const body = draft.number.trim() === cfg.numberPreview ? { ...payload, number: undefined } : payload;
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
  }, [draft, cfg.numberPreview, router]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (createOpen) {
        if (e.key === 'Escape') setCreateOpen(false);
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) {
          e.preventDefault();
          void submitCreate();
        }
        return;
      }
      if (paying || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      if ((e.key === 'c' || e.key === 'C') && !busy) {
        e.preventDefault();
        openCreate();
      }
      if (e.key === 'r' || e.key === 'R') refresh();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, openCreate, submitCreate, createOpen, paying, refresh]);

  const closeToolbarMenu = useCallback(() => setOpenMenu(null), []);
  usePopoverDismiss(openMenu !== null, closeToolbarMenu);

  const currencies = useMemo(() => Array.from(new Set(invoices.map((inv) => inv.currency))).sort(), [invoices]);

  const visible = useMemo(() => {
    const rows = currencyFilter ? invoices.filter((inv) => inv.currency === currencyFilter) : [...invoices];
    rows.sort((a, b) => {
      if (sortOrder === 'due') return a.due_at - b.due_at;
      if (sortOrder === 'amount') return invoiceTotals(b).grand - invoiceTotals(a).grand;
      return b.issued_at - a.issued_at;
    });
    return rows;
  }, [invoices, sortOrder, currencyFilter]);
  const filterCount = (tagFilter ? 1 : 0) + (currencyFilter ? 1 : 0);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = visible.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = (currentPage - 1) * PAGE_SIZE + paged.length;
  const isEmpty = !loading && (counts.all ?? 0) === 0 && folderFilter === 'All' && !tagFilter && !search;

  const handleStatusChange = async (id: string, next: InvoiceStatus) => {
    await fetch(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    refresh();
  };

  const handleDelete = async (id: string) => {
    const ok = await ask({
      title: 'Delete this invoice?',
      message: 'The record is removed permanently. Marking it Cancelled instead keeps your numbering intact.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
    refresh();
  };

  const handleDuplicate = async (invoice: InvoiceRow) => {
    // Same client, items and pricing as a fresh draft: new number, today's
    // date and due date from the payment terms, no payments.
    const { number: _number, status: _status, issued_at: _issued, due_at: _due, ...rest } = invoicePayload(draftFromInvoice(invoice));
    void [_number, _status, _issued, _due];
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rest, status: 'draft' }),
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Could not duplicate the invoice');
    refresh();
  };

  const submitPayment = async (invoice: InvoiceRow, payment: PaymentDraft) => {
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payments: [...parsePayments(invoice.payments), payment] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not log the payment');
    setPaying(null);
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

        <div className="toolbar-menu" data-popover-root>
          <button
            className={`btn btn-outline btn-sm${filterCount ? ' is-active' : ''}`}
            disabled={isEmpty}
            onClick={() => setOpenMenu(openMenu === 'filter' ? null : 'filter')}
          >
            <Filter />
            <span>{filterCount ? `Filter · ${filterCount}` : 'Filter'}</span>
            <ChevronDown />
          </button>
          {openMenu === 'filter' && (
            <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0, minWidth: '200px' }}>
              <div className="dropdown-label">Tag</div>
              <div className={`dropdown-item${tagFilter === '' ? ' is-current' : ''}`} onClick={() => { setTagFilter(''); setPage(1); }}>
                <span>Any tag</span>
              </div>
              {tags.map((t) => (
                <div key={t.id} className={`dropdown-item${tagFilter === t.name ? ' is-current' : ''}`} onClick={() => { setTagFilter(t.name); setPage(1); }}>
                  <span className={`tag ${t.color}`}>{t.name}</span>
                </div>
              ))}
              {currencies.length > 1 && (
                <>
                  <div className="dropdown-sep" />
                  <div className="dropdown-label">Currency</div>
                  <div className={`dropdown-item${currencyFilter === '' ? ' is-current' : ''}`} onClick={() => { setCurrencyFilter(''); setPage(1); }}>
                    <span>Any currency</span>
                  </div>
                  {currencies.map((code) => (
                    <div key={code} className={`dropdown-item${currencyFilter === code ? ' is-current' : ''}`} onClick={() => { setCurrencyFilter(code); setPage(1); }}>
                      <span>{code}</span>
                    </div>
                  ))}
                </>
              )}
              {filterCount > 0 && (
                <>
                  <div className="dropdown-sep" />
                  <div className="dropdown-item" onClick={() => { setTagFilter(''); setCurrencyFilter(''); setPage(1); setOpenMenu(null); }}>
                    <span>Clear filters</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

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
              <div className="dropdown" data-popover data-align="end" style={{ top: 'calc(100% + 4px)', right: 0 }}>
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
          <button className="btn btn-outline" onClick={() => { setSearch(''); setStatus('all'); setFolderFilter('All'); setTagFilter(''); setCurrencyFilter(''); }}>
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
              onLogPayment={(inv) => setPaying(inv)}
              dateFormat={cfg.dateFormat}
              tagColor={tags.find((t) => t.name === invoice.tag)?.color}
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
                  Saved as a draft on create
                </span>
              </div>
              <button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Close">
                <XIcon />
              </button>
            </div>
            <div className="modal-body">
              <InvoiceCanvas
                draft={draft}
                onChange={(patch) => {
                  setCreateError(null);
                  setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
                }}
                accounts={cfg.accounts}
                tagline={cfg.tagline}
                logo={cfg.logo}
                dateFormat={cfg.dateFormat}
                currencies={cfg.currencies}
                defaultRate={cfg.defaultRate}
                defaultTerms={cfg.defaultTerms}
                variant="modal"
                payTo={cfg.payTo}
              />
            </div>
            <div className="modal-footer">
              {createError ? (
                <div role="alert" style={{ fontSize: '12px', color: 'var(--destructive)', fontWeight: 500 }}>
                  {createError}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
                  Required: client name. Saved as a draft in <strong>{draft.folder}</strong>
                  {draft.tag ? <> tagged <strong>{draft.tag}</strong></> : null}; send it when it is ready.
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={submitCreate} disabled={busy}>
                  <span>{busy ? 'Creating…' : 'Create invoice'}</span>
                  <kbd>⌘↵</kbd>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {paying && (
        <LogPaymentModal
          currency={paying.currency}
          outstanding={invoiceTotals(paying).balance}
          methods={cfg.methods}
          defaultMethod={paying.payment_method}
          onClose={() => setPaying(null)}
          onSubmit={(payment) => submitPayment(paying, payment)}
        />
      )}

      {confirmModal}
      {guideOpen && <InvoiceGuideModal onClose={() => setGuideOpen(false)} />}
    </Shell>
  );
}
