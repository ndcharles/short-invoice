import { isCurrency, MANUAL_STATUSES, type InvoiceItem, type StoredStatus } from '../../src/lib/invoices';
import { LIMITS, parseEmail, parseMultiline, parseNumber, parseText, type Result } from '../../src/lib/validate';

export interface InvoiceInput {
  number?: string;
  client_name?: string;
  client_contact?: string;
  client_email?: string;
  client_address?: string;
  reference?: string;
  issued_at?: number;
  due_at?: number;
  currency?: string;
  status?: StoredStatus;
  items?: InvoiceItem[];
  discount?: number;
  discount_type?: 'value' | 'percent';
  charges?: number;
  tax_rate?: number;
  exchange_rate?: number;
  payment_method?: string;
  notes?: string;
  terms?: string;
  folder?: string | null;
  tag?: string | null;
}

export interface PaymentInput {
  amount: number;
  date: string;
  method: string;
  note: string;
}

const MAX_MONEY = 1e12;
const MIN_DATE = Date.UTC(2000, 0, 1);
const MAX_DATE = Date.UTC(2100, 0, 1);

/** Epoch ms, or a YYYY-MM-DD string (UTC midnight). */
function parseDate(value: unknown, label: string): Result<number> {
  const ms =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number(value);
  if (!Number.isFinite(ms) || ms < MIN_DATE || ms > MAX_DATE) return { ok: false, error: `${label} is not a valid date` };
  return { ok: true, value: ms };
}

function parseItems(value: unknown): Result<InvoiceItem[]> {
  if (!Array.isArray(value)) return { ok: false, error: 'Line items must be a list' };
  if (value.length > 100) return { ok: false, error: 'An invoice can have up to 100 line items' };
  const items: InvoiceItem[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: `Line ${index + 1} is invalid` };
    const item = raw as Record<string, unknown>;
    const name = parseText(item.name ?? '', `Line ${index + 1} name`, LIMITS.shortText);
    if (!name.ok) return name;
    const desc = parseMultiline(item.desc ?? '', `Line ${index + 1} description`, 1000);
    if (!desc.ok) return desc;
    const qty = parseNumber(item.qty ?? 1, `Line ${index + 1} quantity`, { min: 0, max: 1_000_000 });
    if (!qty.ok) return qty;
    const unitPrice = parseNumber(item.unitPrice ?? 0, `Line ${index + 1} price`, { min: 0, max: MAX_MONEY });
    if (!unitPrice.ok) return unitPrice;
    items.push({ name: name.value ?? '', desc: desc.value ?? '', qty: qty.value, unitPrice: unitPrice.value });
  }
  return { ok: true, value: items };
}

/**
 * Validates a create/update payload; only keys present in the body are
 * returned. Paid / partially paid cannot be set directly: they follow from
 * payments, so the status, balance and payment history can never disagree.
 */
export function parseInvoiceInput(body: Record<string, unknown>): Result<InvoiceInput> {
  const out: InvoiceInput = {};
  const has = (key: string) => body[key] !== undefined;

  const text = (key: keyof InvoiceInput, label: string, max: number, required = false): string | null => {
    if (!has(key)) return null;
    const res = parseText(body[key], label, max);
    if (!res.ok) return res.error;
    if (required && !res.value) return `${label} is required`;
    (out as Record<string, unknown>)[key] = res.value ?? '';
    return null;
  };
  const multiline = (key: keyof InvoiceInput, label: string, max: number): string | null => {
    if (!has(key)) return null;
    const res = parseMultiline(body[key], label, max);
    if (!res.ok) return res.error;
    (out as Record<string, unknown>)[key] = res.value ?? '';
    return null;
  };
  const money = (key: keyof InvoiceInput, label: string, max = MAX_MONEY): string | null => {
    if (!has(key)) return null;
    const res = parseNumber(body[key] === '' ? 0 : body[key], label, { min: 0, max });
    if (!res.ok) return res.error;
    (out as Record<string, unknown>)[key] = res.value;
    return null;
  };

  const errors: (string | null)[] = [
    text('client_name', 'Client name', 120, true),
    text('client_contact', 'Contact person', 120),
    multiline('client_address', 'Client address', 500),
    text('reference', 'Reference', 80),
    text('payment_method', 'Payment method', 60),
    multiline('notes', 'Notes', LIMITS.longText),
    multiline('terms', 'Payment terms', LIMITS.longText),
    money('discount', 'Discount'),
    money('charges', 'Additional charges'),
    money('tax_rate', 'Tax rate', 1),
    money('exchange_rate', 'Exchange rate', 10_000_000),
  ];

  if (has('number')) {
    const res = parseText(body.number, 'Invoice number', 40);
    if (!res.ok) errors.push(res.error);
    else if (!res.value || !/^[A-Za-z0-9/_.#-]+$/.test(res.value)) errors.push('Invoice number can use letters, digits and - _ / . #');
    else out.number = res.value;
  }
  if (has('client_email')) {
    const res = parseEmail(body.client_email, 'Client email');
    if (!res.ok) errors.push(res.error);
    else out.client_email = res.value ?? '';
  }
  for (const key of ['issued_at', 'due_at'] as const) {
    if (!has(key)) continue;
    const res = parseDate(body[key], key === 'issued_at' ? 'Invoice date' : 'Due date');
    if (!res.ok) errors.push(res.error);
    else out[key] = res.value;
  }
  if (has('currency')) {
    if (!isCurrency(body.currency)) errors.push('Unsupported currency');
    else out.currency = body.currency;
  }
  if (has('status')) {
    if (!MANUAL_STATUSES.includes(body.status as StoredStatus)) {
      errors.push('Status can be draft, sent or cancelled; paid and partially paid follow from logged payments');
    } else out.status = body.status as StoredStatus;
  }
  if (has('discount_type')) {
    if (body.discount_type !== 'value' && body.discount_type !== 'percent') errors.push('Discount type must be value or percent');
    else out.discount_type = body.discount_type;
  }
  if (out.discount_type === 'percent' && (out.discount ?? 0) > 100) errors.push('A percentage discount cannot exceed 100');
  if (has('items')) {
    const res = parseItems(body.items);
    if (!res.ok) errors.push(res.error);
    else out.items = res.value;
  }
  for (const key of ['folder', 'tag'] as const) {
    if (!has(key)) continue;
    const res = parseText(body[key], key === 'folder' ? 'Folder' : 'Tag', LIMITS.name);
    if (!res.ok) errors.push(res.error);
    else out[key] = res.value;
  }

  const error = errors.find((e): e is string => !!e);
  return error ? { ok: false, error } : { ok: true, value: out };
}

export function parsePaymentInput(body: Record<string, unknown>): Result<PaymentInput> {
  const amount = parseNumber(body.amount, 'Amount', { min: 0.01, max: MAX_MONEY });
  if (!amount.ok) return amount;
  const date = typeof body.date === 'string' && body.date ? body.date : new Date().toISOString().slice(0, 10);
  const parsedDate = parseDate(date, 'Payment date');
  if (!parsedDate.ok) return parsedDate;
  const method = parseText(body.method ?? '', 'Payment method', 60);
  if (!method.ok) return method;
  const note = parseMultiline(body.note ?? '', 'Note', 500);
  if (!note.ok) return note;
  return {
    ok: true,
    value: {
      amount: Math.round(amount.value * 100) / 100,
      date: new Date(parsedDate.value).toISOString().slice(0, 10),
      method: method.value ?? '',
      note: note.value ?? '',
    },
  };
}
