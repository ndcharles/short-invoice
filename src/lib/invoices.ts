/**
 * Invoice maths and labels, shared by the Worker (authoritative totals and
 * status) and the UI (live preview). Pure functions, no runtime imports
 * beyond the date helpers.
 */
import { DEFAULT_DATE_FORMAT, formatDate, startOfDay } from './dates';

export type InvoiceStatus = 'draft' | 'sent' | 'overdue' | 'partially-paid' | 'paid' | 'cancelled';

export interface InvoiceItem {
  name: string;
  desc: string;
  qty: number;
  unitPrice: number;
}

export interface InvoicePayment {
  amount: number;
  date: string;
  method: string;
  note: string;
}

/** The stored fields the totals depend on (an InvoiceRow satisfies this). */
export interface InvoiceLike {
  items: string;
  payments: string;
  total: number;
  tax_rate: number;
  discount: number;
  discount_type?: string;
  charges?: number;
}

export const INVOICE_STATUSES: { id: InvoiceStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'partially-paid', label: 'Partially paid' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const INVOICE_STATUS_IDS = INVOICE_STATUSES.map((s) => s.id);

/**
 * Statuses you can pick by hand. Overdue follows the due date and
 * Paid / Partially paid follow the logged payments, so the server sets those.
 */
export const MANUAL_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'cancelled'];

export const STATUS_META: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'inv-status-draft' },
  sent: { label: 'Sent', cls: 'inv-status-sent' },
  overdue: { label: 'Overdue', cls: 'inv-status-overdue' },
  'partially-paid': { label: 'Partially paid', cls: 'inv-status-partial' },
  paid: { label: 'Paid', cls: 'inv-status-paid' },
  cancelled: { label: 'Cancelled', cls: 'inv-status-cancelled' },
};

export function invoiceStatusPill(status: InvoiceStatus | string): { label: string; cls: string } {
  return STATUS_META[status as InvoiceStatus] ?? STATUS_META.draft;
}

// --- Currency -------------------------------------------------------------

/** The workspace's home currency: invoices default to it and equivalents convert to or from it. */
export const BASE_CURRENCY = 'NGN';
/** The foreign currency shown as an equivalent on naira invoices. */
export const EQUIVALENT_CURRENCY = 'USD';

export const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  ZAR: 'R',
  KES: 'KSh',
};

/** Settings store currencies as labels like "NGN (₦)"; this returns the ISO code. */
export function currencyCode(label: string | null | undefined, fallback = BASE_CURRENCY): string {
  const match = /^\s*([A-Za-z]{3})\b/.exec(label ?? '');
  return match ? match[1].toUpperCase() : fallback;
}

/** Symbol for a code; also learns custom symbols from labels like "AED (د.إ)". */
export function currencySymbol(code: string, labels: string[] = []): string {
  if (CURRENCY_SYMBOLS[code]) return CURRENCY_SYMBOLS[code];
  for (const label of labels) {
    const match = /^\s*([A-Za-z]{3})\s*\((.+)\)\s*$/.exec(label);
    if (match && match[1].toUpperCase() === code) return match[2];
  }
  return `${code} `;
}

