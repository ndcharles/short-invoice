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

export interface Invoice {
  id: string;
  workspace_id: string;
  number: string;
  client_name: string;
  client_email: string;
  client_address: string;
  issued_at: number;
  due_at: number;
  currency: string;
  status: InvoiceStatus;
  items: string;
  payments: string;
  subtotal: number;
  tax_rate: number;
  discount: number;
  total: number;
  notes: string;
  terms: string;
  folder: string;
  tag: string | null;
  avatar: string;
  created_at: number;
  updated_at: number;
}

export const INVOICE_STATUSES: { id: InvoiceStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'partially-paid', label: 'Partially paid' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** Statuses offered by the row menu's "Change status" submenu. */
export const MANUAL_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'overdue', 'cancelled'];

export const STATUS_META: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'inv-status-draft' },
  sent: { label: 'Sent', cls: 'inv-status-sent' },
  overdue: { label: 'Overdue', cls: 'inv-status-overdue' },
  'partially-paid': { label: 'Partially paid', cls: 'inv-status-partial' },
  paid: { label: 'Paid', cls: 'inv-status-paid' },
  cancelled: { label: 'Cancelled', cls: 'inv-status-cancelled' },
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function fmtMoney(amount: number, currency = 'NGN'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '';
  const value = Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${value}`;
}

export function parseItems(value: string | null | undefined): InvoiceItem[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parsePayments(value: string | null | undefined): InvoicePayment[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  discount: number;
  grand: number;
  paid: number;
  balance: number;
}

/** Mirrors the design's computeTotals: real items win, otherwise back-solve from the stored total. */
export function computeTotals(invoice: Invoice): InvoiceTotals {
  const payments = parsePayments(invoice.payments);
  const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const taxRate = Number(invoice.tax_rate ?? 0.075);
  const discount = Number(invoice.discount ?? 0);
  const items = parseItems(invoice.items);

  let subtotal: number;
  let tax: number;
  let grand: number;

  if (items.length > 0) {
    subtotal = items.reduce((sum, item) => sum + Number(item.qty) * Number(item.unitPrice), 0);
    const discounted = Math.max(0, subtotal - discount);
    tax = discounted * taxRate;
    grand = discounted + tax;
  } else {
    grand = Number(invoice.total || 0);
    subtotal = grand / (1 + taxRate);
    tax = grand - subtotal;
  }

  return { subtotal, tax, discount, grand, paid, balance: grand - paid };
}

/** Totals for an in-progress draft (items + discount + tax rate). */
export function computeTotalsFor(items: InvoiceItem[], discount: number, taxRate: number) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.qty) * Number(item.unitPrice), 0);
  const discounted = Math.max(0, subtotal - Number(discount || 0));
  const tax = discounted * Number(taxRate || 0);
  const grand = discounted + tax;
  return { subtotal, tax, grand, paid: 0, balance: grand };
}

export function invoiceStatusPill(status: InvoiceStatus): { label: string; cls: string } {
  return STATUS_META[status] ?? STATUS_META.draft;
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatShortDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const CURRENCY_NAMES: Record<string, { major: string; minor: string }> = {
  NGN: { major: 'Naira', minor: 'Kobo' },
  USD: { major: 'Dollars', minor: 'Cents' },
  EUR: { major: 'Euros', minor: 'Cents' },
  GBP: { major: 'Pounds', minor: 'Pence' },
};

function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` and ${under1000(n % 100)}` : ''}`;
}

/**
 * "Six Thousand, Six Hundred and Sixty-Five Naira Only" — the currency name
 * follows the words (no symbol) and any kobo/cents are stated explicitly.
 */
export function moneyInWords(amount: number, currency = 'NGN'): string {
  const units = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
  const names = CURRENCY_NAMES[currency] ?? { major: currency, minor: 'Cents' };
  const value = Math.abs(Number(amount) || 0);
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

/** Resolves a discount that may be a flat amount or a percentage of the subtotal. */
export function discountAmount(draft: {
  items: InvoiceItem[];
  discount: number;
  discountType?: 'value' | 'percent';
}): number {
  const subtotal = draft.items.reduce((sum, item) => sum + Number(item.qty) * Number(item.unitPrice), 0);
  return draft.discountType === 'percent'
    ? Math.round(((subtotal * Number(draft.discount || 0)) / 100) * 100) / 100
    : Number(draft.discount || 0);
}

/** Full totals for a draft, including charges and percentage discounts. */
export function draftTotals(draft: {
  items: InvoiceItem[];
  discount: number;
  discountType?: 'value' | 'percent';
  charges?: number;
  taxRate?: number;
}) {
  const subtotal = draft.items.reduce((sum, item) => sum + Number(item.qty) * Number(item.unitPrice), 0);
  const discount = discountAmount(draft);
  const discounted = Math.max(0, subtotal - discount);
  const charges = Number(draft.charges || 0);
  const tax = (discounted + charges) * Number(draft.taxRate || 0);
  return { subtotal, discount, charges, tax, grand: discounted + charges + tax };
}

/**
 * Currency equivalent shown under the totals. The stored rate is NGN per USD,
 * so NGN invoices convert to dollars and everything else converts to naira.
 */
export function convertAmount(
  amount: number,
  currency: string,
  ngnPerUsd: number
): { text: string; rateLine: string; code: string } {
  const rate = Number(ngnPerUsd) || 0;
  if (rate <= 0) return { text: '', rateLine: '', code: '' };
  const money = (value: number, symbol: string) =>
    `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (currency === 'NGN') {
    return { text: `≈ ${money(amount / rate, '$')}`, rateLine: '₦' + rate.toLocaleString('en-US') + ' = $1', code: 'USD' };
  }
  return { text: `≈ ${money(amount * rate, '₦')}`, rateLine: '₦' + rate.toLocaleString('en-US') + ' = $1', code: 'NGN' };
}
