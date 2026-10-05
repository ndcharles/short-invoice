'use client';

import React, { useState } from 'react';
import { ChevronDown, Download, Drag, Duplicate, Plus, Receipt, Refresh, Trash } from '@/components/icons';
import { usePopoverDismiss } from '@/lib/popover';
import {
  CURRENCY_SYMBOLS,
  fmtMoney,
  formatDay,
  InvoiceItem,
  InvoiceStatus,
  moneyInWords,
  parsePayments,
  STATUS_META,
} from '@/lib/invoices';

export interface InvoiceDraft {
  number: string;
  clientName: string;
  clientContact: string;
  clientAddr1: string;
  clientAddr2: string;
  clientCountry: string;
  clientEmail: string;
  issuedAt: number;
  dueAt: number;
  currency: string;
  status: InvoiceStatus;
  items: InvoiceItem[];
  charges: number;
  discount: number;
  discountType: 'value' | 'percent';
  taxRate: number;
  /** Manually entered foreign-currency equivalent, shown only when provided. */
  equivalentAmount: number;
  exchangeRate: number;
  terms: string;
  notes: string;
  paymentMethod: string;
}

export interface CanvasAccount {
  id: string;
  title: string;
  symbol: string;
  currency: string;
  bank: string;
  accountName: string;
  accountNumber: string;
  extraLabel: string;
  extraValue: string;
}

/** Strips currency symbols and separators so a formatted field can be edited. */
function parseMoneyInput(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

const BIG_LABEL: Record<InvoiceStatus, string> = {
  draft: 'DRAFT',
  sent: 'SENT',
  overdue: 'OVERDUE',
  'partially-paid': 'PARTIALLY PAID',
  paid: 'PAID',
  cancelled: 'CANCELLED',
};

const BIG_CLASS: Record<InvoiceStatus, string> = {
  draft: 'is-draft',
  sent: 'is-sent',
  overdue: 'is-overdue',
  'partially-paid': 'is-partial',
  paid: 'is-paid',
  cancelled: 'is-cancelled',
};

const MANUAL_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'overdue', 'cancelled'];

const PAYMENT_METHODS = [
  'Paystack (Debit/Credit Cards)',
  'Bank transfer',
  'Cash',
  'Card',
  'Wire transfer',
  'Cheque',
];

const toDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function InvoiceCanvas({
  draft,
  onChange,
  payTo,
  payments = [],
  accounts = [],
  tagline,
  defaultTerms = 'Net 30. Late payments accrue 1.5% interest per month.',
  variant = 'page',
  onLogPayment,
}: {
  draft: InvoiceDraft;
  onChange: (patch: Partial<InvoiceDraft>) => void;
  payTo: { name: string; addr1: string; addr2: string; email: string; taxId: string };
  payments?: ReturnType<typeof parsePayments>;
  accounts?: CanvasAccount[];
  tagline?: { on: boolean; text: string; color: string };
  defaultTerms?: string;
  variant?: 'page' | 'modal';
  onLogPayment?: (mode?: 'full' | 'partial') => void;
}) {
  const [itemsMode, setItemsMode] = useState<'simple' | 'detailed'>('simple');
  const [methodOpen, setMethodOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusPos, setStatusPos] = useState<{ top: number; left: number } | null>(null);
  const statusBtnRef = React.useRef<HTMLDivElement>(null);

  const toggleStatusMenu = () => {
    if (statusOpen) {
      setStatusOpen(false);
      return;
    }
    const rect = statusBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 240;
    const height = 320;
    const openUp = rect.top >= height + 16;
    const rawTop = openUp ? rect.top - height - 8 : rect.bottom + 8;
    // Always keep the panel inside the viewport, even when the trigger sits at
    // the end of a tall scrollable canvas (e.g. the create modal).
    const top = Math.min(Math.max(8, rawTop), Math.max(8, window.innerHeight - height - 8));
    setStatusPos({ top, left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)) });
    setStatusOpen(true);
  };
  const [receiptView, setReceiptView] = useState(false);
  usePopoverDismiss(methodOpen, React.useCallback(() => setMethodOpen(false), []));
  usePopoverDismiss(statusOpen, React.useCallback(() => setStatusOpen(false), []));

  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const lastPaymentDate = payments.length ? payments[payments.length - 1].date : '';
  const receiptMode = receiptView || payments.length > 0;
  const c = draft.currency;
  const status = draft.status;

  const itemsSubtotal = draft.items.reduce((sum, i) => sum + Number(i.qty) * Number(i.unitPrice), 0);
  const discountAmount =
    draft.discountType === 'percent' ? (itemsSubtotal * Number(draft.discount || 0)) / 100 : Number(draft.discount || 0);
  const discounted = Math.max(0, itemsSubtotal - discountAmount);
  const charges = Number(draft.charges || 0);
  const taxAmount = (discounted + charges) * Number(draft.taxRate || 0);
  const grand = discounted + charges + taxAmount;
  // A payment can exceed the current total if items/discount changed after it
  // was logged, so the applied amount is capped and the excess shown as credit.
  const appliedPaid = Math.min(paid, grand);
  const overpaid = Math.max(0, paid - grand);

  const totals = {
    subtotal: itemsSubtotal,
    charges,
    discountAmount,
    tax: taxAmount,
    grand,
    paid,
    appliedPaid,
    overpaid,
    balance: Math.max(0, grand - appliedPaid),
  };

  // Equivalent: the manually entered figure wins, otherwise it is derived from
  // the exchange rate (invoice total ÷ rate) so the row is never just the rate.
  const targetCode = c === 'NGN' ? 'USD' : 'NGN';
  const targetSymbol = c === 'NGN' ? '$' : '₦';
  const autoEquivalent = draft.exchangeRate > 0 ? grand / draft.exchangeRate : 0;
  const equivalentValue = Number(draft.equivalentAmount) > 0 ? Number(draft.equivalentAmount) : autoEquivalent;
  const rateLine = draft.exchangeRate > 0 ? `₦${draft.exchangeRate.toLocaleString('en-US')} = $1` : '';
  const stamp =
    status === 'paid'
      ? { cls: 'stamp-paid', label: 'PAID IN FULL' }
      : status === 'partially-paid'
        ? { cls: 'stamp-partial', label: 'PARTIALLY PAID' }
        : null;

  const updateItem = (index: number, patch: Partial<InvoiceItem>) =>
    onChange({ items: draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });

  const addItem = () => onChange({ items: [...draft.items, { name: '', desc: '', qty: 1, unitPrice: 0 }] });

  const duplicateItem = (index: number) =>
    onChange({
      items: [...draft.items.slice(0, index + 1), { ...draft.items[index] }, ...draft.items.slice(index + 1)],
    });

  const removeItem = (index: number) => onChange({ items: draft.items.filter((_, i) => i !== index) });

  return (
    <div className="invoice-canvas">
      {/* Header: logo + document number | status label + due date + Pay Now */}
      <div className="inv-top">
        <div className="inv-logo-block">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="inv-logo-slot" title="Logo upload is not available in this build">
              Upload logo
            </div>
          </div>
          <div className="inv-number">
            {receiptMode ? 'Receipt' : 'Invoice'} #{draft.number.replace(/^[A-Za-z0-9]+-/, '')}
          </div>
        </div>
        <div className={`inv-status-big ${BIG_CLASS[status]}`}>
          <div className="inv-status-label">{BIG_LABEL[status]}</div>
          <div className="inv-due-line">
            Due Date: <strong style={{ color: 'var(--foreground)' }}>{formatDay(draft.dueAt)}</strong>
          </div>
          <input
            className="inv-party-input"
            type="date"
            style={{ maxWidth: 190, textAlign: 'right' }}
            value={toDateInput(draft.dueAt)}
            disabled={status === 'paid'}
            title={status === 'paid' ? 'A paid invoice keeps its original due date' : 'Due date'}
            onChange={(e) => onChange({ dueAt: e.target.value ? Date.parse(e.target.value) : draft.dueAt })}
          />
          {status !== 'paid' && status !== 'cancelled' && <button className="inv-pay-now">Pay Now</button>}
        </div>
      </div>

      {/* Invoiced To / Pay To */}
      <div className="inv-parties">
        <div className="inv-party">
          <div className="inv-party-title">Invoiced To</div>
          <input
            className="inv-party-input inv-party-strong"
            value={draft.clientName}
            placeholder="Client name"
            onChange={(e) => onChange({ clientName: e.target.value })}
          />
          <input
            className="inv-party-input"
            value={draft.clientContact}
            placeholder="Contact person"
            onChange={(e) => onChange({ clientContact: e.target.value })}
          />
          <input
            className="inv-party-input"
            value={draft.clientAddr1}
            placeholder="Street address"
            onChange={(e) => onChange({ clientAddr1: e.target.value })}
          />
          <input
            className="inv-party-input"
            value={draft.clientAddr2}
            placeholder="City, State, Postal code"
            onChange={(e) => onChange({ clientAddr2: e.target.value })}
          />
          <input
            className="inv-party-input"
            value={draft.clientCountry}
            placeholder="Country"
            onChange={(e) => onChange({ clientCountry: e.target.value })}
          />
          <input
            className="inv-party-input"
            type="email"
            value={draft.clientEmail}
            placeholder="client@company.com"
            onChange={(e) => onChange({ clientEmail: e.target.value })}
          />
        </div>
        <div className="inv-party inv-right">
          <div className="inv-party-title">Pay To</div>
          <input className="inv-party-input inv-party-strong" value={payTo.name} readOnly />
          <input className="inv-party-input" value={payTo.addr1} readOnly />
          <input className="inv-party-input" value={payTo.addr2} readOnly />
          <input className="inv-party-input" type="email" value={payTo.email} readOnly />
          <input className="inv-party-input" value={`TIN: ${payTo.taxId}`} readOnly />
        </div>
      </div>

      {/* Invoice date & payment method */}
      <div className="inv-meta-row">
        <div className="inv-meta-left">
          <div className="inv-meta-title">Invoice Date</div>
          <input
            className="inv-party-input"
            type="date"
            value={toDateInput(draft.issuedAt)}
            onChange={(e) => onChange({ issuedAt: e.target.value ? Date.parse(e.target.value) : draft.issuedAt })}
          />
          {rateLine && (
            <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '6px' }}>
              Exchange rate: {rateLine}
            </div>
          )}
        </div>
        <div className="inv-meta-right-col">
          <div className="inv-meta-title">Payment Method</div>
          <div style={{ position: 'relative' }} data-popover-root>
            <button className="pay-method-select" onClick={() => setMethodOpen(!methodOpen)}>
              <span>{draft.paymentMethod}</span>
              <span className="chev">
                <ChevronDown />
              </span>
            </button>
            {methodOpen && (
              <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', right: 0, minWidth: '240px' }}>
                {PAYMENT_METHODS.map((method) => (
                  <div
                    key={method}
                    className={`dropdown-item${method === draft.paymentMethod ? ' is-current' : ''}`}
                    onClick={() => {
                      onChange({ paymentMethod: method });
                      setMethodOpen(false);
                    }}
                  >
                    <span>{method}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Items */}
      <div className={`inv-items items-${itemsMode}`}>
        <div className={`inv-items-head items-${itemsMode}`}>
          <div>#</div>
          <div>Item Description</div>
          {itemsMode === 'detailed' && <div className="num-center">Qty</div>}
          {itemsMode === 'detailed' && <div className="num-right">Unit Price</div>}
          <div className="num-right">Amount</div>
          <div />
        </div>

        {draft.items.map((item, index) => {
          const line = Number(item.qty) * Number(item.unitPrice);
          return (
            <div className={`inv-item-row items-${itemsMode}`} key={index}>
              <div className="inv-item-lead">
                <span className="inv-item-idx">{index + 1}</span>
                <span className="inv-item-handle" title="Drag to reorder">
                  <Drag />
                </span>
              </div>
              <div className="inv-item-text">
                <textarea
                  className="inv-item-name"
                  rows={1}
                  placeholder="Item name"
                  value={item.name}
                  onChange={(e) => updateItem(index, { name: e.target.value })}
                />
                <textarea
                  className="inv-item-desc"
                  rows={1}
                  placeholder="Item description (optional)"
                  value={item.desc}
                  onChange={(e) => updateItem(index, { desc: e.target.value })}
                />
              </div>
              {itemsMode === 'detailed' && (
                <div className="inv-item-col num-center">
                  <input
                    className="inv-item-input"
                    style={{ textAlign: 'center' }}
                    type="number"
                    min="0"
                    value={item.qty}
                    onChange={(e) => updateItem(index, { qty: Number(e.target.value) })}
                  />
                </div>
              )}
              {itemsMode === 'detailed' && (
                <div className="inv-item-col num-right">
                  <input
                    className="inv-item-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(index, { unitPrice: Number(e.target.value) })}
                  />
                </div>
              )}
              <div className="inv-item-col num-right">
                {itemsMode === 'simple' ? (
                  <input
                    className="inv-item-input"
                    inputMode="decimal"
                    value={fmtMoney(item.unitPrice, c)}
                    onChange={(e) => updateItem(index, { unitPrice: parseMoneyInput(e.target.value) })}
                  />
                ) : (
                  <strong>{fmtMoney(line, c)}</strong>
                )}
              </div>
              <div className="inv-item-actions inv-item-actions-stack">
                <button className="icon-btn item-delete" title="Delete" onClick={() => removeItem(index)}>
                  <Trash />
                </button>
                <button className="icon-btn" title="Duplicate" onClick={() => duplicateItem(index)}>
                  <Duplicate />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="inv-items-footer">
        <button className="inv-add-item" onClick={addItem}>
          <Plus />
          <span>Add Item</span>
        </button>
        <div className="inv-mode-toggle" role="tablist" aria-label="Items table mode">
          <button
            className={`mode-tab${itemsMode === 'simple' ? ' active' : ''}`}
            onClick={() => setItemsMode('simple')}
          >
            Simple
          </button>
          <button
            className={`mode-tab${itemsMode === 'detailed' ? ' active' : ''}`}
            onClick={() => setItemsMode('detailed')}
          >
            Detailed
          </button>
        </div>
      </div>

      {/* Totals + Payment Terms, with the stamp and payment history beneath the terms */}
      <div className="inv-totals-wrap">
        <div className="inv-terms-block">
          <div className="inv-meta-title">Payment Terms</div>
          <textarea
            className="inv-notes-input inv-terms-input"
            placeholder={defaultTerms}
            value={draft.terms}
            onChange={(e) => onChange({ terms: e.target.value })}
          />

          {stamp && (
            <div className="inv-stamp-wrap">
              <div className={`inv-stamp ${stamp.cls}`}>
                <div className="inv-stamp-text">{stamp.label}</div>
                <div className="inv-stamp-sub">{lastPaymentDate}</div>
              </div>
              {payments.length > 0 && (
                <div className="inv-payment-history">
                  <div className="inv-history-title">Payment history</div>
                  {payments.map((payment, index) => (
                    <div className="inv-history-row" key={index}>
                      <span className="inv-history-idx">{index + 1}</span>
                      <div className="inv-history-body">
                        <div className="inv-history-line1">
                          <strong>{fmtMoney(payment.amount, c)}</strong>
                          <span className="inv-history-method">{payment.method}</span>
                        </div>
                        <div className="inv-history-line2">
                          {payment.date}
                          {payment.note ? ` · ${payment.note}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="inv-totals">
            <div className="inv-totals-row add-charge" style={{ alignItems: 'center' }}>
              <span className="tot-label">+ Additional Charges</span>
              <span className="tot-value" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: '4px', flex: 1 }}>
                <span style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>{CURRENCY_SYMBOLS[c] ?? c}</span>
                <input
                  className="inv-discount-input"
                  style={{ textAlign: 'left', width: '100%' }}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={draft.charges || ''}
                  onChange={(e) => onChange({ charges: Number(e.target.value) })}
                />
              </span>
            </div>

            <div className="inv-totals-row">
              <span className="tot-label">Subtotal</span>
              <span className="tot-value">{fmtMoney(totals.subtotal, c)}</span>
            </div>

            <div className="inv-totals-row inv-discount-row">
              <span className="tot-label">+ Discount{draft.discountType === 'percent' ? ' (%)' : ''}</span>
              <span className="tot-value" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <input
                  className="inv-discount-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={draft.discount || ''}
                  onChange={(e) => onChange({ discount: Number(e.target.value) })}
                />
                <span className="inv-mode-toggle" style={{ padding: '1px' }}>
                  <button
                    className={`mode-tab${draft.discountType === 'value' ? ' active' : ''}`}
                    style={{ padding: '2px 8px' }}
                    onClick={() => onChange({ discountType: 'value' })}
                  >
                    {CURRENCY_SYMBOLS[c] ?? c}
                  </button>
                  <button
                    className={`mode-tab${draft.discountType === 'percent' ? ' active' : ''}`}
                    style={{ padding: '2px 8px' }}
                    onClick={() => onChange({ discountType: 'percent' })}
                  >
                    %
                  </button>
                </span>
                {draft.discountType === 'percent' && (
                  <span style={{ minWidth: '86px', textAlign: 'right', color: 'var(--muted-foreground)', fontSize: '12px' }}>
                    {fmtMoney(totals.discountAmount, c)}
                  </span>
                )}
              </span>
            </div>

            <div className="inv-totals-row">
              <span className="tot-label">Tax ({(draft.taxRate * 100).toFixed(1)}%)</span>
              <span className="tot-value">{fmtMoney(totals.tax, c)}</span>
            </div>

            <div className="inv-totals-row grand">
              <span className="tot-label">{receiptMode ? 'Invoice Total' : 'Amount Due'}</span>
              <span className="tot-value">{fmtMoney(totals.grand, c)}</span>
            </div>

            {paid > 0 && (
              <>
                <div className="inv-totals-row tot-paid">
                  <span className="tot-label">Amount Paid</span>
                  <span className="tot-value">− {fmtMoney(appliedPaid, c)}</span>
                </div>
                {overpaid > 0 && (
                  <div className="inv-totals-row inv-overpaid">
                    <span className="tot-label">Overpaid (credit)</span>
                    <span className="tot-value">{fmtMoney(overpaid, c)}</span>
                  </div>
                )}
                <div className={`inv-totals-row grand ${totals.balance <= 0 ? 'tot-cleared' : 'tot-outstanding'}`}>
                  <span className="tot-label">{totals.balance <= 0 ? 'Balance' : 'Balance Due'}</span>
                  <span className="tot-value">{fmtMoney(totals.balance, c)}</span>
                </div>
              </>
            )}

            <div className="inv-totals-row inv-equivalent">
              <span className="tot-label">Equivalent ({targetCode})</span>
              <span className="tot-value" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '13px', color: 'var(--foreground)' }}>
                  {targetSymbol}
                  {equivalentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <input
                  className="inv-discount-input"
                  style={{ textAlign: 'left', width: '90px' }}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="override"
                  title="Type a figure to override the converted amount"
                  value={draft.equivalentAmount || ''}
                  onChange={(e) => onChange({ equivalentAmount: Number(e.target.value) })}
                />
              </span>
            </div>

            <div className="inv-totals-row" style={{ paddingTop: 0, borderTop: 'none' }}>
              <span className="tot-label" style={{ fontWeight: 400, color: 'var(--muted-foreground)' }}>
                Exchange rate
              </span>
              <span className="tot-value" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>₦</span>
                <input
                  className="inv-discount-input"
                  style={{ textAlign: 'left', width: '72px' }}
                  type="number"
                  min="0"
                  step="1"
                  placeholder="1500"
                  value={draft.exchangeRate || ''}
                  onChange={(e) => onChange({ exchangeRate: Number(e.target.value) })}
                />
                <span style={{ color: 'var(--muted-foreground)', fontSize: '12px' }}>= $1</span>
              </span>
            </div>
          </div>

          <div className="inv-total-words">
            <span className="inv-total-words-label">In words:</span>
            <span className="inv-total-words-value">{moneyInWords(totals.grand, c)}</span>
          </div>
        </div>
      </div>

      <hr className="inv-hr" />

      {/* Payment Information — accounts come from Settings → Invoice */}
      <div className="inv-meta-title" style={{ marginBottom: '12px' }}>Payment Information</div>
      <div className="inv-payment-grid">
        {accounts.map((account) => (
          <div className="inv-account-card" key={account.id}>
            <div className="inv-account-head">
              <span className="inv-account-flag">{account.symbol || account.currency}</span>
              <span className="inv-account-name">{account.title || `${account.currency} account`}</span>
            </div>
            <div className="inv-account-grid">
              <div>
                <label>Bank Name</label>
                <input className="inv-party-input" defaultValue={account.bank} readOnly />
              </div>
              <div>
                <label>Account name</label>
                <input className="inv-party-input" defaultValue={account.accountName} readOnly />
              </div>
              <div>
                <label>Account Number</label>
                <input className="inv-party-input" defaultValue={account.accountNumber} readOnly />
              </div>
              <div>
                <label>{account.extraLabel || 'Routing / SWIFT'}</label>
                <input className="inv-party-input" defaultValue={account.extraValue} readOnly />
              </div>
            </div>
          </div>
        ))}
      </div>

      {tagline?.on && (
        <div className="inv-tagline-strip" style={{ background: tagline.color }}>
          {tagline.text}
        </div>
      )}

      {/* Footer: brand + currency + status + Log Payment + Reset/Receipt + Download PDF */}
      <div
        className="inv-footer-bar"
        style={variant === 'modal' ? { position: 'static', boxShadow: 'none' } : undefined}
      >
        <div className="inv-brand-mini">
          <span className="inv-brand-mini-dot">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v6M4.93 4.93l4.24 4.24M2 12h6M4.93 19.07l4.24-4.24" />
            </svg>
          </span>
          <strong>4th.link</strong>
          <span>Invoices</span>
        </div>

        <label className="currency-select" title="Change currency">
          <span className="currency-symbol">{CURRENCY_SYMBOLS[c] ?? c}</span>
          <select
            value={c}
            onChange={(e) => onChange({ currency: e.target.value })}
            style={{ border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: '12px', fontWeight: 500, outline: 'none', appearance: 'none', cursor: 'pointer', minWidth: '52px' }}
          >
            {Object.keys(CURRENCY_SYMBOLS).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <ChevronDown />
        </label>

        <div className="currency-select status-switch" data-popover-root style={{ position: 'relative', zIndex: 6 }} ref={statusBtnRef}>
          <button
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
            onClick={toggleStatusMenu}
            aria-expanded={statusOpen}
          >
            <span className={`inv-status ${STATUS_META[status].cls}`}>
              <span className="inv-status-dot" />
              {STATUS_META[status].label}
            </span>
            <ChevronDown />
          </button>
          {statusOpen && statusPos && (
            <div
              className="dropdown"
              data-popover
              style={{ position: 'fixed', top: statusPos.top, left: statusPos.left, minWidth: '230px', padding: '8px', zIndex: 400 }}
            >
              <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted-foreground)', padding: '4px 6px 8px' }}>
                Change status
              </div>
              {MANUAL_STATUSES.map((id) => {
                const meta = STATUS_META[id];
                const current = id === status;
                return (
                  <div
                    key={id}
                    className={`dropdown-item${current ? ' is-current' : ''}`}
                    onClick={() => {
                      onChange({ status: id });
                      setStatusOpen(false);
                    }}
                  >
                    <span className={`inv-status ${meta.cls}`}>
                      <span className="inv-status-dot" />
                      {meta.label}
                    </span>
                    {current && <span className="kbd-hint">Current</span>}
                  </div>
                );
              })}
              <div className="dropdown-sep" />
              {(['partially-paid', 'paid'] as InvoiceStatus[]).map((id) => (
                <div
                  key={id}
                  className="dropdown-item"
                  onClick={() => {
                    setStatusOpen(false);
                    if (onLogPayment) onLogPayment(id === 'paid' ? 'full' : 'partial');
                  }}
                >
                  <span className={`inv-status ${STATUS_META[id].cls}`}>
                    <span className="inv-status-dot" />
                    {STATUS_META[id].label}
                  </span>
                  <span className="kbd-hint">{onLogPayment ? 'payment' : 'log payment'}</span>
                </div>
              ))}
              <div className="dropdown-sep" />
              <div style={{ padding: '2px 6px 4px', fontSize: '11px', color: 'var(--muted-foreground)', lineHeight: 1.45 }}>
                To mark as <strong>Paid</strong> or <strong>Partially paid</strong>, use <em>Log Payment</em>.
              </div>
            </div>
          )}
        </div>

        {status !== 'draft' && status !== 'cancelled' && (
          <button
            className="btn btn-outline btn-sm log-payment-btn"
            disabled={status === 'paid' && paid > 0}
            title={status === 'paid' && paid > 0 ? 'This invoice is fully paid — no further payment can be logged' : 'Log a payment'}
            style={status === 'paid' && paid > 0 ? { filter: 'blur(0.6px)', opacity: 0.45, cursor: 'not-allowed' } : undefined}
            onClick={() => {
              if (status === 'paid' && paid > 0) return;
              if (onLogPayment) onLogPayment();
              else onChange({ status: 'partially-paid' });
            }}
          >
            <Plus />
            <span>Log Payment</span>
          </button>
        )}

        <div className="inv-footer-spacer" />

        {payments.length > 0 && (
          <button className="btn btn-outline btn-sm" onClick={() => setReceiptView(!receiptView)}>
            <Receipt />
            <span>{receiptView ? 'View Invoice' : 'View Receipt'}</span>
          </button>
        )}
        {payments.length === 0 && (
        <button
          className="btn btn-outline btn-sm"
          title="Clear this draft invoice"
          onClick={() => {
            if (!confirm('Reset this invoice? Line items, charges, discount and notes will be cleared.')) return;
            onChange({
              items: [{ name: '', desc: '', qty: 1, unitPrice: 0 }],
              charges: 0,
              discount: 0,
              discountType: 'value',
              notes: '',
              terms: defaultTerms,
              status: 'draft',
            });
          }}
        >
          <Refresh />
          <span>Reset</span>
        </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <Download />
          <span>Download PDF</span>
        </button>
      </div>
    </div>
  );
}