export const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export function fmtMoney(amount: number, currency = BASE_CURRENCY): string {
  const value = Number(amount || 0);
  const text = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '−' : ''}${currencySymbol(currency)}${text}`;
}

/** Plain number with separators, for inputs that are not being edited. */
export function fmtNumber(amount: number, decimals = 2): string {
  return Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Strips currency symbols and separators from typed money ("₦1,500.50" → 1500.5). */
export function parseMoneyInput(value: string): number {
  const cleaned = String(value ?? '').replace(/[^0-9.]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

// --- Stored JSON ----------------------------------------------------------

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const str = (value: unknown) => (typeof value === 'string' ? value : '');

function parseJsonList(value: string | null | undefined): unknown[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseItems(value: string | null | undefined): InvoiceItem[] {
  return parseJsonList(value)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({ name: str(item.name), desc: str(item.desc), qty: num(item.qty), unitPrice: num(item.unitPrice) }));
}

export function parsePayments(value: string | null | undefined): InvoicePayment[] {
  return parseJsonList(value)
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({ amount: num(p.amount), date: str(p.date), method: str(p.method), note: str(p.note) }));
}

// --- Totals ---------------------------------------------------------------

export const lineTotal = (item: Pick<InvoiceItem, 'qty' | 'unitPrice'>) => num(item.qty) * num(item.unitPrice);

/** Resolves a discount that may be a flat amount or a percentage of the subtotal. */
export function discountAmount(draft: {
  items: InvoiceItem[];
  discount: number;
  discountType?: 'value' | 'percent' | string;
}): number {
  const subtotal = draft.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const discount = Math.max(0, num(draft.discount));
  const amount = draft.discountType === 'percent' ? (subtotal * Math.min(discount, 100)) / 100 : discount;
  return round2(Math.min(amount, subtotal));
}

/**
 * Standard invoice order: subtotal − discount + additional charges, then tax
 * on that amount. Every figure is rounded to kobo/cents so the printed rows
 * always add up to the printed total.
 */
export function draftTotals(draft: {
  items: InvoiceItem[];
  discount: number;
  discountType?: 'value' | 'percent' | string;
  charges?: number;
  taxRate?: number;
}) {
  const subtotal = round2(draft.items.reduce((sum, item) => sum + lineTotal(item), 0));
  const discount = discountAmount(draft);
  const charges = round2(Math.max(0, num(draft.charges)));
  const taxable = round2(subtotal - discount + charges);
  const tax = round2(taxable * Math.max(0, num(draft.taxRate)));
  return { subtotal, discount, charges, tax, grand: round2(taxable + tax) };
}

export const paidTotal = (payments: InvoicePayment[]) => round2(payments.reduce((sum, p) => sum + num(p.amount), 0));

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  charges: number;
  tax: number;
  grand: number;
  paid: number;
  /** What is still owed (never negative). */
  balance: number;
  /** Paid beyond the total, shown as a credit. */
  credit: number;
}

/** Totals for a stored invoice. Rows with no line items keep their stored total. */
export function invoiceTotals(invoice: InvoiceLike): InvoiceTotals {
  const items = parseItems(invoice.items);
  const paid = paidTotal(parsePayments(invoice.payments));
  let totals: Omit<InvoiceTotals, 'paid' | 'balance' | 'credit'>;
  if (items.length > 0) {
    totals = draftTotals({
      items,
      discount: num(invoice.discount),
      discountType: invoice.discount_type,
      charges: num(invoice.charges),
      taxRate: num(invoice.tax_rate),
    });
  } else {
    const grand = round2(num(invoice.total));
    const subtotal = round2(grand / (1 + num(invoice.tax_rate)));
    totals = { subtotal, discount: 0, charges: 0, tax: round2(grand - subtotal), grand };
  }
  return { ...totals, paid, balance: round2(Math.max(0, totals.grand - paid)), credit: round2(Math.max(0, paid - totals.grand)) };
}

/** @deprecated use invoiceTotals */
export const computeTotals = invoiceTotals;

// --- Currency equivalent ---------------------------------------------------

/**
 * A naira invoice can show its USD equivalent (and a foreign-currency invoice
 * its naira equivalent). The rate is always naira per one unit of the other
 * currency, e.g. 1500 means ₦1,500 = $1.
 */
export function equivalentCurrency(currency: string): string {
  return currency === BASE_CURRENCY ? EQUIVALENT_CURRENCY : BASE_CURRENCY;
}

export function convertEquivalent(amount: number, currency: string, rate: number): number {
  const r = num(rate);
  if (r <= 0) return 0;
  return round2(currency === BASE_CURRENCY ? num(amount) / r : num(amount) * r);
}

export function rateLine(currency: string, rate: number): string {
  if (num(rate) <= 0) return '';
  const foreign = currency === BASE_CURRENCY ? EQUIVALENT_CURRENCY : currency;
  return `${CURRENCY_SYMBOLS[BASE_CURRENCY]}${num(rate).toLocaleString('en-US', { maximumFractionDigits: 4 })} = ${currencySymbol(foreign)}1`;
}

export interface Equivalent {
  code: string;
  /** Equivalent of the invoice total (the override wins when set). */
  total: number;
  /** Equivalent of the open balance, at the same effective rate. */
  balance: number;
  rate: number;
  rateLine: string;
  overridden: boolean;
}

/** The equivalent block, or null when the invoice has none. */
export function invoiceEquivalent(opts: {
  currency: string;
  grand: number;
  balance: number;
  exchangeRate: number;
  equivalentAmount?: number;
}): Equivalent | null {
  const rate = num(opts.exchangeRate);
  if (rate <= 0) return null;
  const override = num(opts.equivalentAmount);
  const auto = convertEquivalent(opts.grand, opts.currency, rate);
  const total = override > 0 ? round2(override) : auto;
  // A manual figure implies its own rate; keep the balance proportional to it.
  const ratio = opts.grand > 0 ? total / opts.grand : 0;
  return {
    code: equivalentCurrency(opts.currency),
    total,
    balance: round2(opts.balance * ratio),
    rate,
    rateLine: rateLine(opts.currency, rate),
    overridden: override > 0,
  };
}

// --- Status ---------------------------------------------------------------

/**
 * The status an invoice should have. Cancelled and draft are set by hand;
 * payments decide paid / partially paid; an unpaid, issued invoice is
 * overdue once its due date has passed (the due date itself is still payable).
 */
export function resolveStatus(opts: {
  status: InvoiceStatus | string;
  grand: number;
  paid: number;
  dueAt: number;
  now?: number;
}): InvoiceStatus {
  const status = (INVOICE_STATUS_IDS as string[]).includes(opts.status) ? (opts.status as InvoiceStatus) : 'draft';
  if (status === 'cancelled') return 'cancelled';
  if (opts.paid > 0) return opts.grand > 0 && opts.paid >= opts.grand - 0.005 ? 'paid' : 'partially-paid';
  if (status === 'draft') return 'draft';
  return opts.dueAt < startOfDay(opts.now ?? Date.now()) ? 'overdue' : 'sent';
}

// --- Terms, dates, text ---------------------------------------------------

export const PAYMENT_TERMS = ['Due on receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Custom'];

/** Days until due for a terms label ("Net 30" → 30, "Due on receipt" → 0), or null when custom. */
export function termsDays(terms: string | null | undefined): number | null {
  if (!terms) return null;
  if (/due on receipt/i.test(terms)) return 0;
  const match = /net\s*(\d{1,3})/i.exec(terms);
  return match ? Number(match[1]) : null;
}

export function dueDateFor(issuedAt: number, terms: string | null | undefined, fallbackDays = 30): number {
  const days = termsDays(terms) ?? fallbackDays;
  return startOfDay(issuedAt) + days * 86_400_000;
}

export function formatDay(ms: number, format: string = DEFAULT_DATE_FORMAT): string {
  return formatDate(ms, format);
}

/** Replaces {client}, {number}, … in an email template. Unknown keys are left as typed. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const CURRENCY_NAMES: Record<string, { major: string; minor: string }> = {
  NGN: { major: 'Naira', minor: 'Kobo' },
  USD: { major: 'US Dollars', minor: 'Cents' },
  EUR: { major: 'Euros', minor: 'Cents' },
  GBP: { major: 'Pounds Sterling', minor: 'Pence' },
  CAD: { major: 'Canadian Dollars', minor: 'Cents' },
  ZAR: { major: 'Rand', minor: 'Cents' },
  KES: { major: 'Kenyan Shillings', minor: 'Cents' },
};

function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` and ${under1000(n % 100)}` : ''}`;
}

