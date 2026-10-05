'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/layout/shell';
import { CanvasAccount, InvoiceCanvas, InvoiceDraft } from '@/components/invoices/invoice-canvas';
import { LogPaymentModal, SendModal, PaymentDraft } from '@/components/invoices/invoice-modals';
import type { InvoiceRow } from '@/lib/types';
import { ChevronDown, ChevronRight, Copy, Cursor, Info, More, Plus, Send, Trash } from '@/components/icons';
import { useSettings } from '@/lib/collections';
import { parseList } from '@/lib/settings-json';
import {
  draftTotals,
  fmtMoney,
  parseItems,
  parsePayments,
  STATUS_META,
  InvoiceStatus,
  InvoiceItem,
} from '@/lib/invoices';

function draftFromInvoice(invoice: InvoiceRow, paymentMethod: string): InvoiceDraft {
  const addressLines = (invoice.client_address || '').split('\n');
  const items = parseItems(invoice.items);
  const rate = Number(invoice.tax_rate ?? 0.075);

  // Seeded invoices store a grand total with no line items — materialise the
  // design's synthetic "Services" line so the canvas totals match.
  const effectiveItems: InvoiceItem[] =
    items.length > 0
      ? items
      : Number(invoice.total) > 0
        ? [{ name: 'Services', desc: '', qty: 1, unitPrice: Math.round((Number(invoice.total) / (1 + rate)) * 100) / 100 }]
        : [];

  return {
    number: invoice.number,
    clientName: invoice.client_name,
    clientContact: addressLines[1] ?? '',
    clientAddr1: addressLines[2] ?? '',
    clientAddr2: addressLines[3] ?? '',
    clientCountry: addressLines[4] ?? '',
    clientEmail: invoice.client_email,
    issuedAt: invoice.issued_at,
    dueAt: invoice.due_at,
    currency: invoice.currency,
    status: invoice.status as InvoiceStatus,
    items: effectiveItems,
    charges: Number(invoice.charges ?? 0),
    discount: Number(invoice.discount ?? 0),
    discountType: (invoice.discount_type === 'percent' ? 'percent' : 'value') as 'value' | 'percent',
    equivalentAmount: Number(invoice.equivalent_amount ?? 0),
    exchangeRate: Number(invoice.exchange_rate ?? 0),
    
    taxRate: rate,
    terms: invoice.terms || 'Net 30. Late payments accrue 1.5% interest per month.',
    notes: invoice.notes,
    paymentMethod,
  };
}


