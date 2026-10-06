'use client';

import React, { useId, useState } from 'react';
import { Duplicate, Plus, Trash } from '@/components/icons';
import {
  computeTotals,
  CURRENCIES,
  CURRENCY_SYMBOLS,
  equivalentCurrency,
  fmtMoney,
  lineAmount,
  moneyInWords,
  STATUS_META,
  toEquivalent,
  type InvoiceItem,
  type InvoicePayment,
  type InvoiceStatus,
} from '@/lib/invoices';
import { formatDate, fromDateInput, toDateInput } from '@/lib/dates';
import { accountsFor, type DocumentAccount } from '@/lib/invoice-document';

/** Everything the editor changes. Status and payments have their own actions. */
export interface InvoiceDraft {
  number: string;
  client_name: string;
  client_contact: string;
  client_email: string;
  client_address: string;
  reference: string;
  issued_at: number;
  due_at: number;
  currency: string;
  items: InvoiceItem[];
  discount: number;
  discount_type: 'value' | 'percent';
  charges: number;
  /** Fraction, e.g. 0.075. */
  tax_rate: number;
  /** Naira per 1 unit of the foreign currency; 0 hides the equivalent. */
  exchange_rate: number;
  notes: string;
  terms: string;
  folder: string;
  tag: string | null;
}

export interface PastClient {
  client_name: string;
  client_contact: string;
  client_email: string;
  client_address: string;
  currency: string;
}

export interface PayToProfile {
  name: string;
  address1: string;
  address2: string;
  email: string;
  taxId: string;
  logo: string;
}

