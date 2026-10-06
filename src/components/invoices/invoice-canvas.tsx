'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Download, Drag, Duplicate, Plus, Receipt, Refresh, Trash, XIcon } from '@/components/icons';
import { usePopoverDismiss } from '@/lib/popover';
import { fromDateInput, toDateInput } from '@/lib/dates';
import {
  BASE_CURRENCY,
  EQUIVALENT_CURRENCY,
  currencySymbol,
  draftTotals,
  equivalentCurrency,
  fmtMoney,
  formatDay,
  invoiceEquivalent,
  InvoiceItem,
  InvoicePayment,
  InvoiceStatus,
  lineTotal,
  MANUAL_STATUSES,
  moneyInWords,
  rateLine,
  round2,
  STATUS_META,
} from '@/lib/invoices';
import { MoneyInput } from './money-input';
import { ChoiceModal, useConfirm } from './choice-modal';

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
  /** Manual figure for the equivalent; 0 means "convert at the exchange rate". */
  equivalentAmount: number;
  /** Naira per one unit of the other currency. 0 hides the equivalent. */
  exchangeRate: number;
  terms: string;
  notes: string;
  paymentMethod: string;
  folder: string;
  tag: string | null;
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

const FALLBACK_CURRENCIES = ['NGN', 'USD', 'EUR', 'GBP'];

export const emptyItem = (): InvoiceItem => ({ name: '', desc: '', qty: 1, unitPrice: 0 });

/**
 * A date shown as formatted text that opens the date picker when clicked: the
 * invoice reads like a document, with no separate date fields.
 */
function InlineDate({
  label,
  value,
  min,
  dateFormat,
  disabled = false,
  disabledTitle,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  dateFormat?: string;
  disabled?: boolean;
  disabledTitle?: string;
  onChange: (ms: number) => void;
}) {
  return (
    <span className={`inv-date-field${disabled ? ' is-disabled' : ''}`} title={disabled ? disabledTitle : `Change the ${label.toLowerCase()}`}>
      <strong>{formatDay(value, dateFormat)}</strong>
      <input
        type="date"
        className="inv-print-hide"
        aria-label={label}
        value={toDateInput(value)}
        min={min !== undefined ? toDateInput(min) : undefined}
        disabled={disabled}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            /* older browsers open the picker on their own */
          }
        }}
        onChange={(e) => {
          const next = fromDateInput(e.target.value);
          if (next !== null) onChange(next);
        }}
      />
    </span>
  );
}

