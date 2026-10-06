import {
  INVOICE_STATUS_IDS,
  round2,
  type InvoiceItem,
  type InvoicePayment,
  type InvoiceStatus,
} from '../../src/lib/invoices';
import { LIMITS, parseEmail, parseMultiline, parseNumber, parseText, type Result } from '../../src/lib/validate';

/** Validated invoice fields. Keys are present only when supplied. */
export interface InvoiceInput {
  number?: string;
  client_name?: string;
  client_email?: string;
  client_address?: string;
  issued_at?: number;
  due_at?: number;
  currency?: string;
  status?: InvoiceStatus;
  items?: InvoiceItem[];
  payments?: InvoicePayment[];
  tax_rate?: number;
  discount?: number;
  discount_type?: 'value' | 'percent';
  charges?: number;
  payment_method?: string;
  equivalent_amount?: number;
  exchange_rate?: number;
  notes?: string;
  terms?: string;
  folder?: string | null;
  tag?: string | null;
}

export const INVOICE_LIMITS = { items: 200, payments: 200, money: 1e13, qty: 1e7 } as const;

// Year 2000 to 2200: any other timestamp is a client bug, not a real date.
const MIN_DATE = Date.UTC(2000, 0, 1);
const MAX_DATE = Date.UTC(2200, 0, 1);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = <T>(error: string): Result<T> => ({ ok: false, error });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

const money = (value: unknown, label: string) =>
  parseNumber(value, label, { min: 0, max: INVOICE_LIMITS.money, fallback: 0 });

function parseItemsInput(input: unknown): Result<InvoiceItem[]> {
  if (!Array.isArray(input)) return fail('Items must be a list');
  if (input.length > INVOICE_LIMITS.items) return fail(`An invoice can have at most ${INVOICE_LIMITS.items} items`);
  const items: InvoiceItem[] = [];
  for (const [index, raw] of input.entries()) {
    const label = `Item ${index + 1}`;
    if (!raw || typeof raw !== 'object') return fail(`${label} is invalid`);
    const item = raw as Record<string, unknown>;
    const name = parseText(item.name ?? '', `${label} name`, LIMITS.shortText);
    if (!name.ok) return name;
    const desc = parseMultiline(item.desc ?? '', `${label} description`, LIMITS.longText);
    if (!desc.ok) return desc;
    const qty = parseNumber(item.qty, `${label} quantity`, { min: 0, max: INVOICE_LIMITS.qty, fallback: 1 });
    if (!qty.ok) return qty;
    const unitPrice = money(item.unitPrice ?? item.unit_price, `${label} price`);
    if (!unitPrice.ok) return unitPrice;
    items.push({ name: name.value ?? '', desc: desc.value ?? '', qty: qty.value, unitPrice: unitPrice.value });
  }
  return ok(items);
}

function parsePaymentsInput(input: unknown): Result<InvoicePayment[]> {
  if (!Array.isArray(input)) return fail('Payments must be a list');
  if (input.length > INVOICE_LIMITS.payments) return fail(`An invoice can have at most ${INVOICE_LIMITS.payments} payments`);
  const payments: InvoicePayment[] = [];
  for (const [index, raw] of input.entries()) {
    const label = `Payment ${index + 1}`;
    if (!raw || typeof raw !== 'object') return fail(`${label} is invalid`);
    const p = raw as Record<string, unknown>;
    const amount = parseNumber(p.amount, `${label} amount`, { min: 0.01, max: INVOICE_LIMITS.money });
    if (!amount.ok) return amount;
    const date = typeof p.date === 'string' ? p.date.trim() : '';
    if (!DAY_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      return fail(`${label} date must look like 2026-03-19`);
    }
    const method = parseText(p.method ?? '', `${label} method`, LIMITS.name);
    if (!method.ok) return method;
    const note = parseMultiline(p.note ?? '', `${label} note`, LIMITS.longText);
    if (!note.ok) return note;
    payments.push({ amount: round2(amount.value), date, method: method.value ?? '', note: note.value ?? '' });
  }
  return ok(payments);
}

function parseDate(input: unknown, label: string): Result<number> {
  const value = typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : input;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`${label} must be a date`);
  if (value < MIN_DATE || value > MAX_DATE) return fail(`${label} is out of range`);
  return ok(Math.round(value));
}

