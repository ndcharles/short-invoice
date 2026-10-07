'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/layout/shell';
import { InvoiceCanvas, InvoiceDraft } from '@/components/invoices/invoice-canvas';
import { LogPaymentModal, SendModal, PaymentDraft, SendDraft } from '@/components/invoices/invoice-modals';
import { pdfFileName, renderInvoicePdf } from '@/lib/invoice-pdf';
import { useConfirm } from '@/components/invoices/choice-modal';
import { Attribution } from '@/components/attribution';
import { useMe, useTeam } from '@/lib/team';
import type { InvoiceRow } from '@/lib/types';
import { ChevronRight, Copy, Cursor, Download, Duplicate, Info, More, Plus, Send, Trash } from '@/components/icons';
import { useCollections } from '@/lib/collections';
import { usePopoverDismiss } from '@/lib/popover';
import { draftFromInvoice, draftProblem, invoicePayload, useInvoiceSettings } from '@/lib/invoice-settings';
import {
  draftTotals,
  fillTemplate,
  fmtMoney,
  formatDay,
  invoiceEquivalent,
  InvoicePayment,
  parsePayments,
  round2,
  STATUS_META,
} from '@/lib/invoices';

interface EmailLog {
  id: string;
  sent_at: number;
  recipients: string;
  subject: string;
  attachments: string;
  status: 'sent' | 'failed';
  error: string | null;
  sent_by?: string | null;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// Edit pages take the id as `?id=` because a static export cannot
// prerender a dynamic `[id]` segment for ids that do not exist yet.
export default function EditInvoicePage() {
  return (
    <Suspense>
      <EditInvoicePageInner />
    </Suspense>
  );
}

function EditInvoicePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id') ?? '';
  const cfg = useInvoiceSettings();
  const [ask, confirmModal] = useConfirm();
  const admin = useMe().me?.role === 'admin';
  const { nameOf } = useTeam();
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [emails, setEmails] = useState<EmailLog[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [baseline, setBaseline] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logMode, setLogMode] = useState<'full' | 'partial'>('full');
  const [sendOpen, setSendOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // A paid invoice can be shown (and printed) as its receipt or as the original invoice.
  const [documentView, setDocumentView] = useState<'invoice' | 'receipt'>('receipt');
  usePopoverDismiss(menuOpen, useCallback(() => setMenuOpen(false), []));

  /** Adopts a row from the server as the new saved state. */
  const adopt = useCallback((row: InvoiceRow) => {
    const next = draftFromInvoice(row);
    setInvoice(row);
    setDraft(next);
    setBaseline(JSON.stringify(next));
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = await res.json();
        if (cancelled || !data.invoice) return;
        adopt(data.invoice as InvoiceRow);
        setEmails((data.emails ?? []) as EmailLog[]);
      } catch (err) {
        console.error('Failed to load invoice:', err);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, adopt]);

  const dirty = useMemo(() => !!draft && JSON.stringify(draft) !== baseline, [draft, baseline]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const payments = useMemo(() => (invoice ? parsePayments(invoice.payments) : []), [invoice]);
  const totals = draft ? draftTotals(draft) : null;
  const paid = round2(payments.reduce((sum, p) => sum + Number(p.amount || 0), 0));
  const balance = totals ? round2(Math.max(0, totals.grand - paid)) : 0;

  const patch = (partial: Partial<InvoiceDraft>) => {
    setError(null);
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  /**
   * Saves the draft (plus any extra fields such as payments) in one PATCH, so
   * logging a payment never loses unsaved edits and the server always derives
   * totals and status from what is on screen.
   */
  /** Returns null on success, otherwise the error message (also shown in the save bar). */
  const commit = useCallback(
    async (extra: Record<string, unknown> = {}): Promise<string | null> => {
      if (!invoice || !draft) return 'The invoice is still loading';
      const problem = draftProblem(draft);
      if (problem) {
        setError(problem);
        return problem;
      }
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/invoices/${invoice.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...invoicePayload(draft), ...extra }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save invoice');
        adopt(data.invoice as InvoiceRow);
        return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save invoice';
        setError(message);
        return message;
      } finally {
        setSaving(false);
      }
    },
    [invoice, draft, adopt]
  );

  // ⌘S / Ctrl+S saves.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && !saving) void commit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirty, saving, commit]);

  const openLog = (mode: 'full' | 'partial' = 'full') => {
    setLogMode(mode);
    setLogOpen(true);
  };

  /** Switches the document to the receipt or the original invoice, then opens the print dialog. */
  const printAs = (view: 'invoice' | 'receipt') => {
    setDocumentView(view);
    // Let React paint the chosen document before the browser snapshots it.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  /**
   * Send modal → saves unsaved edits, renders the chosen documents to PDF from
   * the canvas itself, then emails them through the SMTP server in Settings.
   */
  const sendEmail = async (send: SendDraft, progress: (step: string) => void) => {
    if (!invoice || !draft) return;
    if (dirty) {
      progress('Saving…');
      const failed = await commit();
      if (failed) throw new Error(failed);
    }
    const node = document.querySelector<HTMLElement>('.edit-invoice-layout .invoice-canvas');
    if (!node) throw new Error('The invoice is not on screen');
    const kinds: ('invoice' | 'receipt')[] = send.attach === 'both' ? ['invoice', 'receipt'] : [send.attach];
    const previous = documentView;
    const attachments: { kind: string; filename: string; content: string }[] = [];
    try {
      for (const kind of kinds) {
        progress(`Making the ${kind} PDF…`);
        flushSync(() => setDocumentView(kind));
        await nextFrame();
        await nextFrame();
        const title = `${kind === 'invoice' ? 'Invoice' : 'Receipt'} ${draft.number}`;
        attachments.push({ kind, filename: pdfFileName(kind, draft.number), content: await renderInvoicePdf(node, title) });
      }
    } finally {
      setDocumentView(previous);
    }
    progress('Sending…');
    const res = await fetch(`/api/invoices/${invoice.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: send.to,
        cc: send.cc,
        copy_me: send.copyMe,
        subject: send.subject,
        message: send.message,
        attachments,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.invoice) adopt(data.invoice as InvoiceRow);
    if (data.emails) setEmails(data.emails as EmailLog[]);
    if (!res.ok) throw new Error(data.error || 'Could not send the email');
    setSendOpen(false);
    setNotice(`Sent to ${send.to.join(', ')}`);
    setTimeout(() => setNotice(null), 4000);
  };

  const removePayment = async (index: number) => {
    const payment = payments[index];
    if (!payment || !draft) return;
    const ok = await ask({
      title: 'Remove this payment?',
      message: `The ${fmtMoney(payment.amount, draft.currency)} payment from ${payment.date} is removed and the balance and status update.`,
      confirmLabel: 'Remove payment',
      destructive: true,
    });
    if (!ok) return;
    await commit({ payments: payments.filter((_, i) => i !== index) });
  };

  const duplicate = async () => {
    if (!draft) return;
    const { number: _number, status: _status, ...rest } = invoicePayload(draft);
    void _number;
    void _status;
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rest, issued_at: undefined, due_at: undefined, status: 'draft' }),
    });
    const data = await res.json();
    if (res.ok && data.invoice) router.push(`/invoices/edit?id=${encodeURIComponent(data.invoice.id)}`);
    else setError(data.error || 'Could not duplicate this invoice');
  };

  if ((loading || !cfg.loaded) && id) {
    return (
      <Shell>
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading invoice…</div>
      </Shell>
    );
  }

  if (!id || notFound || !invoice || !draft || !totals) {
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

  const meta = STATUS_META[draft.status];
  const equivalent = invoiceEquivalent({
    currency: draft.currency,
    grand: totals.grand,
    balance,
    exchangeRate: draft.exchangeRate,
    equivalentAmount: draft.equivalentAmount,
  });
  const canLogPayment = draft.status !== 'draft' && draft.status !== 'cancelled' && draft.status !== 'paid';
  const lastPayment = payments[payments.length - 1];
  const templateValues = {
    client: draft.clientContact || draft.clientName,
    number: draft.number,
    // Invoice emails quote the total (with the equivalent when shown); receipts the latest payment.
    amount: lastPayment
      ? fmtMoney(lastPayment.amount, draft.currency)
      : `${fmtMoney(totals.grand, draft.currency)}${equivalent ? ` (≈ ${fmtMoney(equivalent.total, equivalent.code)})` : ''}`,
    due: formatDay(draft.dueAt, cfg.dateFormat),
    payment_date: lastPayment?.date ?? '',
    company: cfg.payTo.name,
  };
  const emailTemplates = {
    invoice: {
      subject: fillTemplate(cfg.emails.invoiceSubject, {
        ...templateValues,
        amount: `${fmtMoney(totals.grand, draft.currency)}${equivalent ? ` (≈ ${fmtMoney(equivalent.total, equivalent.code)})` : ''}`,
      }),
      message: fillTemplate(cfg.emails.invoiceBody, {
        ...templateValues,
        amount: `${fmtMoney(totals.grand, draft.currency)}${equivalent ? ` (≈ ${fmtMoney(equivalent.total, equivalent.code)})` : ''}`,
      }),
    },
    receipt: {
      subject: fillTemplate(cfg.emails.receiptSubject, templateValues),
      message: fillTemplate(cfg.emails.receiptBody, templateValues),
    },
  };
  const folderNames = Array.from(new Set([...(folders.length ? folders.map((f) => f.name) : ['Invoices']), draft.folder]));
  const tagNames = Array.from(new Set([...tags.map((t) => t.name), ...(draft.tag ? [draft.tag] : [])]));

  return (
    <Shell>
      <div className="crumb-bar">
        <div className="crumbs">
          <Link href="/invoices">Invoices</Link>
          <ChevronRight />
          <span className="current">
            <span className="favicon inv-favicon" style={{ width: '20px', height: '20px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>
            {draft.number}
          </span>
          {dirty && <span className="draft-saved" style={{ marginLeft: 0 }}>Unsaved changes</span>}
          {notice && (
            <span className="draft-saved" role="status" style={{ marginLeft: 0, color: 'var(--accent-green-fg)' }}>
              {notice}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="click-stat-large" title={balance > 0 && paid > 0 ? `${fmtMoney(balance, draft.currency)} still due` : 'Invoice total'}>
            <Cursor />
            <strong>{fmtMoney(totals.grand, draft.currency)}</strong>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setSendOpen(true)}>
            <Send />
            <span>Send</span>
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/invoices/edit?id=${encodeURIComponent(invoice.id)}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Copy />
            <span>{copied ? 'Copied' : 'Copy link'}</span>
          </button>
          <div className="toolbar-menu" data-popover-root>
            <button className="icon-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="More">
              <More />
            </button>
            {menuOpen && (
              <div className="dropdown" data-popover data-align="end" style={{ top: 'calc(100% + 4px)', right: 0 }}>
                {canLogPayment && (
                  <div className="dropdown-item" onClick={() => { setMenuOpen(false); openLog('full'); }}>
                    <Plus />
                    <span>Log payment</span>
                  </div>
                )}
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); void duplicate(); }}>
                  <Duplicate />
                  <span>Duplicate as new draft</span>
                </div>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); window.print(); }}>
                  <Download />
                  <span>Print / PDF</span>
                </div>
                {admin && (
                  <>
                    <div className="dropdown-sep" />
                    <div
                      className="dropdown-item destructive"
                      onClick={async () => {
                        setMenuOpen(false);
                        const ok = await ask({
                          title: `Delete ${draft.number}?`,
                          message: 'The record is removed permanently. Marking it Cancelled instead keeps your numbering intact.',
                          confirmLabel: 'Delete',
                          destructive: true,
                        });
                        if (!ok) return;
                        await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' });
                        router.push('/invoices');
                      }}
                    >
                      <Trash />
                      <span>Delete invoice</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="edit-invoice-layout">
        <InvoiceCanvas
          key={invoice.id}
          draft={draft}
          onChange={patch}
          payments={payments}
          onLogPayment={openLog}
          documentView={documentView}
          onDocumentViewChange={setDocumentView}
          accounts={cfg.accounts}
          tagline={cfg.tagline}
          logo={cfg.logo}
          dateFormat={cfg.dateFormat}
          currencies={cfg.currencies}
          defaultRate={cfg.defaultRate}
          defaultTerms={cfg.defaultTerms}
          payTo={cfg.payTo}
        />

        <aside className="right-rail">
          <div className="rail-card">
            <div className="rail-title">
              <span>Invoice summary</span>
              <span className={`inv-status ${meta.cls}`}>
                <span className="inv-status-dot" />
                {meta.label}
              </span>
            </div>

            <div className="rail-section">
              <div className="rail-section-label">Client</div>
              <div className="rail-client-name">{draft.clientName || 'Client name'}</div>
              {draft.clientContact && <div className="rail-client-line">{draft.clientContact}</div>}
              {draft.clientAddr1 && <div className="rail-client-line">{draft.clientAddr1}</div>}
              {draft.clientAddr2 && <div className="rail-client-line">{draft.clientAddr2}</div>}
              {draft.clientCountry && <div className="rail-client-line">{draft.clientCountry}</div>}
              <div className="rail-client-line">{draft.clientEmail || 'No email yet'}</div>
            </div>

            <div className="rail-section">
              <div className="rail-section-label">Payment breakdown</div>
              <div className="rail-kv"><span>Subtotal</span><span>{fmtMoney(totals.subtotal, draft.currency)}</span></div>
              {totals.discount > 0 && (
                <div className="rail-kv">
                  <span>Discount{draft.discountType === 'percent' ? ` (${draft.discount}%)` : ''}</span>
                  <span>− {fmtMoney(totals.discount, draft.currency)}</span>
                </div>
              )}
              {totals.charges > 0 && (
                <div className="rail-kv"><span>Additional charges</span><span>{fmtMoney(totals.charges, draft.currency)}</span></div>
              )}
              <div className="rail-kv"><span>Tax ({round2(draft.taxRate * 100)}%)</span><span>{fmtMoney(totals.tax, draft.currency)}</span></div>
              <div className="rail-kv rail-kv-total"><span>Invoice total</span><span>{fmtMoney(totals.grand, draft.currency)}</span></div>
              {equivalent && (
                <>
                  <div className="rail-kv" style={{ paddingTop: 0 }}>
                    <span>Equivalent ({equivalent.code})</span>
                    <span style={{ color: 'var(--muted-foreground)' }}>{fmtMoney(equivalent.total, equivalent.code)}</span>
                  </div>
                  <div className="rail-kv" style={{ paddingTop: 0 }}>
                    <span style={{ color: 'var(--muted-foreground)' }}>Exchange rate</span>
                    <span style={{ color: 'var(--muted-foreground)' }}>{equivalent.rateLine}</span>
                  </div>
                </>
              )}
              {paid > 0 && (
                <>
                  <div className="rail-kv">
                    <span>Amount paid</span>
                    <span className="rail-paid">− {fmtMoney(Math.min(paid, totals.grand), draft.currency)}</span>
                  </div>
                  {paid > totals.grand && (
                    <div className="rail-kv">
                      <span>Overpaid (credit)</span>
                      <span style={{ color: 'var(--accent-green-fg)' }}>{fmtMoney(paid - totals.grand, draft.currency)}</span>
                    </div>
                  )}
                  <div className={`rail-kv rail-kv-balance${balance <= 0 ? ' is-cleared' : ''}`}>
                    <span>{balance <= 0 ? 'Balance' : 'Balance due'}</span>
                    <span>{fmtMoney(balance, draft.currency)}</span>
                  </div>
                </>
              )}
              <div className="rail-kv" style={{ color: 'var(--muted-foreground)' }}>
                <span>Due</span>
                <span>{formatDay(draft.dueAt, cfg.dateFormat)}</span>
              </div>
            </div>

            <div className="rail-section">
              <div className="rail-section-label">Organisation</div>
              <label className="rail-field">
                <span>Folder</span>
                <span className="setting-select">
                  <select value={draft.folder} onChange={(e) => patch({ folder: e.target.value })}>
                    {folderNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </span>
              </label>
              <label className="rail-field">
                <span>Tag</span>
                <span className="setting-select">
                  <select value={draft.tag ?? ''} onChange={(e) => patch({ tag: e.target.value || null })}>
                    <option value="">No tag</option>
                    {tagNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </span>
              </label>
            </div>

            <div className="rail-section rail-actions">
              {draft.status !== 'draft' && draft.status !== 'cancelled' && (
                <button
                  className="btn btn-primary rail-btn"
                  disabled={!canLogPayment}
                  title={canLogPayment ? 'Log a payment' : 'This invoice is fully paid'}
                  onClick={() => openLog('full')}
                >
                  <Plus />
                  <span>Log Payment</span>
                </button>
              )}
              {(draft.status === 'draft' || payments.length > 0) && (
                <button
                  className={`btn ${draft.status === 'draft' ? 'btn-primary' : 'btn-outline'} rail-btn`}
                  onClick={() => setSendOpen(true)}
                >
                  <Send />
                  <span>{payments.length > 0 ? 'Send receipt' : 'Send to client'}</span>
                </button>
              )}
              {payments.length > 0 ? (
                <>
                  <button className="btn btn-outline rail-btn" onClick={() => printAs('receipt')}>
                    <Download />
                    <span>Download receipt</span>
                  </button>
                  <button
                    className="btn btn-outline rail-btn"
                    title="The invoice as originally issued, without payments"
                    onClick={() => printAs('invoice')}
                  >
                    <Download />
                    <span>Download original invoice</span>
                  </button>
                </>
              ) : (
                <button className="btn btn-outline rail-btn" onClick={() => window.print()}>
                  <Download />
                  <span>Download PDF</span>
                </button>
              )}
            </div>

            <div className="rail-section">
              <Attribution
                className="rail-attribution"
                createdBy={invoice.created_by}
                createdAt={invoice.created_at}
                updatedBy={invoice.updated_by}
                updatedAt={invoice.updated_at}
                fallbackInitials={invoice.avatar}
              />
            </div>

            {emails.length > 0 && (
              <div className="rail-section">
                <div className="rail-section-label">Emails ({emails.length})</div>
                {emails.map((mail) => (
                  <div className="rail-payment" key={mail.id} title={mail.error ?? mail.subject}>
                    <span className={`rail-email-dot${mail.status === 'failed' ? ' is-failed' : ''}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="rail-payment-amt rail-email-to">{mail.recipients}</div>
                      <div className="rail-payment-sub">
                        {mail.status === 'failed' ? 'Failed' : 'Sent'} {formatDay(mail.sent_at, cfg.dateFormat)}
                        {mail.sent_by ? ` by ${nameOf(mail.sent_by)}` : ''}
                        {mail.attachments ? ` · ${mail.attachments.replace(',', ' + ')}` : ''}
                      </div>
                      {mail.status === 'failed' && mail.error && <div className="rail-email-error">{mail.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {payments.length > 0 && (
              <div className="rail-section">
                <div className="rail-section-label">Payments ({payments.length})</div>
                {payments.map((payment: InvoicePayment, index) => (
                  <div className="rail-payment" key={index}>
                    <span className="rail-payment-idx">{index + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="rail-payment-amt">{fmtMoney(payment.amount, draft.currency)}</div>
                      <div className="rail-payment-sub">
                        {payment.date}
                        {payment.method ? ` · ${payment.method}` : ''}
                        {payment.note ? ` · ${payment.note}` : ''}
                        {payment.by ? ` · logged by ${nameOf(payment.by)}` : ''}
                      </div>
                    </div>
                    <button
                      className="icon-btn rail-payment-remove"
                      title="Remove this payment"
                      aria-label="Remove this payment"
                      onClick={() => void removePayment(index)}
                    >
                      <Trash />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {logOpen && (
        <LogPaymentModal
          initialFullyPaid={logMode === 'full'}
          currency={draft.currency}
          outstanding={balance}
          methods={cfg.methods}
          defaultMethod={draft.paymentMethod}
          onClose={() => setLogOpen(false)}
          onSubmit={async (payment: PaymentDraft) => {
            const failed = await commit({ payments: [...payments, payment] });
            if (failed) throw new Error(failed);
            setLogOpen(false);
          }}
        />
      )}

      {sendOpen && (
        <SendModal
          clientEmail={draft.clientEmail}
          copyEmail={cfg.copyEmail}
          hasPayments={payments.length > 0}
          templates={emailTemplates}
          ready={cfg.emailReady}
          onClose={() => setSendOpen(false)}
          onSubmit={sendEmail}
        />
      )}

      {confirmModal}

      <div className={`save-bar ${dirty || error ? 'visible' : ''}`}>
        <span className="save-bar-dot" />
        <span>{error ?? (saving ? 'Saving…' : 'Unsaved changes')}</span>
        <button
          className="btn btn-outline"
          disabled={saving}
          onClick={() => {
            try {
              setDraft(JSON.parse(baseline) as InvoiceDraft);
            } catch {
              /* nothing to discard */
            }
            setError(null);
          }}
        >
          Discard
        </button>
        <button className="btn btn-primary" onClick={() => void commit()} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Shell>
  );
}
