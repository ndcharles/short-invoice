'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/layout/shell';
import { InvoiceEditor, type InvoiceDraft, type PastClient } from '@/components/invoices/invoice-editor';
import { LogPaymentModal, SendModal, type PaymentDraft } from '@/components/invoices/invoice-modals';
import type { InvoiceView } from '@/lib/types';
import { ChevronRight, Copy, Download, Duplicate, Info, More, Plus, Refresh, Send, Trash } from '@/components/icons';
import { useCollections, useSettings } from '@/lib/collections';
import { usePopoverDismiss } from '@/lib/popover';
import { daysUntil, fillTemplate, fmtMoney, parsePayments, STATUS_META, type InvoiceStatus } from '@/lib/invoices';
import { formatDate } from '@/lib/dates';
import {
  accountsFrom,
  defaultRateFrom,
  draftFromInvoice,
  methodsFrom,
  newDraft,
  nextNumberPreview,
  payloadFromDraft,
  payToFrom,
} from '@/lib/invoice-settings';

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

// Edit pages take the id as `?id=` because a static export cannot
// prerender a dynamic `[id]` segment. `?new=1` opens a blank invoice.
export default function EditInvoicePage() {
  return (
    <Suspense>
      <EditInvoicePageInner />
    </Suspense>
  );
}

function dueText(invoice: InvoiceView, dateFormat?: string): string {
  if (invoice.display_status === 'paid') return 'Paid in full';
  if (invoice.display_status === 'cancelled') return 'Cancelled';
  const days = daysUntil(invoice.due_at);
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  return `Due in ${days} day${days === 1 ? '' : 's'} · ${formatDate(invoice.due_at, dateFormat)}`;
}

function EditInvoicePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id') ?? '';
  const isNew = !id;
  const settings = useSettings();
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');

  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [clients, setClients] = useState<PastClient[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<'pay' | 'send' | null>(searchParams.get('pay') === '1' ? 'pay' : null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  usePopoverDismiss(menuOpen, useCallback(() => setMenuOpen(false), []));

  useEffect(() => {
    queueMicrotask(() => setOrigin(window.location.origin));
    call('/api/invoices/clients')
      .then((data) => setClients(data.clients ?? []))
      .catch(() => {});
  }, []);

  const adopt = useCallback((inv: InvoiceView) => {
    const next = draftFromInvoice(inv);
    setInvoice(inv);
    setDraft(next);
    setBaseline(JSON.stringify(next));
  }, []);

  // Existing invoice
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    call(`/api/invoices/${encodeURIComponent(id)}`)
      .then((data) => !cancelled && adopt(data.invoice))
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, isNew, adopt]);

  // New invoice: start from the settings defaults once they arrive.
  useEffect(() => {
    if (!isNew || !settings || draft) return;
    queueMicrotask(() => {
      const fresh = newDraft(settings);
      setDraft(fresh);
      setBaseline(JSON.stringify(fresh));
    });
  }, [isNew, settings, draft]);

  const dirty = useMemo(() => !!draft && (isNew || JSON.stringify(draft) !== baseline), [draft, baseline, isNew]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = useCallback((p: Partial<InvoiceDraft>) => setDraft((prev) => (prev ? { ...prev, ...p } : prev)), []);

  /** Saves pending edits (creating the invoice if new) and returns the saved invoice. */
  const save = useCallback(async (): Promise<InvoiceView | null> => {
    if (!draft) return null;
    if (!draft.client_name.trim()) {
      setError('Add the client name before saving.');
      return null;
    }
    if (!dirty && invoice) return invoice;
    setSaving(true);
    setError(null);
    try {
      const data = invoice
        ? await call(`/api/invoices/${invoice.id}`, 'PATCH', payloadFromDraft(draft))
        : await call('/api/invoices', 'POST', payloadFromDraft(draft));
      adopt(data.invoice);
      if (!invoice) router.replace(`/invoices/edit?id=${encodeURIComponent(data.invoice.id)}`);
      return data.invoice as InvoiceView;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the invoice');
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, dirty, invoice, adopt, router]);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  /** Runs an action on the saved invoice, saving first when needed. */
  const act = async (fn: (inv: InvoiceView) => Promise<void> | void) => {
    const saved = await save();
    if (!saved) return;
    try {
      await fn(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const setStatus = (status: 'draft' | 'sent' | 'cancelled', message: string) =>
    act(async (inv) => {
      const data = await call(`/api/invoices/${inv.id}`, 'PATCH', { status });
      adopt(data.invoice);
      setNotice(message);
    });

  const clientLink = invoice?.share_token && origin ? `${origin}/s/i/${invoice.share_token}` : '';
  const openDocument = (inv: InvoiceView, print: boolean, receipt = false): void => {
    window.open(`/s/i/${inv.share_token}?preview=1${print ? '&print=1' : ''}${receipt ? '&doc=receipt' : ''}`, '_blank', 'noopener');
  };

  if (loading || !draft) {
    return (
      <Shell>
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading invoice…</div>
      </Shell>
    );
  }

  if (notFound) {
    return (
      <Shell>
        <div className="empty">
          <div className="empty-icon">
            <Info width="24" height="24" />
          </div>
          <h3>Invoice not found</h3>
          <p>This invoice may have been deleted.</p>
          <Link href="/invoices" className="btn btn-primary">
            Back to invoices
          </Link>
        </div>
      </Shell>
    );
  }

  const status: InvoiceStatus = invoice?.display_status ?? 'draft';
  const payments = invoice ? parsePayments(invoice.payments) : [];
  const totals = invoice?.totals;
  const dateFormat = settings?.date_format;
  const canPay = !!invoice && status !== 'cancelled' && (totals?.balance ?? 0) > 0;
  const templateValues: Record<string, string> = invoice
    ? {
        client: invoice.client_contact || invoice.client_name,
        number: invoice.number,
        amount: fmtMoney(invoice.totals.total, invoice.currency),
        balance: fmtMoney(invoice.totals.balance, invoice.currency),
        due: formatDate(invoice.due_at, dateFormat),
        link: clientLink,
        payment_date: payments.length ? formatDate(Date.parse(`${payments[payments.length - 1].date}T00:00:00Z`), dateFormat) : '',
      }
    : {};
  const receiptMode = payments.length > 0;
  const withLink = (body: string) => (body.includes('{link}') ? body : `${body}\n\nView or download: {link}`);

  return (
    <Shell>
      <div className="crumb-bar">
        <div className="crumbs">
          <Link href="/invoices">Invoices</Link>
          <ChevronRight />
          <span className="current">{invoice?.number ?? 'New invoice'}</span>
          {dirty && <span className="draft-saved" style={{ marginLeft: 0 }}>{isNew ? 'Not saved yet' : 'Unsaved changes'}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {invoice && (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => act(() => setModal('send'))}>
                <Send />
                <span>Send</span>
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => act((inv) => openDocument(inv, true))}>
                <Download />
                <span>PDF</span>
              </button>
            </>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving || (!dirty && !!invoice)}>
            {saving ? 'Saving…' : isNew ? 'Create invoice' : 'Save'}
          </button>
          {invoice && (
            <div className="toolbar-menu" data-popover-root>
              <button className="icon-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="More actions">
                <More />
              </button>
              {menuOpen && (
                <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', right: 0, minWidth: 220 }}>
                  {invoice.status === 'draft' && (
                    <div className="dropdown-item" onClick={() => { setMenuOpen(false); void setStatus('sent', 'Marked as sent.'); }}>
                      <Send />
                      <span>Mark as sent</span>
                    </div>
                  )}
                  {invoice.status === 'sent' && payments.length === 0 && (
                    <div className="dropdown-item" onClick={() => { setMenuOpen(false); void setStatus('draft', 'Moved back to draft.'); }}>
                      <Refresh />
                      <span>Move back to draft</span>
                    </div>
                  )}
                  <div className="dropdown-item" onClick={() => { setMenuOpen(false); act((inv) => openDocument(inv, false)); }}>
                    <Info />
                    <span>Preview client view</span>
                  </div>
                  {receiptMode && (
                    <div className="dropdown-item" onClick={() => { setMenuOpen(false); act((inv) => openDocument(inv, true, true)); }}>
                      <Download />
                      <span>Receipt PDF</span>
                    </div>
                  )}
                  <div
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      act(async (inv) => {
                        const data = await call(`/api/invoices/${inv.id}/duplicate`, 'POST');
                        router.push(`/invoices/edit?id=${encodeURIComponent(data.invoice.id)}`);
                      });
                    }}
                  >
                    <Duplicate />
                    <span>Duplicate as new draft</span>
                  </div>
                  <div
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      if (!confirm('Create a new client link? The current link will stop working.')) return;
                      act(async (inv) => {
                        adopt((await call(`/api/invoices/${inv.id}/share/reset`, 'POST')).invoice);
                        setNotice('New client link created; the old one no longer works.');
                      });
                    }}
                  >
                    <Refresh />
                    <span>Reset client link</span>
                  </div>
                  <div className="dropdown-sep" />
                  {invoice.status === 'cancelled' ? (
                    <div className="dropdown-item" onClick={() => { setMenuOpen(false); void setStatus(invoice.sent_at ? 'sent' : 'draft', 'Invoice re-opened.'); }}>
                      <Refresh />
                      <span>Re-open invoice</span>
                    </div>
                  ) : (
                    <div
                      className="dropdown-item"
                      onClick={() => {
                        setMenuOpen(false);
                        if (confirm(`Cancel ${invoice.number}? It stays on record (keeping your numbering intact) but no longer counts as owed.`)) {
                          void setStatus('cancelled', 'Invoice cancelled.');
                        }
                      }}
                    >
                      <Info />
                      <span>Cancel invoice</span>
                    </div>
                  )}
                  <div
                    className="dropdown-item destructive"
                    onClick={async () => {
                      setMenuOpen(false);
                      const sent = invoice.status !== 'draft';
                      const warning = sent
                        ? `Delete ${invoice.number} permanently? It has been sent, so cancelling is usually better: it keeps your invoice numbers continuous.`
                        : `Delete draft ${invoice.number}?`;
                      if (!confirm(warning)) return;
                      await call(`/api/invoices/${invoice.id}`, 'DELETE');
                      router.push('/invoices');
                    }}
                  >
                    <Trash />
                    <span>Delete</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {(error || notice) && (
        <div
          role="status"
          style={{
            margin: '0 0 12px',
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            background: error ? '#fee2e2' : 'var(--muted)',
            color: error ? '#991b1b' : 'var(--foreground)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{error ?? notice}</span>
          <button className="btn btn-ghost btn-sm" style={{ height: 'auto', padding: '0 4px' }} onClick={() => { setError(null); setNotice(null); }}>
            Dismiss
          </button>
        </div>
      )}

      <div className="edit-invoice-layout">
        <InvoiceEditor
          draft={draft}
          onChange={patch}
          status={status}
          payments={payments}
          payTo={payToFrom(settings)}
          accounts={accountsFrom(settings)}
          clients={clients}
          defaultRate={defaultRateFrom(settings)}
          dateFormat={dateFormat}
          numberPlaceholder={isNew ? `${nextNumberPreview(settings)} (assigned on save)` : undefined}
        />

        <aside className="right-rail">
          <div className="rail-card" style={{ marginBottom: 12 }}>
            <div className="rail-section" style={{ display: 'grid', gap: 8 }}>
              <div className="rail-section-label">Organise</div>
              <label style={{ display: 'grid', gridTemplateColumns: '60px 1fr', alignItems: 'center', fontSize: 12, gap: 8 }}>
                <span style={{ color: 'var(--muted-foreground)' }}>Folder</span>
                <select className="input" value={draft.folder} onChange={(e) => patch({ folder: e.target.value })}>
                  {Array.from(new Set(['Invoices', ...folders.map((f) => f.name), draft.folder])).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gridTemplateColumns: '60px 1fr', alignItems: 'center', fontSize: 12, gap: 8 }}>
                <span style={{ color: 'var(--muted-foreground)' }}>Tag</span>
                <select className="input" value={draft.tag ?? ''} onChange={(e) => patch({ tag: e.target.value || null })}>
                  <option value="">No tag</option>
                  {Array.from(new Set([...tags.map((t) => t.name), ...(draft.tag ? [draft.tag] : [])])).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="rail-card">
            <div className="rail-title">
              <span>Summary</span>
              <span className={`inv-status ${STATUS_META[status].cls}`}>
                <span className="inv-status-dot" />
                {STATUS_META[status].label}
              </span>
            </div>

            {!invoice ? (
              <div className="rail-section" style={{ fontSize: '12px', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                Fill in the client and line items, then press <strong>Create invoice</strong>. It is saved as a draft; you can
                send it, download a PDF or log payments afterwards.
              </div>
            ) : (
              <>
                <div className="rail-section">
                  <div className="rail-kv">
                    <span>Total</span>
                    <strong>{fmtMoney(invoice.totals.total, invoice.currency)}</strong>
                  </div>
                  {invoice.equivalent && (
                    <div className="rail-kv" style={{ paddingTop: 0, color: 'var(--muted-foreground)' }}>
                      <span>≈ {invoice.equivalent.currency}</span>
                      <span>{fmtMoney(invoice.equivalent.total, invoice.equivalent.currency)}</span>
                    </div>
                  )}
                  <div className="rail-kv">
                    <span>Paid</span>
                    <span>{fmtMoney(Math.min(invoice.totals.paid, invoice.totals.total), invoice.currency)}</span>
                  </div>
                  <div className={`rail-kv rail-kv-balance${invoice.totals.balance <= 0 ? ' is-cleared' : ''}`}>
                    <span>Balance due</span>
                    <span>{fmtMoney(invoice.totals.balance, invoice.currency)}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: status === 'overdue' ? '#991b1b' : 'var(--muted-foreground)', marginTop: 6 }}>
                    {dueText(invoice, dateFormat)}
                  </div>
                  {dirty && (
                    <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: 4 }}>Figures update when you save.</div>
                  )}
                </div>

                <div className="rail-section rail-actions">
                  <button className="btn btn-primary rail-btn" disabled={!canPay} onClick={() => act(() => setModal('pay'))} title={canPay ? 'Record money received' : 'Nothing left to pay'}>
                    <Plus />
                    <span>Log payment</span>
                  </button>
                  <button
                    className="btn btn-outline rail-btn"
                    disabled={!clientLink}
                    onClick={async () => {
                      await navigator.clipboard.writeText(clientLink);
                      setNotice('Client link copied. Anyone with it can view this invoice.');
                    }}
                  >
                    <Copy />
                    <span>Copy client link</span>
                  </button>
                </div>

                <div className="rail-section" style={{ fontSize: '12px', color: 'var(--muted-foreground)', display: 'grid', gap: 4 }}>
                  <span>Created {formatDate(invoice.created_at, dateFormat)}</span>
                  {invoice.sent_at && <span>Sent {formatDate(invoice.sent_at, dateFormat)}</span>}
                  <span>{invoice.viewed_at ? `Client opened it ${formatDate(invoice.viewed_at, dateFormat)}` : 'Client has not opened the link yet'}</span>
                </div>

                {payments.length > 0 && (
                  <div className="rail-section">
                    <div className="rail-section-label">Payments ({payments.length})</div>
                    {payments.map((p, index) => (
                      <div className="rail-payment" key={p.id}>
                        <span className="rail-payment-idx">{index + 1}</span>
                        <div style={{ flex: 1 }}>
                          <div className="rail-payment-amt">{fmtMoney(p.amount, invoice.currency)}</div>
                          <div className="rail-payment-sub">
                            {formatDate(Date.parse(`${p.date}T00:00:00Z`), dateFormat)}
                            {p.method ? ` · ${p.method}` : ''}
                          </div>
                        </div>
                        <button
                          className="icon-btn"
                          title="Remove this payment"
                          aria-label="Remove payment"
                          onClick={async () => {
                            if (!confirm(`Remove the ${fmtMoney(p.amount, invoice.currency)} payment?`)) return;
                            try {
                              adopt((await call(`/api/invoices/${invoice.id}/payments/${p.id}`, 'DELETE')).invoice);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Could not remove the payment');
                            }
                          }}
                        >
                          <Trash />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {modal === 'pay' && invoice && (
        <LogPaymentModal
          currency={invoice.currency}
          balance={invoice.totals.balance}
          methods={methodsFrom(settings)}
          onClose={() => setModal(null)}
          onSubmit={async (payment: PaymentDraft) => {
            const data = await call(`/api/invoices/${invoice.id}/payments`, 'POST', payment);
            adopt(data.invoice);
            setModal(null);
            setNotice(data.invoice.status === 'paid' ? 'Payment logged. The invoice is paid in full.' : 'Payment logged.');
          }}
        />
      )}

      {modal === 'send' && invoice && (
        <SendModal
          to={invoice.client_email}
          link={clientLink}
          isDraft={invoice.status === 'draft'}
          subject={fillTemplate(
            receiptMode
              ? settings?.inv_email_receipt_subject || 'Receipt for invoice {number}'
              : settings?.inv_email_invoice_subject || 'Invoice {number}',
            templateValues
          )}
          body={fillTemplate(
            withLink(
              receiptMode
                ? settings?.inv_email_receipt_body || 'Hi {client},\n\nThank you for your payment for invoice {number}.'
                : settings?.inv_email_invoice_body || 'Hi {client},\n\nPlease find invoice {number} for {amount}, due {due}.'
            ),
            templateValues
          )}
          onClose={() => setModal(null)}
          onSent={async () => {
            if (invoice.status === 'draft') {
              adopt((await call(`/api/invoices/${invoice.id}`, 'PATCH', { status: 'sent' })).invoice);
            }
          }}
        />
      )}
    </Shell>
  );
}
