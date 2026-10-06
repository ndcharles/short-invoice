/**
 * Invoice model shared by the Worker (authoritative totals and statuses) and
 * the UI (live preview while editing). Pure functions, no runtime imports.
 *
 * Money is computed in minor units (kobo/cents) and rounded once per line and
 * once per total, so the document, the list and the API always agree.
 *
 * Currency equivalents: every invoice has one currency. The optional
 * `exchange_rate` is always "naira per 1 unit of the foreign currency":
 *   - an NGN invoice shows a USD equivalent  (amount ÷ rate)
 *   - a USD/GBP/EUR invoice shows an NGN equivalent (amount × rate)
 * A rate of 0 means "no equivalent shown".
 */

/** What is stored. `overdue` is never stored: it is derived from the due date. */
export type StoredStatus = 'draft' | 'sent' | 'partially-paid' | 'paid' | 'cancelled';
export type InvoiceStatus = StoredStatus | 'overdue';

/** Statuses a person sets directly; paid / partially paid follow from payments. */
export const MANUAL_STATUSES: StoredStatus[] = ['draft', 'sent', 'cancelled'];

export const INVOICE_STATUSES: { id: InvoiceStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'partially-paid', label: 'Partially paid' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const STATUS_META: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'inv-status-draft' },
  sent: { label: 'Sent', cls: 'inv-status-sent' },
  overdue: { label: 'Overdue', cls: 'inv-status-overdue' },
  'partially-paid': { label: 'Partially paid', cls: 'inv-status-partial' },
  paid: { label: 'Paid', cls: 'inv-status-paid' },
  cancelled: { label: 'Cancelled', cls: 'inv-status-cancelled' },
};

export interface InvoiceItem {
  name: string;
  desc: string;
  qty: number;
  unitPrice: number;
}

export interface InvoicePayment {
  id: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  method: string;
  note: string;
}

export const CURRENCIES: { code: string; symbol: string; name: string; major: string; minor: string }[] = [
  { code: 'NGN', symbol: '₦', name: 'Nigerian naira', major: 'Naira', minor: 'Kobo' },
  { code: 'USD', symbol: '$', name: 'US dollar', major: 'US Dollars', minor: 'Cents' },
  { code: 'GBP', symbol: '£', name: 'British pound', major: 'Pounds Sterling', minor: 'Pence' },
  { code: 'EUR', symbol: '€', name: 'Euro', major: 'Euros', minor: 'Cents' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian dollar', major: 'Canadian Dollars', minor: 'Cents' },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian cedi', major: 'Cedis', minor: 'Pesewas' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan shilling', major: 'Kenyan Shillings', minor: 'Cents' },
  { code: 'ZAR', symbol: 'R', name: 'South African rand', major: 'Rand', minor: 'Cents' },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);
export const CURRENCY_SYMBOLS: Record<string, string> = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.symbol]));

export const isCurrency = (code: unknown): code is string => typeof code === 'string' && CURRENCY_CODES.includes(code);

/** "NGN (₦)" (older settings format) or "NGN" → "NGN". */
export function currencyCode(value: string | undefined | null, fallback = 'NGN'): string {
  const code = (value ?? '').trim().slice(0, 3).toUpperCase();
  return isCurrency(code) ? code : fallback;
}

const toMinor = (amount: number) => Math.round((Number(amount) || 0) * 100);
const fromMinor = (minor: number) => minor / 100;

/** Rounds to 2 decimal places the way the totals do. */
export const round2 = (amount: number) => fromMinor(toMinor(amount));