/**
 * "Six Thousand, Six Hundred and Sixty-Five Naira Only". The currency name
 * follows the words (no symbol) and any kobo/cents are stated explicitly.
 */
export function moneyInWords(amount: number, currency = BASE_CURRENCY): string {
  const units = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
  const names = CURRENCY_NAMES[currency] ?? { major: currency, minor: 'Cents' };
  const value = round2(Math.abs(Number(amount) || 0));
  const whole = Math.floor(value);

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

  const minor = Math.round((value - whole) * 100);
  const minorText = minor > 0 ? `, ${under1000(minor)} ${names.minor}` : '';
  return `${words} ${names.major}${minorText} Only`;
}

/** Client address is stored as one line per field so empty fields keep their place. */
export function splitAddress(address: string | null | undefined) {
  const lines = (address || '').split('\n');
  return { contact: lines[1] ?? '', addr1: lines[2] ?? '', addr2: lines[3] ?? '', country: lines[4] ?? '' };
}

export function joinAddress(parts: { name: string; contact: string; addr1: string; addr2: string; country: string }): string {
  return [parts.name, parts.contact, parts.addr1, parts.addr2, parts.country]
    .map((line) => line.replace(/\s*\n\s*/g, ' ').trim())
    .join('\n')
    .replace(/\n+$/, '');
}