const TERM_PRESETS: { label: string; days: number }[] = [
  { label: 'Due on receipt', days: 0 },
  { label: 'Net 7', days: 7 },
  { label: 'Net 14', days: 14 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
  { label: 'Net 60', days: 60 },
];

const DAY = 86_400_000;

export const emptyItem = (): InvoiceItem => ({ name: '', desc: '', qty: 1, unitPrice: 0 });

/**
 * Number input that keeps an empty field empty instead of forcing 0, and
 * shows thousands separators (2,325,000) while not being edited.
 */
function NumberField({
  value,
  onChange,
  min = 0,
  max,
  className = 'ie-input ie-num',
  ariaLabel,
  placeholder = '0',
  disabled,
  decimals = 2,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  decimals?: number;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown =
    editing ??
    (Number.isFinite(value) && value !== 0 ? value.toLocaleString('en-US', { maximumFractionDigits: decimals }) : '');
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      value={shown}
      // Editing keeps the text exactly as typed (commas allowed), so focusing
      // never rewrites the field and a selection or caret is never lost.
      onFocus={() => setEditing(shown)}
      onBlur={() => setEditing(null)}
      onChange={(e) => {
        const typed = e.target.value.replace(/[^0-9.,]/g, '');
        setEditing(typed);
        const raw = typed.replace(/,/g, '');
        const next = raw === '' || raw === '.' ? 0 : Number(raw);
        if (!Number.isFinite(next)) return;
        onChange(Math.min(max ?? Infinity, Math.max(min, next)));
      }}
    />
  );
}

export function InvoiceEditor({
  draft,
  onChange,
  status,
  payments = [],
  payTo,
  accounts,
  clients = [],
  defaultRate,
  dateFormat,
  numberPlaceholder,
}: {
  draft: InvoiceDraft;
  onChange: (patch: Partial<InvoiceDraft>) => void;
  status: InvoiceStatus;
  payments?: InvoicePayment[];
  payTo: PayToProfile;
  accounts: DocumentAccount[];
  clients?: PastClient[];
  /** Settings → Invoice exchange rate, used when the equivalent is switched on. */
  defaultRate: number;
  dateFormat?: string;
  numberPlaceholder?: string;
}) {
  const listId = useId();
  const c = draft.currency;
  const totals = computeTotals(
    { items: draft.items, discount: draft.discount, discountType: draft.discount_type, charges: draft.charges, taxRate: draft.tax_rate },
    payments
  );
  const eqCode = equivalentCurrency(c);
  const showEq = draft.exchange_rate > 0;
  const eq = (amount: number) => (showEq ? fmtMoney(toEquivalent(amount, c, draft.exchange_rate) ?? 0, eqCode) : '');
  const foreign = c === 'NGN' ? 'USD' : c;
  const meta = STATUS_META[status];
  const termDays = Math.round((draft.due_at - draft.issued_at) / DAY);
  const shownAccounts = accountsFor(accounts, c, showEq ? eqCode : null);

  const updateItem = (index: number, patch: Partial<InvoiceItem>) =>
    onChange({ items: draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const moveItem = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.items.length) return;
    const items = [...draft.items];
    [items[index], items[target]] = [items[target], items[index]];
    onChange({ items });
  };

  const pickClient = (name: string) => {
    const match = clients.find((cl) => cl.client_name.toLowerCase() === name.trim().toLowerCase());
    if (!match) {
      onChange({ client_name: name });
      return;
    }
    // Fill only what is still empty, so a typed address is never overwritten.
    onChange({
      client_name: match.client_name,
      client_contact: draft.client_contact || match.client_contact,
      client_email: draft.client_email || match.client_email,
      client_address: draft.client_address || match.client_address,
    });
  };

  return (
    <div className="invoice-canvas ie">
      {/* Header: who is billing | document, number and status */}
      <div className="ie-head">
        <div className="ie-brand">
          {payTo.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={payTo.logo} alt="" className="ie-logo" />
          ) : null}
          <div className="ie-brand-name">{payTo.name || 'Your company'}</div>
          <div className="ie-muted">{[payTo.address1, payTo.address2].filter(Boolean).join(', ')}</div>
          <div className="ie-muted">{[payTo.email, payTo.taxId ? `TIN: ${payTo.taxId}` : ''].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="ie-doc">
          <div className="ie-doc-title">Invoice</div>
          <label className="ie-number">
            <span>#</span>
            <input
              className="ie-input"
              aria-label="Invoice number"
              value={draft.number}
              placeholder={numberPlaceholder ?? 'Assigned on save'}
              maxLength={40}
              onChange={(e) => onChange({ number: e.target.value })}
            />
          </label>
          <span className={`inv-status ${meta.cls}`}>
            <span className="inv-status-dot" />
            {meta.label}
          </span>
        </div>
      </div>

      {/* Bill to | dates, reference, currency */}
      <div className="ie-meta">
        <div className="ie-billto">
          <div className="ie-label">Bill to</div>
          <input
            className="ie-input ie-strong"
            aria-label="Client name"
            placeholder="Client or company name *"
            list={clients.length ? listId : undefined}
            value={draft.client_name}
            maxLength={120}
            onChange={(e) => pickClient(e.target.value)}
          />
          {clients.length > 0 && (
            <datalist id={listId}>
              {clients.map((cl) => (
                <option key={cl.client_name} value={cl.client_name} />
              ))}
            </datalist>
          )}
          <input
            className="ie-input"
            aria-label="Contact person"
            placeholder="Contact person"
            value={draft.client_contact}
            maxLength={120}
            onChange={(e) => onChange({ client_contact: e.target.value })}
          />
          <input
            className="ie-input"
            type="email"
            aria-label="Client email"
            placeholder="billing@client.com"
            value={draft.client_email}
            onChange={(e) => onChange({ client_email: e.target.value })}
          />
          <textarea
            className="ie-input ie-address"
            aria-label="Client address"
            placeholder={'Street address\nCity, State\nCountry'}
            rows={3}
            maxLength={500}
            value={draft.client_address}
            onChange={(e) => onChange({ client_address: e.target.value })}
          />
        </div>

        <div className="ie-facts">
          <label>
            <span>Invoice date</span>
            <input
              className="ie-input"
              type="date"
              value={toDateInput(draft.issued_at)}
              onChange={(e) => {
                const issued = fromDateInput(e.target.value);
                if (issued !== null) onChange({ issued_at: issued, due_at: issued + Math.max(0, termDays) * DAY });
              }}
            />
          </label>
          <label>
            <span>Terms</span>
            <select
              className="ie-input"
              value={TERM_PRESETS.some((t) => t.days === termDays) ? String(termDays) : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') onChange({ due_at: draft.issued_at + Number(e.target.value) * DAY });
              }}
            >
              {TERM_PRESETS.map((t) => (
                <option key={t.days} value={t.days}>
                  {t.label}
                </option>
              ))}
              <option value="custom">Custom ({termDays} days)</option>
            </select>
          </label>
          <label>
            <span>Due date</span>
            <input
              className="ie-input"
              type="date"
              min={toDateInput(draft.issued_at)}
              value={toDateInput(draft.due_at)}
              onChange={(e) => {
                const due = fromDateInput(e.target.value);
                if (due !== null) onChange({ due_at: Math.max(due, draft.issued_at) });
              }}
            />
          </label>
          <label>
            <span>Reference / PO</span>
            <input
              className="ie-input"
              placeholder="Optional"
              maxLength={80}
              value={draft.reference}
              onChange={(e) => onChange({ reference: e.target.value })}
            />
          </label>
          <label>
            <span>Currency</span>
            <select className="ie-input" value={c} onChange={(e) => onChange({ currency: e.target.value })}>
              {CURRENCIES.map((cur) => (
                <option key={cur.code} value={cur.code}>
                  {cur.code} ({cur.symbol}) {cur.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Line items */}
      <div className={`ie-items${showEq ? ' has-eq' : ''}`} role="table" aria-label="Line items">
        <div className="ie-row ie-row-head" role="row">
          <span>#</span>
          <span>Description</span>
          <span className="r">Qty</span>
          <span className="r">Rate ({CURRENCY_SYMBOLS[c] ?? c})</span>
          <span className="r">Amount</span>
          {showEq && <span className="r">≈ {eqCode}</span>}
          <span />
        </div>
        {draft.items.map((item, index) => (
          <div className="ie-row" role="row" key={index}>
            <span className="ie-idx">{index + 1}</span>
            <div className="ie-desc">
              <textarea
                className="ie-input ie-strong ie-grow"
                aria-label={`Item ${index + 1} name`}
                placeholder="Item or service"
                rows={1}
                maxLength={200}
                value={item.name}
                onChange={(e) => updateItem(index, { name: e.target.value.replace(/\n/g, ' ') })}
              />
              <textarea
                className="ie-input ie-muted ie-grow"
                aria-label={`Item ${index + 1} description`}
                placeholder="Description (optional)"
                rows={1}
                maxLength={1000}
                value={item.desc}
                onChange={(e) => updateItem(index, { desc: e.target.value })}
              />
            </div>
            <NumberField ariaLabel={`Item ${index + 1} quantity`} decimals={3} value={item.qty} onChange={(qty) => updateItem(index, { qty })} placeholder="1" />
            <NumberField ariaLabel={`Item ${index + 1} rate`} value={item.unitPrice} onChange={(unitPrice) => updateItem(index, { unitPrice })} />
            <span className="r ie-amount">{fmtMoney(lineAmount(item), c)}</span>
            {showEq && <span className="r ie-muted">{eq(lineAmount(item))}</span>}
            <span className="ie-row-actions">
              <button type="button" className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => moveItem(index, -1)}>
                ↑
              </button>
              <button type="button" className="icon-btn" title="Duplicate line" aria-label="Duplicate line" onClick={() => onChange({ items: [...draft.items.slice(0, index + 1), { ...item }, ...draft.items.slice(index + 1)] })}>
                <Duplicate />
              </button>
              <button
                type="button"
                className="icon-btn item-delete"
                title="Remove line"
                aria-label="Remove line"
                onClick={() => onChange({ items: draft.items.filter((_, i) => i !== index) })}
              >
                <Trash />
              </button>
            </span>
          </div>
        ))}
        {draft.items.length === 0 && <div className="ie-empty">No line items yet.</div>}
      </div>
      <button type="button" className="inv-add-item" onClick={() => onChange({ items: [...draft.items, emptyItem()] })}>
        <Plus />
        <span>Add line</span>
      </button>

      {/* Notes & terms | totals */}
      <div className="ie-summary">
        <div className="ie-notes">
          <label>
            <span className="ie-label">Notes to client</span>
            <textarea
              className="ie-input ie-box"
              rows={3}
              maxLength={2000}
              placeholder="Thank you for your business."
              value={draft.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </label>
          <label>
            <span className="ie-label">Payment terms</span>
            <textarea
              className="ie-input ie-box"
              rows={3}
              maxLength={2000}
              placeholder="e.g. Payment due within 30 days."
              value={draft.terms}
              onChange={(e) => onChange({ terms: e.target.value })}
            />
          </label>
        </div>

        <div className="ie-totals">
          <div className="ie-tot">
            <span>Subtotal</span>
            <span>{fmtMoney(totals.subtotal, c)}</span>
          </div>
          <div className="ie-tot">
            <span className="ie-tot-label">
              Discount
              <span className="inv-mode-toggle ie-toggle">
                <button type="button" className={`mode-tab${draft.discount_type === 'value' ? ' active' : ''}`} onClick={() => onChange({ discount_type: 'value' })}>
                  {CURRENCY_SYMBOLS[c] ?? c}
                </button>
                <button type="button" className={`mode-tab${draft.discount_type === 'percent' ? ' active' : ''}`} onClick={() => onChange({ discount_type: 'percent', discount: Math.min(draft.discount, 100) })}>
                  %
                </button>
              </span>
            </span>
            <span className="ie-tot-input">
              <NumberField ariaLabel="Discount" max={draft.discount_type === 'percent' ? 100 : undefined} value={draft.discount} onChange={(discount) => onChange({ discount })} />
              {draft.discount_type === 'percent' && totals.discount > 0 && <small>−{fmtMoney(totals.discount, c)}</small>}
            </span>
          </div>
          <div className="ie-tot">
            <span>Additional charges</span>
            <span className="ie-tot-input">
              <NumberField ariaLabel="Additional charges" value={draft.charges} onChange={(charges) => onChange({ charges })} />
            </span>
          </div>
          <div className="ie-tot">
            <span className="ie-tot-label">
              VAT
              <span className="ie-pct">
                <NumberField
                  className="ie-input ie-num ie-num-sm"
                  ariaLabel="VAT rate in percent"
                  max={100}
                  value={Math.round(draft.tax_rate * 10000) / 100}
                  onChange={(pct) => onChange({ tax_rate: Math.min(100, Math.max(0, pct)) / 100 })}
                />
                %
              </span>
            </span>
            <span>{fmtMoney(totals.tax, c)}</span>
          </div>
          <div className="ie-tot ie-grand">
            <span>Total</span>
            <span>{fmtMoney(totals.total, c)}</span>
          </div>
          {showEq && (
            <div className="ie-tot ie-eq">
              <span>≈ {eqCode} equivalent</span>
              <span>{eq(totals.total)}</span>
            </div>
          )}
          {totals.paid > 0 && (
            <>
              <div className="ie-tot ie-paid">
                <span>Amount paid</span>
                <span>−{fmtMoney(Math.min(totals.paid, totals.total), c)}</span>
              </div>
              {totals.overpaid > 0 && (
                <div className="ie-tot">
                  <span>Credit (overpaid)</span>
                  <span>{fmtMoney(totals.overpaid, c)}</span>
                </div>
              )}
              <div className={`ie-tot ie-grand ${totals.balance > 0 ? 'ie-due' : 'ie-cleared'}`}>
                <span>{totals.balance > 0 ? 'Balance due' : 'Balance'}</span>
                <span>
                  {fmtMoney(totals.balance, c)}
                  {showEq && totals.balance > 0 && <small> ≈ {eq(totals.balance)}</small>}
                </span>
              </div>
            </>
          )}

          <div className="ie-eq-box">
            <label className="ie-check">
              <input
                type="checkbox"
                checked={showEq}
                onChange={(e) => onChange({ exchange_rate: e.target.checked ? defaultRate || 1500 : 0 })}
              />
              <span>Show {eqCode} equivalent</span>
            </label>
            {showEq && (
              <span className="ie-rate">
                ₦
                <NumberField
                  className="ie-input ie-num ie-num-md"
                  ariaLabel={`Naira per 1 ${foreign}`}
                  decimals={4}
                  value={draft.exchange_rate}
                  onChange={(exchange_rate) => onChange({ exchange_rate })}
                />
                = {CURRENCY_SYMBOLS[foreign] ?? foreign}1
              </span>
            )}
          </div>

          <div className="ie-words">
            <span className="ie-label">Amount in words</span>
            <span>{moneyInWords(totals.total, c)}</span>
          </div>
        </div>
      </div>

      {/* Preview of the payment details the client will see */}
      <div className="ie-pay">
        <div className="ie-label">Payment information shown to the client</div>
        {shownAccounts.length === 0 ? (
          <div className="ie-muted">No bank accounts yet. Add them in Settings → Invoice.</div>
        ) : (
          <div className="ie-accounts">
            {shownAccounts.map((a, i) => (
              <div className="ie-account" key={`${a.title}-${i}`}>
                <strong>{a.title || `${a.currency} account`}</strong>
                <span className="ie-muted">
                  {[a.bank, a.accountName, a.accountNumber, a.extraValue ? `${a.extraLabel}: ${a.extraValue}` : ''].filter(Boolean).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {payments.length > 0 && (
        <div className="ie-pay">
          <div className="ie-label">Payments received</div>
          {payments.map((p) => (
            <div className="ie-payment" key={p.id}>
              <span>{formatDate(Date.parse(`${p.date}T00:00:00Z`), dateFormat)}</span>
              <span className="ie-muted">{[p.method, p.note].filter(Boolean).join(' · ')}</span>
              <strong>{fmtMoney(p.amount, c)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