export function fmtMoney(amount: number, currency = 'NGN'): string {
  const value = Number(amount || 0);
  const formatted = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '−' : ''}${CURRENCY_SYMBOLS[currency] ?? `${currency} `}${formatted}`;
}

/** Defensive parse of the stored items JSON. */
export function parseItems(value: unknown): InvoiceItem[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      desc: typeof item.desc === 'string' ? item.desc : '',
      qty: Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0,
      unitPrice: Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : 0,
    }));
}

/** Defensive parse of the stored payments JSON; older rows without ids get stable ones. */
export function parsePayments(value: unknown): InvoicePayment[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p, index) => ({
      id: typeof p.id === 'string' && p.id ? p.id : `pay_${index + 1}`,
      amount: Number.isFinite(Number(p.amount)) ? Number(p.amount) : 0,
      date: typeof p.date === 'string' ? p.date : '',
      method: typeof p.method === 'string' ? p.method : '',
      note: typeof p.note === 'string' ? p.note : '',
    }));
}

export const lineAmount = (item: Pick<InvoiceItem, 'qty' | 'unitPrice'>) => round2(Number(item.qty) * Number(item.unitPrice));

export interface TotalsInput {
  items: InvoiceItem[];
  discount: number;
  discountType: 'value' | 'percent';
  charges: number;
  /** Fraction, e.g. 0.075 for 7.5%. */
  taxRate: number;
}

export interface InvoiceTotals {
  subtotal: number;
  /** The discount in money, whatever its type, never more than the subtotal. */
  discount: number;
  charges: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  /** Amount paid beyond the total (a credit for the client). */
  overpaid: number;
}

/**
 * subtotal − discount + charges, then tax on that, all in minor units.
 * Tax applies to charges too (delivery, setup fees are usually taxable).
 */
export function computeTotals(input: TotalsInput, payments: Pick<InvoicePayment, 'amount'>[] = []): InvoiceTotals {
  const subtotalMinor = input.items.reduce((sum, item) => sum + toMinor(lineAmount(item)), 0);
  const rawDiscount =
    input.discountType === 'percent'
      ? Math.round((subtotalMinor * Math.min(100, Math.max(0, Number(input.discount) || 0))) / 100)
      : toMinor(Math.max(0, Number(input.discount) || 0));
  const discountMinor = Math.min(rawDiscount, subtotalMinor);
  const chargesMinor = toMinor(Math.max(0, Number(input.charges) || 0));
  const taxableMinor = subtotalMinor - discountMinor + chargesMinor;
  const taxMinor = Math.round(taxableMinor * Math.max(0, Number(input.taxRate) || 0));
  const totalMinor = taxableMinor + taxMinor;
  const paidMinor = payments.reduce((sum, p) => sum + toMinor(p.amount), 0);

  return {
    subtotal: fromMinor(subtotalMinor),
    discount: fromMinor(discountMinor),
    charges: fromMinor(chargesMinor),
    tax: fromMinor(taxMinor),
    total: fromMinor(totalMinor),
    paid: fromMinor(paidMinor),
    balance: fromMinor(Math.max(0, totalMinor - paidMinor)),
    overpaid: fromMinor(Math.max(0, paidMinor - totalMinor)),
  };
}

/**
 * The status to store after payments or totals change. Cancelled and draft
 * invoices with no payments keep their status; otherwise payments decide.
 */
export function settleStatus(current: StoredStatus, totals: Pick<InvoiceTotals, 'paid' | 'balance' | 'total'>): StoredStatus {
  if (current === 'cancelled') return 'cancelled';
  if (totals.paid > 0 && totals.balance <= 0 && totals.total > 0) return 'paid';
  if (totals.paid > 0) return 'partially-paid';
  return current === 'paid' || current === 'partially-paid' ? 'sent' : current;
}

/** The status people see: unpaid sent invoices past their due date are overdue. */
export function displayStatus(stored: StoredStatus, dueAt: number, balance: number, now = Date.now()): InvoiceStatus {
  if ((stored === 'sent' || stored === 'partially-paid') && balance > 0) {
    const today = new Date(now);
    const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (dueAt < startOfToday) return 'overdue';
  }
  return stored;
}

/** Whole days until (positive) or since (negative) the due date, by UTC calendar day. */
export function daysUntil(dueAt: number, now = Date.now()): number {
  const day = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  return Math.round((day(dueAt) - day(now)) / 86_400_000);
}

/** The other side of the equivalent: NGN invoices show USD, foreign invoices show NGN. */
export const equivalentCurrency = (currency: string) => (currency === 'NGN' ? 'USD' : 'NGN');

/** Converts an invoice amount to its equivalent currency, or null when no rate is set. */
export function toEquivalent(amount: number, currency: string, rate: number): number | null {
  const r = Number(rate) || 0;
  if (r <= 0) return null;
  return round2(currency === 'NGN' ? amount / r : amount * r);
}

/** Naira value of an amount, for cross-invoice reporting. Null when it cannot be known. */
export function toNaira(amount: number, currency: string, rate: number): number | null {
  if (currency === 'NGN') return amount;
  const r = Number(rate) || 0;
  return r > 0 ? round2(amount * r) : null;
}

/** "₦1,500.00 = $1" style line for the rate in use. */
export function rateLabel(currency: string, rate: number): string {
  const foreign = currency === 'NGN' ? 'USD' : currency;
  return `${fmtMoney(rate, 'NGN')} = ${CURRENCY_SYMBOLS[foreign] ?? foreign}1`;
}

/** Due date from a payment-terms setting such as "Net 30" or "Due on receipt". */
export function dueDateFromTerms(terms: string | undefined, issuedAt: number): number {
  const match = /net\s*(\d{1,3})/i.exec(terms ?? '');
  const days = match ? Number(match[1]) : /receipt/i.test(terms ?? '') ? 0 : 30;
  return issuedAt + days * 86_400_000;
}

/** Number from the configured prefix, padding and sequence value. */
export function formatInvoiceNumber(prefix: string, padding: number, sequence: number): string {
  const pad = Number.isFinite(padding) ? Math.min(12, Math.max(1, padding)) : 6;
  return `${prefix}${String(sequence).padStart(pad, '0')}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` and ${under1000(n % 100)}` : ''}`;
}

/**
 * "Six Thousand, Six Hundred and Sixty-Five Naira, Fifty Kobo Only": the
 * currency name follows the words and any minor units are stated explicitly.
 */
export function moneyInWords(amount: number, currency = 'NGN'): string {
  const units = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
  const meta = CURRENCIES.find((c) => c.code === currency);
  const major = meta?.major ?? currency;
  const minorName = meta?.minor ?? 'Cents';
  const minorTotal = Math.abs(toMinor(amount));
  const whole = Math.floor(minorTotal / 100);
  const minor = minorTotal % 100;

  let words: string;
  if (whole === 0) {
    words = 'Zero';
  } else {
    const groups: string[] = [];
    let remaining = whole;
    let index = 0;
    while (remaining > 0 && index < units.length) {
      const chunk = remaining % 1000;
      if (chunk) groups.unshift(`${under1000(chunk)}${units[index] ? ` ${units[index]}` : ''}`);
      remaining = Math.floor(remaining / 1000);
      index += 1;
    }
    words = groups.join(', ');
  }
  const minorText = minor > 0 ? `, ${under1000(minor)} ${minorName}` : '';
  return `${words} ${major}${minorText} Only`;
}

/** Fills {client}, {number}, {amount}, {due}, {balance}, {link}, {payment_date} in email templates. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