const has = (body: Record<string, unknown>, key: string) => body[key] !== undefined;
const first = (body: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (body[k] !== undefined) return body[k];
  return undefined;
};

/**
 * Validates an invoice create/update payload. Totals and status are never
 * taken from the client; the route derives them from these fields.
 */
export function parseInvoiceInput(body: Record<string, unknown>): Result<InvoiceInput> {
  const out: InvoiceInput = {};
  const check = <T>(res: Result<T>, apply: (value: T) => void): string | null => {
    if (!res.ok) return res.error;
    apply(res.value);
    return null;
  };
  const text = (key: keyof InvoiceInput, label: string, max: number = LIMITS.shortText) =>
    has(body, key) ? check(parseText(body[key] ?? '', label, max), (v) => ((out as Record<string, unknown>)[key] = v ?? '')) : null;
  const multiline = (key: keyof InvoiceInput, label: string) =>
    has(body, key) ? check(parseMultiline(body[key] ?? '', label, LIMITS.longText), (v) => ((out as Record<string, unknown>)[key] = v ?? '')) : null;
  const amount = (key: 'discount' | 'charges' | 'equivalent_amount' | 'exchange_rate', label: string, ...aliases: string[]) => {
    const raw = first(body, key, ...aliases);
    return raw === undefined ? null : check(money(raw, label), (v) => (out[key] = round2(v)));
  };

  const clientName = first(body, 'client_name', 'client');
  const paymentMethod = first(body, 'payment_method', 'paymentMethod');

  const errors = [
    text('number', 'Invoice number', 40),
    clientName === undefined ? null : check(parseText(clientName, 'Client name'), (v) => (out.client_name = v ?? '')),
    has(body, 'client_email') ? check(parseEmail(body.client_email ?? '', 'Client email'), (v) => (out.client_email = v ?? '')) : null,
    multiline('client_address', 'Client address'),
    has(body, 'issued_at') ? check(parseDate(body.issued_at, 'Invoice date'), (v) => (out.issued_at = v)) : null,
    has(body, 'due_at') ? check(parseDate(body.due_at, 'Due date'), (v) => (out.due_at = v)) : null,
    has(body, 'currency')
      ? typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency.trim())
        ? ((out.currency = body.currency.trim().toUpperCase()), null)
        : 'Currency must be a 3-letter code such as NGN'
      : null,
    has(body, 'status')
      ? (INVOICE_STATUS_IDS as unknown[]).includes(body.status)
        ? ((out.status = body.status as InvoiceStatus), null)
        : 'Unknown invoice status'
      : null,
    has(body, 'items') ? check(parseItemsInput(body.items), (v) => (out.items = v)) : null,
    has(body, 'payments') ? check(parsePaymentsInput(body.payments), (v) => (out.payments = v)) : null,
    // Stored as a fraction: 0.075 is 7.5%.
    has(body, 'tax_rate') ? check(parseNumber(body.tax_rate, 'Tax rate', { min: 0, max: 1 }), (v) => (out.tax_rate = v)) : null,
    amount('discount', 'Discount'),
    has(body, 'discount_type')
      ? body.discount_type === 'percent' || body.discount_type === 'value'
        ? ((out.discount_type = body.discount_type), null)
        : 'Discount type must be "value" or "percent"'
      : null,
    amount('charges', 'Additional charges'),
    paymentMethod === undefined
      ? null
      : check(parseText(paymentMethod ?? '', 'Payment method', LIMITS.name), (v) => (out.payment_method = v ?? '')),
    amount('equivalent_amount', 'Equivalent amount', 'equivalentAmount'),
    amount('exchange_rate', 'Exchange rate', 'exchangeRate'),
    multiline('notes', 'Notes'),
    multiline('terms', 'Payment terms'),
    has(body, 'folder') ? check(parseText(body.folder, 'Folder', LIMITS.name), (v) => (out.folder = v)) : null,
    has(body, 'tag') ? check(parseText(body.tag, 'Tag', LIMITS.name), (v) => (out.tag = v)) : null,
  ];

  const error = errors.find((e) => e !== null);
  if (error) return fail(error);
  if (out.discount_type === 'percent' && (out.discount ?? 0) > 100) return fail('A percentage discount cannot exceed 100%');
  if (out.issued_at !== undefined && out.due_at !== undefined && out.due_at < out.issued_at) {
    return fail('The due date cannot be before the invoice date');
  }
  return ok(out);
}