export function InvoiceCanvas({
  draft,
  onChange,
  payTo,
  payments = [],
  accounts = [],
  tagline,
  logo,
  dateFormat,
  currencies,
  defaultRate = 0,
  defaultTerms = 'Net 30. Late payments accrue 1.5% interest per month.',
  variant = 'page',
  onLogPayment,
  documentView,
  onDocumentViewChange,
}: {
  draft: InvoiceDraft;
  onChange: (patch: Partial<InvoiceDraft>) => void;
  payTo: { name: string; addr1: string; addr2: string; email: string; taxId: string };
  payments?: InvoicePayment[];
  accounts?: CanvasAccount[];
  tagline?: { on: boolean; text: string; color: string };
  /** Company logo from Settings → Invoice (data URL or https URL). */
  logo?: string;
  dateFormat?: string;
  /** Enabled currency codes from Settings → Invoice. */
  currencies?: string[];
  /** Naira per USD from Settings, used when an equivalent is first added. */
  defaultRate?: number;
  defaultTerms?: string;
  variant?: 'page' | 'modal';
  onLogPayment?: (mode?: 'full' | 'partial') => void;
  /** Which document a paid invoice shows; uncontrolled when omitted. */
  documentView?: 'invoice' | 'receipt';
  onDocumentViewChange?: (view: 'invoice' | 'receipt') => void;
}) {
  // Detailed (qty × price) is the starting mode whenever an item uses a quantity.
  const [itemsMode, setItemsMode] = useState<'simple' | 'detailed'>(() =>
    draft.items.some((item) => Number(item.qty) !== 1) ? 'detailed' : 'simple'
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusPos, setStatusPos] = useState<{ top: number; left: number } | null>(null);
  const [localView, setLocalView] = useState<'invoice' | 'receipt'>('receipt');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Keeps the equivalent rows open while a rate is still being typed in.
  const [equivalentOpen, setEquivalentOpen] = useState(false);
  const [ask, confirmModal] = useConfirm();
  // A currency switch waiting for "convert the prices or not?".
  const [pendingCurrency, setPendingCurrency] = useState<{
    next: string;
    rate: number;
    converted: Pick<InvoiceDraft, 'items' | 'charges' | 'discount'>;
    newTotal: number;
  } | null>(null);
  const statusBtnRef = React.useRef<HTMLDivElement>(null);

  const toggleStatusMenu = () => {
    if (statusOpen) {
      setStatusOpen(false);
      return;
    }
    const rect = statusBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 240;
    const height = 300;
    const openUp = rect.top >= height + 16;
    const rawTop = openUp ? rect.top - height - 8 : rect.bottom + 8;
    // Always keep the panel inside the viewport, even when the trigger sits at
    // the end of a tall scrollable canvas (e.g. the create modal).
    const top = Math.min(Math.max(8, rawTop), Math.max(8, window.innerHeight - height - 8));
    setStatusPos({ top, left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)) });
    setStatusOpen(true);
  };
  usePopoverDismiss(statusOpen, React.useCallback(() => setStatusOpen(false), []));

  const c = draft.currency;
  const symbol = currencySymbol(c);
  const status = draft.status;
  const paid = round2(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const lastPaymentDate = payments.length ? payments[payments.length - 1].date : '';
  // With payments logged the document reads as a receipt; "View Invoice" shows
  // the original invoice exactly as issued (no payments, stamp or balance).
  const view = documentView ?? localView;
  const setView = (next: 'invoice' | 'receipt') => (onDocumentViewChange ? onDocumentViewChange(next) : setLocalView(next));
  const receiptMode = payments.length > 0 && view === 'receipt';
  const originalView = payments.length > 0 && view === 'invoice';

  const totals = draftTotals(draft);
  // A payment can exceed the current total if items/discount changed after it
  // was logged, so the applied amount is capped and the excess shown as credit.
  const appliedPaid = Math.min(paid, totals.grand);
  const overpaid = round2(Math.max(0, paid - totals.grand));
  const balance = round2(Math.max(0, totals.grand - appliedPaid));

  const eqCode = equivalentCurrency(c);
  const converted = invoiceEquivalent({
    currency: c,
    grand: totals.grand,
    balance,
    exchangeRate: draft.exchangeRate,
    equivalentAmount: draft.equivalentAmount,
  });
  const equivalent =
    converted ??
    (equivalentOpen ? { code: eqCode, total: 0, balance: 0, rate: 0, rateLine: '', overridden: false } : null);
  const eqSymbol = currencySymbol(eqCode);
  const rateForeign = c === BASE_CURRENCY ? eqCode : c;

  const stamp =
    status === 'paid'
      ? { cls: 'stamp-paid', label: 'PAID IN FULL' }
      : status === 'partially-paid'
        ? { cls: 'stamp-partial', label: 'PARTIALLY PAID' }
        : null;

  const currencyOptions = Array.from(new Set([...(currencies?.length ? currencies : FALLBACK_CURRENCIES), c]));

  // Payment Information lists the accounts a client would pay into: the
  // invoice currency, plus the equivalent's currency when one is shown.
  const payable = new Set([c, ...(equivalent ? [equivalent.code] : [])]);
  const matching = accounts.filter((account) => payable.has(account.currency));
  const shownAccounts = matching.length ? matching : accounts;

  /**
   * Switching currency re-labels the invoice. Between NGN and USD it can also
   * convert every price at the exchange rate, so a naira draft becomes a
   * dollar invoice (or back). The equivalent line is removed either way: a
   * USD invoice for a foreign client shows no naira unless it is added again.
   */
  const changeCurrency = (next: string) => {
    if (next === c) return;
    const pair = [BASE_CURRENCY, EQUIVALENT_CURRENCY];
    const rate = draft.exchangeRate > 0 ? draft.exchangeRate : defaultRate;
    const hasAmounts = totals.subtotal > 0 || totals.charges > 0;
    setEquivalentOpen(false);
    if (pair.includes(c) && pair.includes(next) && rate > 0 && hasAmounts) {
      const toUsd = next === EQUIVALENT_CURRENCY;
      const convert = (n: number) => round2(toUsd ? Number(n) / rate : Number(n) * rate);
      const converted = {
        items: draft.items.map((item) => ({ ...item, unitPrice: convert(item.unitPrice) })),
        charges: convert(draft.charges),
        discount: draft.discountType === 'value' ? convert(draft.discount) : draft.discount,
      };
      setPendingCurrency({ next, rate, converted, newTotal: draftTotals({ ...draft, ...converted }).grand });
      return;
    }
    onChange({ currency: next, exchangeRate: 0, equivalentAmount: 0 });
  };

  const updateItem = (index: number, patch: Partial<InvoiceItem>) =>
    onChange({ items: draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });

  const addItem = () => onChange({ items: [...draft.items, emptyItem()] });

  const duplicateItem = (index: number) =>
    onChange({
      items: [...draft.items.slice(0, index + 1), { ...draft.items[index] }, ...draft.items.slice(index + 1)],
    });

  const removeItem = (index: number) => onChange({ items: draft.items.filter((_, i) => i !== index) });

  const moveItem = (from: number, to: number) => {
    if (from === to) return;
    const items = [...draft.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    onChange({ items });
  };

  return (
    <div className="invoice-canvas">
      {/* Header: logo + document number | status label + due date + invoice date */}
      <div className="inv-top">
        <div className="inv-logo-block">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="inv-logo-img" src={logo} alt={payTo.name || 'Company logo'} />
            ) : (
              <Link href="/settings/invoice" className="inv-logo-slot inv-print-hide" title="Add your logo in Settings → Invoice">
                Upload logo
              </Link>
            )}
          </div>
          <div className="inv-number">
            <span>{receiptMode ? 'Receipt' : 'Invoice'} #</span>
            <input
              className="inv-number-input"
              value={draft.number}
              size={Math.max(6, draft.number.length)}
              aria-label="Invoice number"
              onChange={(e) => onChange({ number: e.target.value })}
            />
          </div>
        </div>
        <div className={`inv-status-big ${originalView ? 'is-sent' : BIG_CLASS[status]}`}>
          <div className="inv-status-label">{originalView ? 'INVOICE' : BIG_LABEL[status]}</div>
          <div className="inv-due-line">
            Due Date:{' '}
            <InlineDate
              label="Due date"
              value={draft.dueAt}
              min={draft.issuedAt}
              dateFormat={dateFormat}
              disabled={status === 'paid'}
              disabledTitle="A paid invoice keeps its original due date"
              onChange={(dueAt) => onChange({ dueAt })}
            />
          </div>
          <div className="inv-due-line">
            Invoice Date:{' '}
            <InlineDate
              label="Invoice date"
              value={draft.issuedAt}
              dateFormat={dateFormat}
              onChange={(issuedAt) =>
                // Keep the payment window when the invoice date moves past the due date.
                onChange(issuedAt > draft.dueAt ? { issuedAt, dueAt: issuedAt + (draft.dueAt - draft.issuedAt) } : { issuedAt })
              }
            />
          </div>
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
            aria-label="Client name"
            onChange={(e) => onChange({ clientName: e.target.value })}
          />
          <input
            className={`inv-party-input${draft.clientContact ? '' : ' inv-print-hide'}`}
            value={draft.clientContact}
            placeholder="Contact person"
            onChange={(e) => onChange({ clientContact: e.target.value })}
          />
          <input
            className={`inv-party-input${draft.clientAddr1 ? '' : ' inv-print-hide'}`}
            value={draft.clientAddr1}
            placeholder="Street address"
            onChange={(e) => onChange({ clientAddr1: e.target.value })}
          />
          <input
            className={`inv-party-input${draft.clientAddr2 ? '' : ' inv-print-hide'}`}
            value={draft.clientAddr2}
            placeholder="City, State, Postal code"
            onChange={(e) => onChange({ clientAddr2: e.target.value })}
          />
          <input
            className={`inv-party-input${draft.clientCountry ? '' : ' inv-print-hide'}`}
            value={draft.clientCountry}
            placeholder="Country"
            onChange={(e) => onChange({ clientCountry: e.target.value })}
          />
          <input
            className={`inv-party-input${draft.clientEmail ? '' : ' inv-print-hide'}`}
            type="email"
            value={draft.clientEmail}
            placeholder="client@company.com"
            onChange={(e) => onChange({ clientEmail: e.target.value })}
          />
        </div>
        <div className="inv-party inv-right">
          <div className="inv-party-title">Pay To</div>
          <div className="inv-party-line inv-party-strong">{payTo.name}</div>
          {payTo.addr1 && <div className="inv-party-line">{payTo.addr1}</div>}
          {payTo.addr2 && <div className="inv-party-line">{payTo.addr2}</div>}
          {payTo.taxId && <div className="inv-party-line">TIN: {payTo.taxId}</div>}
          {payTo.email && <div className="inv-party-line">{payTo.email}</div>}
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
          const line = lineTotal(item);
          return (
            <div
              className={`inv-item-row items-${itemsMode}${dragIndex === index ? ' is-dragging' : ''}`}
              key={index}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) moveItem(dragIndex, index);
                setDragIndex(null);
              }}
            >
              <div className="inv-item-lead">
                <span className="inv-item-idx">{index + 1}</span>
                <span
                  className="inv-item-handle inv-print-hide"
                  title="Drag to reorder"
                  draggable={draft.items.length > 1}
                  onDragStart={(e) => {
                    setDragIndex(index);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(index));
                    const row = e.currentTarget.closest('.inv-item-row');
                    if (row) e.dataTransfer.setDragImage(row, 20, 20);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                >
                  <Drag />
                </span>
              </div>
              <div className="inv-item-text">
                <textarea
                  className="inv-item-name"
                  rows={1}
                  placeholder="Item name"
                  aria-label={`Item ${index + 1} name`}
                  value={item.name}
                  onChange={(e) => updateItem(index, { name: e.target.value })}
                />
                <textarea
                  className={`inv-item-desc${item.desc ? '' : ' inv-print-hide'}`}
                  rows={1}
                  placeholder="Item description (optional)"
                  value={item.desc}
                  onChange={(e) => updateItem(index, { desc: e.target.value })}
                />
              </div>
              {itemsMode === 'detailed' && (
                <div className="inv-item-col num-center">
                  <MoneyInput
                    className="inv-item-input"
                    style={{ textAlign: 'center' }}
                    aria-label={`Item ${index + 1} quantity`}
                    value={item.qty}
                    format={(n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    onChange={(qty) => updateItem(index, { qty })}
                  />
                </div>
              )}
              {itemsMode === 'detailed' && (
                <div className="inv-item-col num-right">
                  <MoneyInput
                    className="inv-item-input"
                    aria-label={`Item ${index + 1} unit price`}
                    value={item.unitPrice}
                    onChange={(unitPrice) => updateItem(index, { unitPrice })}
                  />
                </div>
              )}
              <div className="inv-item-col num-right">
                {itemsMode === 'simple' ? (
                  <MoneyInput
                    className="inv-item-input"
                    aria-label={`Item ${index + 1} amount`}
                    value={line}
                    format={(n) => fmtMoney(n, c)}
                    onChange={(amount) => {
                      const qty = Number(item.qty) > 0 ? Number(item.qty) : 1;
                      updateItem(index, { qty, unitPrice: qty === 1 ? amount : amount / qty });
                    }}
                  />
                ) : (
                  <strong>{fmtMoney(line, c)}</strong>
                )}
              </div>
              <div className="inv-item-actions inv-item-actions-stack inv-print-hide">
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
        {draft.items.length === 0 && (
          <div className="inv-item-row inv-items-empty inv-print-hide">Add at least one item to bill for.</div>
        )}
      </div>

      <div className="inv-items-footer inv-print-hide">
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

          <div className={`inv-meta-title inv-notes-title${draft.notes ? '' : ' inv-print-hide'}`}>Notes</div>
          <textarea
            className={`inv-notes-input${draft.notes ? '' : ' inv-print-hide'}`}
            placeholder="Thank-you note, project reference, PO number… (optional)"
            value={draft.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
          />

          {stamp && receiptMode && (
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
                          {payment.method && <span className="inv-history-method">{payment.method}</span>}
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
            <div className="inv-totals-row">
              <span className="tot-label">Subtotal</span>
              <span className="tot-value">{fmtMoney(totals.subtotal, c)}</span>
            </div>

            <div className={`inv-totals-row inv-discount-row${totals.discount ? '' : ' inv-print-hide'}`}>
              <span className="tot-label">
                Discount{draft.discountType === 'percent' && draft.discount ? ` (${draft.discount}%)` : ''}
              </span>
              <span className="tot-value tot-input">
                <span className="inv-print-only">− {fmtMoney(totals.discount, c)}</span>
                <span className="tot-input inv-print-hide">
                  {draft.discountType === 'percent' && totals.discount > 0 && (
                    <span className="tot-hint">− {fmtMoney(totals.discount, c)}</span>
                  )}
                  <MoneyInput
                    className="inv-discount-input"
                    placeholder="0.00"
                    blankZero
                    aria-label="Discount"
                    value={draft.discount}
                    onChange={(discount) => onChange({ discount })}
                  />
                  <span className="inv-mode-toggle" style={{ padding: '1px' }}>
                    <button
                      className={`mode-tab${draft.discountType === 'value' ? ' active' : ''}`}
                      style={{ padding: '2px 8px' }}
                      title="Fixed amount"
                      onClick={() => onChange({ discountType: 'value' })}
                    >
                      {symbol}
                    </button>
                    <button
                      className={`mode-tab${draft.discountType === 'percent' ? ' active' : ''}`}
                      style={{ padding: '2px 8px' }}
                      title="Percentage of the subtotal"
                      onClick={() => onChange({ discountType: 'percent' })}
                    >
                      %
                    </button>
                  </span>
                </span>
              </span>
            </div>

            <div className={`inv-totals-row inv-discount-row${totals.charges ? '' : ' inv-print-hide'}`}>
              <span className="tot-label">Additional Charges</span>
              <span className="tot-value tot-input">
                <span className="inv-print-only">{fmtMoney(totals.charges, c)}</span>
                <span className="tot-input inv-print-hide">
                  <span className="tot-sym">{symbol}</span>
                  <MoneyInput
                    className="inv-discount-input"
                    placeholder="0.00"
                    blankZero
                    aria-label="Additional charges"
                    title="Delivery, logistics or any other charge added to the subtotal"
                    value={draft.charges}
                    onChange={(charges) => onChange({ charges })}
                  />
                </span>
              </span>
            </div>

            <div className="inv-totals-row inv-discount-row">
              <span className="tot-label tot-input">
                <span>Tax</span>
                <span className="inv-print-only">({round2(draft.taxRate * 100)}%)</span>
                <span className="tot-input inv-print-hide">
                  <MoneyInput
                    className="inv-discount-input inv-rate-input"
                    aria-label="Tax rate in percent"
                    title="Tax rate for this invoice (set the default in Settings → Invoice)"
                    value={round2(draft.taxRate * 100)}
                    format={(n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    onChange={(percent) => onChange({ taxRate: Math.min(100, percent) / 100 })}
                  />
                  <span className="tot-sym">%</span>
                </span>
              </span>
              <span className="tot-value">{fmtMoney(totals.tax, c)}</span>
            </div>

            <div className="inv-totals-row grand">
              <span className="tot-label">{receiptMode ? 'Invoice Total' : 'Amount Due'}</span>
              <span className="tot-value">{fmtMoney(totals.grand, c)}</span>
            </div>

            {paid > 0 && receiptMode && (
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
                <div className={`inv-totals-row grand ${balance <= 0 ? 'tot-cleared' : 'tot-outstanding'}`}>
                  <span className="tot-label">{balance <= 0 ? 'Balance' : 'Balance Due'}</span>
                  <span className="tot-value">{fmtMoney(balance, c)}</span>
                </div>
              </>
            )}

            {equivalent ? (
              <>
                <div className={`inv-totals-row inv-equivalent${converted ? '' : ' inv-print-hide'}`}>
                  <span className="tot-label">Equivalent ({equivalent.code})</span>
                  <span className="tot-value tot-input">
                    <span className="inv-print-only">{fmtMoney(equivalent.total, equivalent.code)}</span>
                    <span className="tot-input inv-print-hide">
                      {equivalent.overridden && (
                        <button
                          className="tot-link"
                          title="Use the converted amount again"
                          onClick={() => onChange({ equivalentAmount: 0 })}
                        >
                          reset
                        </button>
                      )}
                      <span className="tot-sym">{eqSymbol}</span>
                      <MoneyInput
                        className="inv-discount-input inv-eq-input"
                        aria-label={`Equivalent in ${equivalent.code}`}
                        title="Converted at the exchange rate. Type a figure to use your own."
                        value={equivalent.total}
                        onChange={(amount) => onChange({ equivalentAmount: amount })}
                      />
                    </span>
                  </span>
                </div>
                {receiptMode && balance > 0 && (
                  <div className="inv-totals-row inv-equivalent">
                    <span className="tot-label">Balance Due ({equivalent.code})</span>
                    <span className="tot-value">{fmtMoney(equivalent.balance, equivalent.code)}</span>
                  </div>
                )}
                <div className={`inv-totals-row inv-rate-row${converted ? '' : ' inv-print-hide'}`}>
                  <span className="tot-label">Exchange rate</span>
                  <span className="tot-value tot-input">
                    <span className="inv-print-only">{equivalent.rateLine}</span>
                    <span className="tot-input inv-print-hide">
                      <span className="tot-sym">{currencySymbol(BASE_CURRENCY)}</span>
                      <MoneyInput
                        className="inv-discount-input inv-rate-input"
                        aria-label="Exchange rate"
                        value={draft.exchangeRate}
                        format={(n) => n.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                        onChange={(exchangeRate) => onChange({ exchangeRate })}
                      />
                      <span className="tot-sym">= {currencySymbol(rateForeign)}1</span>
                      <button
                        className="icon-btn tot-remove"
                        title={`Remove the ${equivalent.code} equivalent`}
                        aria-label={`Remove the ${equivalent.code} equivalent`}
                        onClick={() => {
                          setEquivalentOpen(false);
                          onChange({ exchangeRate: 0, equivalentAmount: 0 });
                        }}
                      >
                        <XIcon />
                      </button>
                    </span>
                  </span>
                </div>
              </>
            ) : (
              <button
                className="inv-totals-row add-charge inv-add-equivalent inv-print-hide"
                title={`Show what this invoice costs in ${eqCode}, for clients paying from abroad`}
                onClick={() => {
                  setEquivalentOpen(true);
                  onChange({ exchangeRate: c === BASE_CURRENCY || c === 'USD' ? defaultRate || 0 : 0, equivalentAmount: 0 });
                }}
              >
                <span className="tot-label">+ Add {eqCode} equivalent</span>
                <span className="tot-value">
                  {defaultRate > 0 && (c === BASE_CURRENCY || c === 'USD') ? `₦${defaultRate.toLocaleString('en-US')} = $1` : ''}
                </span>
              </button>
            )}
          </div>

          <div className="inv-total-words">
            <span className="inv-total-words-label">In words:</span>
            <span className="inv-total-words-value">{moneyInWords(totals.grand, c)}</span>
          </div>
        </div>
      </div>

      <hr className="inv-hr" />

      {/* Payment Information — accounts come from Settings → Invoice */}
      <div>
        <div className="inv-meta-title" style={{ marginBottom: '12px' }}>Payment Information</div>
        {shownAccounts.length === 0 ? (
          <div className="inv-notes inv-print-hide" style={{ marginBottom: '16px' }}>
            No payment accounts yet. <Link href="/settings/invoice">Add your bank details in Settings → Invoice</Link>.
          </div>
        ) : (
          <div className="inv-payment-grid">
            {shownAccounts.map((account) => (
              <div className="inv-account-card" key={account.id}>
                <div className="inv-account-head">
                  <span className="inv-account-flag">{account.symbol || account.currency}</span>
                  <span className="inv-account-name">{account.title || `${account.currency} account`}</span>
                </div>
                <div className="inv-account-grid">
                  <div>
                    <label>Bank Name</label>
                    <input className="inv-party-input" value={account.bank} readOnly />
                  </div>
                  <div>
                    <label>Account name</label>
                    <input className="inv-party-input" value={account.accountName} readOnly />
                  </div>
                  <div>
                    <label>Account Number</label>
                    <input className="inv-party-input" value={account.accountNumber} readOnly />
                  </div>
                  <div>
                    <label>{account.extraLabel || 'Routing / SWIFT'}</label>
                    <input className="inv-party-input" value={account.extraValue} readOnly />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {tagline?.on && tagline.text && (
        <div className="inv-tagline-strip" style={{ background: tagline.color }}>
          {tagline.text}
        </div>
      )}

      {/* Footer: brand + currency + status + Log Payment + Reset/Receipt + Download PDF */}
      <div
        className="inv-footer-bar inv-print-hide"
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

        <label className="currency-select currency-picker" title="Invoice currency">
          <span className="currency-symbol">{symbol.trim()}</span>
          <span>{c}</span>
          <ChevronDown />
          {/* The native select covers the whole pill, so any click opens it. */}
          <select value={c} aria-label="Invoice currency" onChange={(e) => changeCurrency(e.target.value)}>
            {currencyOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
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
                const current = id === status || (id === 'sent' && status === 'overdue');
                return (
                  <div
                    key={id}
                    className={`dropdown-item${current ? ' is-current' : ''}`}
                    onClick={() => {
                      if (!current) onChange({ status: id });
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
              {onLogPayment && status !== 'cancelled' && (
                <>
                  <div className="dropdown-sep" />
                  {(['partially-paid', 'paid'] as InvoiceStatus[]).map((id) => (
                    <div
                      key={id}
                      className="dropdown-item"
                      onClick={() => {
                        setStatusOpen(false);
                        onLogPayment(id === 'paid' ? 'full' : 'partial');
                      }}
                    >
                      <span className={`inv-status ${STATUS_META[id].cls}`}>
                        <span className="inv-status-dot" />
                        {STATUS_META[id].label}
                      </span>
                      <span className="kbd-hint">log payment</span>
                    </div>
                  ))}
                </>
              )}
              <div className="dropdown-sep" />
              <div style={{ padding: '2px 6px 4px', fontSize: '11px', color: 'var(--muted-foreground)', lineHeight: 1.45 }}>
                <strong>Overdue</strong> is set automatically after the due date. <strong>Paid</strong> and{' '}
                <strong>Partially paid</strong> follow the payments you log.
              </div>
            </div>
          )}
        </div>

        {onLogPayment && status !== 'draft' && status !== 'cancelled' && (
          <button
            className="btn btn-outline btn-sm log-payment-btn"
            disabled={status === 'paid'}
            title={status === 'paid' ? 'This invoice is fully paid' : 'Log a payment'}
            onClick={() => onLogPayment()}
          >
            <Plus />
            <span>Log Payment</span>
          </button>
        )}

        <div className="inv-footer-spacer" />

        {payments.length > 0 && (
          <button
            className="btn btn-outline btn-sm"
            title={receiptMode ? 'Show the original invoice, as issued before any payment' : 'Show the receipt with payments'}
            onClick={() => setView(receiptMode ? 'invoice' : 'receipt')}
          >
            <Receipt />
            <span>{receiptMode ? 'View Invoice' : 'View Receipt'}</span>
          </button>
        )}
        {payments.length === 0 && (
          <button
            className="btn btn-outline btn-sm"
            title="Clear the items, charges, discount and notes"
            onClick={async () => {
              const ok = await ask({
                title: 'Reset this invoice?',
                message: 'Line items, charges, discount and notes will be cleared. Client details and dates stay.',
                confirmLabel: 'Reset',
                destructive: true,
              });
              if (!ok) return;
              onChange({
                items: [emptyItem()],
                charges: 0,
                discount: 0,
                discountType: 'value',
                notes: '',
                terms: defaultTerms,
              });
            }}
          >
            <Refresh />
            <span>Reset</span>
          </button>
        )}
        {variant === 'page' && (
          <button className="btn btn-primary btn-sm" onClick={() => window.print()} title="Opens the print dialog; choose “Save as PDF”">
            <Download />
            <span>Download PDF</span>
          </button>
        )}
      </div>
      {pendingCurrency && (
        <ChoiceModal
          title={`Switch to ${pendingCurrency.next}`}
          onClose={() => setPendingCurrency(null)}
          choices={[
            {
              label: 'Keep the numbers',
              onSelect: () => {
                onChange({ currency: pendingCurrency.next, exchangeRate: 0, equivalentAmount: 0 });
                setPendingCurrency(null);
              },
            },
            {
              label: `Convert to ${pendingCurrency.next}`,
              variant: 'primary',
              onSelect: () => {
                onChange({ currency: pendingCurrency.next, exchangeRate: 0, equivalentAmount: 0, ...pendingCurrency.converted });
                setPendingCurrency(null);
              },
            },
          ]}
        >
          <p>
            Convert every price at <strong>{rateLine(c === BASE_CURRENCY ? BASE_CURRENCY : c, pendingCurrency.rate)}</strong>?
          </p>
          <div className="choice-modal-compare">
            <span>{fmtMoney(totals.grand, c)}</span>
            <span aria-hidden="true">→</span>
            <strong>{fmtMoney(pendingCurrency.newTotal, pendingCurrency.next)}</strong>
          </div>
          <p className="choice-modal-hint">
            <strong>Keep the numbers</strong> only changes the currency label. Either way the equivalent line is
            removed, so the client sees one currency.
          </p>
        </ChoiceModal>
      )}
      {confirmModal}
    </div>
  );
}