function addressFromDraft(draft: InvoiceDraft): string {
  return [draft.clientName, draft.clientContact, draft.clientAddr1, draft.clientAddr2, draft.clientCountry]
    .filter(Boolean)
    .join('\n');
}

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
  const settings = useSettings();
  const canvasAccounts = parseList<CanvasAccount>(settings?.inv_accounts, []);
  const methodNames = parseList<{ name: string; enabled: boolean }>(settings?.inv_methods, [])
    .filter((m) => m.enabled !== false)
    .map((m) => m.name);
  const canvasTagline = {
    on: settings?.inv_tagline_on === 'true',
    text: settings?.inv_tagline_text ?? '',
    color: settings?.inv_tagline_color ?? '#1d4ed8',
  };

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
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

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invoices/${id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = await res.json();
        if (cancelled || !data.invoice) return;
        const inv = data.invoice as InvoiceRow;
        const payments = parsePayments(inv.payments);
        const method =
          inv.payment_method || payments[payments.length - 1]?.method || 'Paystack (Debit/Credit Cards)';
        const initial = draftFromInvoice(inv, method);
        setInvoice(inv);
        setDraft(initial);
        setBaseline(JSON.stringify(initial));
      } catch (err) {
        console.error('Failed to load invoice:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const dirty = useMemo(() => !!draft && JSON.stringify(draft) !== baseline, [draft, baseline]);

  const totals = draft ? draftTotals(draft) : null;
  const payments = invoice ? parsePayments(invoice.payments) : [];
  const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const balance = totals ? Math.max(0, totals.grand - paid) : 0;

  const patch = (partial: Partial<InvoiceDraft>) => setDraft((prev) => (prev ? { ...prev, ...partial } : prev));

  const handleSave = async () => {
    if (!invoice || !draft) return;
    if (!draft.clientName.trim()) {
      setError('A client name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: draft.number,
          client_name: draft.clientName,
          client_email: draft.clientEmail,
          client_address: addressFromDraft(draft),
          issued_at: draft.issuedAt,
          due_at: draft.dueAt,
          currency: draft.currency,
          status: draft.status,
          items: draft.items,
          subtotal: totals?.subtotal ?? 0,
          tax_rate: draft.taxRate,
          discount: draft.discount,
          discount_type: draft.discountType,
          charges: draft.charges,
          payment_method: draft.paymentMethod,
          equivalent_amount: draft.equivalentAmount,
          exchange_rate: draft.exchangeRate,
          total: totals?.grand ?? 0,
          notes: draft.notes,
          terms: draft.terms,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save invoice');
      setInvoice(data.invoice);
      setBaseline(JSON.stringify(draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  const logPayment = async () => {
    if (!invoice || !totals) return;
    const raw = prompt(`Amount received for ${draft?.number ?? invoice.number} (${invoice.currency}):`);
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const next = [
      ...parsePayments(invoice.payments),
      { amount, date: new Date().toISOString().slice(0, 10), method: draft?.paymentMethod || 'Bank transfer', note: '' },
    ];
    const nextStatus: InvoiceStatus = paid + amount >= totals.grand - 0.01 ? 'paid' : 'partially-paid';
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payments: next, status: nextStatus }),
    });
    const data = await res.json();
    if (res.ok && data.invoice) {
      setInvoice(data.invoice);
      setDraft((prev) => (prev ? { ...prev, status: nextStatus } : prev));
      setBaseline((prev) => {
        try {
          const parsed = JSON.parse(prev) as InvoiceDraft;
          return JSON.stringify({ ...parsed, status: nextStatus });
        } catch {
          return prev;
        }
      });
    }
  };

  if (loading) {
    return (
      <Shell>
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading invoice…</div>
      </Shell>
    );
  }

  if (notFound || !invoice || !draft || !totals) {
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
            <ChevronDown />
          </span>
          {dirty && <span className="draft-saved" style={{ marginLeft: 0 }}>Unsaved changes</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="click-stat-large">
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
              navigator.clipboard.writeText(`${window.location.origin}/invoices/${invoice.id}`);
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
              <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', right: 0 }}>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); logPayment(); }}>
                  <Plus />
                  <span>Log payment</span>
                </div>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); window.print(); }}>
                  <Copy />
                  <span>Print / PDF</span>
                </div>
                <div className="dropdown-sep" />
                <div
                  className="dropdown-item destructive"
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!confirm(`Delete ${draft.number}?`)) return;
                    await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' });
                    router.push('/invoices');
                  }}
                >
                  <Trash />
                  <span>Delete invoice</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="edit-invoice-layout">
        <InvoiceCanvas
          draft={draft}
          onChange={patch}
          payments={payments}
          onLogPayment={(mode) => {
            setLogMode(mode ?? 'full');
            setLogOpen(true);
          }}
          accounts={canvasAccounts}
          tagline={canvasTagline}
          defaultTerms={settings?.inv_terms_note}
          payTo={{
            name: settings?.inv_legal_name ?? '',
            addr1: settings?.inv_address_1 ?? '',
            addr2: settings?.inv_address_2 ?? '',
            email: settings?.inv_contact_email ?? '',
            taxId: settings?.inv_tax_id ?? '—',
          }}
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
              <div className="rail-client-line">{draft.clientContact || 'Contact person'}</div>
              <div className="rail-client-line">{draft.clientAddr1 || 'Street address'}</div>
              <div className="rail-client-line">{draft.clientAddr2 || 'City, State, Postal code'}</div>
              <div className="rail-client-line">{draft.clientCountry || 'Country'}</div>
              <div className="rail-client-line">{draft.clientEmail || 'client@company.com'}</div>
            </div>

            <div className="rail-section">
              <div className="rail-section-label">Payment breakdown</div>
              <div className="rail-kv"><span>Subtotal</span><span>{fmtMoney(totals.subtotal, draft.currency)}</span></div>
              <div className="rail-kv">
                <span>Discount{draft.discountType === 'percent' ? ` (${draft.discount}%)` : ''}</span>
                <span>{fmtMoney(totals.discount, draft.currency)}</span>
              </div>
              <div className="rail-kv"><span>Tax ({(draft.taxRate * 100).toFixed(1)}%)</span><span>{fmtMoney(totals.tax, draft.currency)}</span></div>
              <div className="rail-kv"><span>Additional charges</span><span>{fmtMoney(totals.charges, draft.currency)}</span></div>
              <div className="rail-kv rail-kv-total"><span>Invoice total</span><span>{fmtMoney(totals.grand, draft.currency)}</span></div>
              {(Number(draft.equivalentAmount) > 0 || draft.exchangeRate > 0) && (
                <div className="rail-kv" style={{ paddingTop: 0 }}>
                  <span>Equivalent ({draft.currency === 'NGN' ? 'USD' : 'NGN'})</span>
                  <span style={{ color: 'var(--muted-foreground)' }}>
                    {draft.currency === 'NGN' ? '$' : '₦'}
                    {(
                      Number(draft.equivalentAmount) > 0
                        ? Number(draft.equivalentAmount)
                        : draft.exchangeRate > 0
                          ? totals.grand / draft.exchangeRate
                          : 0
                    ).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              {draft.exchangeRate > 0 && (
                <div className="rail-kv" style={{ paddingTop: 0 }}>
                  <span style={{ color: 'var(--muted-foreground)' }}>Exchange rate</span>
                  <span style={{ color: 'var(--muted-foreground)' }}>₦{draft.exchangeRate.toLocaleString('en-US')} = $1</span>
                </div>
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
            </div>

            <div className="rail-section rail-actions">
              {(draft.status === 'sent' ||
                draft.status === 'overdue' ||
                draft.status === 'partially-paid' ||
                draft.status === 'paid') && (
                <button
                  className="btn btn-primary rail-btn"
                  disabled={draft.status === 'paid' && paid > 0}
                  title={
                    draft.status === 'paid'
                      ? 'This invoice is fully paid — no further payment can be logged'
                      : 'Log a payment'
                  }
                  style={
                    draft.status === 'paid' && paid > 0
                      ? { filter: 'blur(0.6px)', opacity: 0.45, cursor: 'not-allowed' }
                      : undefined
                  }
                  onClick={() => {
                    if (draft.status === 'paid' && paid > 0) return;
                    setLogMode('full');
                    setLogOpen(true);
                  }}
                >
                  <Plus />
                  <span>Log Payment</span>
                </button>
              )}
              {payments.length > 0 && (
                <button
                  className="btn btn-outline rail-btn"
                  onClick={() => navigator.clipboard.writeText(`${draft.number} · ${draft.clientName} · ${fmtMoney(totals.grand, draft.currency)}`)}
                >
                  <Copy />
                  <span>View Receipt</span>
                </button>
              )}
            </div>

            {payments.length > 0 && (
              <div className="rail-section">
                <div className="rail-section-label">Payments ({payments.length})</div>
                {payments.map((payment, index) => (
                  <div className="rail-payment" key={index}>
                    <span className="rail-payment-idx">{index + 1}</span>
                    <div>
                      <div className="rail-payment-amt">{fmtMoney(payment.amount, draft.currency)}</div>
                      <div className="rail-payment-sub">
                        {payment.date}
                        {payment.method ? ` · ${payment.method}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {logOpen && totals && (
        <LogPaymentModal
          initialFullyPaid={logMode === 'full'}
          currency={draft.currency}
          outstanding={balance}
          methods={methodNames}
          onClose={() => setLogOpen(false)}
          onSubmit={async (payment: PaymentDraft) => {
            const next = [
              ...parsePayments(invoice.payments),
              { amount: payment.amount, date: payment.date, method: payment.method, note: payment.note },
            ];
            const paidTotal = paid + payment.amount;
            const nextStatus: InvoiceStatus = paidTotal >= totals.grand - 0.01 ? 'paid' : 'partially-paid';
            const res = await fetch(`/api/invoices/${invoice.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ payments: next, status: nextStatus }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to log payment');
            setInvoice(data.invoice);
            setDraft((prev) => (prev ? { ...prev, status: nextStatus } : prev));
            setBaseline((prev) => {
              try {
                const parsed = JSON.parse(prev) as InvoiceDraft;
                return JSON.stringify({ ...parsed, status: nextStatus });
              } catch {
                return prev;
              }
            });
            setLogOpen(false);
          }}
        />
      )}

      {sendOpen && (
        <SendModal
          clientEmail={draft.clientEmail}
          receiptMode={payments.length > 0}
          subject={
            payments.length > 0
              ? settings?.inv_email_receipt_subject ?? 'Receipt for your recent payment'
              : settings?.inv_email_invoice_subject ?? `Your invoice from ${settings?.inv_legal_name ?? 'us'}`
          }
          message={
            payments.length > 0
              ? settings?.inv_email_receipt_body ?? ''
              : settings?.inv_email_invoice_body ?? ''
          }
          onClose={() => setSendOpen(false)}
          onSubmit={async () => {
            const res = await fetch(`/api/invoices/${invoice.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: draft.status === 'draft' ? 'sent' : draft.status }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send');
            if (data.invoice) setInvoice(data.invoice);
            setDraft((prev) => (prev ? { ...prev, status: prev.status === 'draft' ? 'sent' : prev.status } : prev));
            setBaseline((prev) => {
              try {
                const parsed = JSON.parse(prev) as InvoiceDraft;
                return JSON.stringify({ ...parsed, status: parsed.status === 'draft' ? 'sent' : parsed.status });
              } catch {
                return prev;
              }
            });
            setSendOpen(false);
          }}
        />
      )}

      <div className={`save-bar ${dirty ? 'visible' : ''}`}>
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
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Shell>
  );
}
