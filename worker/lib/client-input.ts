import {
  CLIENT_STATUSES,
  MODES,
  PART_NAMES,
  REPEATS,
  STATUSES,
  parseDays,
  type ClientStatus,
  type Mode,
  type PartName,
  type Repeats,
  type Status,
} from '../../src/lib/clients';
import { round2 } from '../../src/lib/invoices';
import { parseEmail, parseMultiline, parseNumber, parseText, type Result } from '../../src/lib/validate';

const fail = <T>(error: string): Result<T> => ({ ok: false, error });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const has = (body: Record<string, unknown>, key: string) => body[key] !== undefined;

// Year 2000 to 2200, like invoice dates.
const MIN_DATE = Date.UTC(2000, 0, 1);
const MAX_DATE = Date.UTC(2200, 0, 1);
const MONEY_MAX = 1e13;

function parseDay(input: unknown, label: string): Result<number | null> {
  if (input === null || input === '') return ok(null);
  const value = typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : input;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`${label} must be a date`);
  if (value < MIN_DATE || value > MAX_DATE) return fail(`${label} is out of range`);
  const d = new Date(value);
  return ok(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function oneOf<T extends string>(value: unknown, list: readonly T[], label: string): Result<T> {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? ok(value as T) : fail(`Unknown ${label}`);
}

/** Runs each check, keeps the first error, and applies the values that passed. */
function collector<T>() {
  const errors: string[] = [];
  const out: Partial<T> = {};
  return {
    out,
    errors,
    check<V>(res: Result<V>, apply: (value: V) => void) {
      if (!res.ok) errors.push(res.error);
      else apply(res.value);
    },
    result(): Result<Partial<T>> {
      return errors.length ? fail(errors[0]) : ok(out);
    },
  };
}

export interface ClientInput {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  whatsapp: boolean;
  whatsapp_number: string;
  website: string;
  status: ClientStatus;
  notes: string;
  service_notes: string;
  logins: string;
  address_street: string;
  address_city: string;
  address_country: string;
  tax_id: string;
}

const TEXT_FIELDS: [keyof ClientInput, string, number][] = [
  ['name', 'Client name', 200],
  ['contact_name', 'Contact person', 200],
  ['phone', 'Phone', 40],
  ['whatsapp_number', 'WhatsApp number', 40],
  ['website', 'Main website or domain', 253],
  ['logins', 'Where the logins are kept', 200],
  ['tax_id', 'Tax ID', 60],
  ['address_street', 'Street address', 200],
  ['address_city', 'City, State, Postal code', 200],
  ['address_country', 'Country', 100],
];
const LONG_FIELDS: [keyof ClientInput, string][] = [
  ['notes', 'Notes'],
  ['service_notes', 'Service notes'],
];

/** Validates a client create/update payload. Keys are present only when supplied. */
export function parseClientInput(body: Record<string, unknown>): Result<Partial<ClientInput>> {
  const c = collector<ClientInput>();
  const set = (key: keyof ClientInput) => (v: string | null) => ((c.out as Record<string, unknown>)[key] = v ?? '');
  for (const [key, label, max] of TEXT_FIELDS) if (has(body, key)) c.check(parseText(body[key] ?? '', label, max), set(key));
  for (const [key, label] of LONG_FIELDS) if (has(body, key)) c.check(parseMultiline(body[key] ?? '', label), set(key));
  if (has(body, 'email')) c.check(parseEmail(body.email ?? '', 'Email'), set('email'));
  if (has(body, 'whatsapp')) c.out.whatsapp = body.whatsapp === true;
  if (has(body, 'status')) c.check(oneOf(body.status, CLIENT_STATUSES, 'client status'), (v) => (c.out.status = v));
  return c.result();
}

export interface PartInput {
  part: PartName;
  provider: string;
  count: number | null;
}

export interface ServiceInput {
  type_id: string;
  name: string;
  mode: Mode;
  details: string;
  repeats: Repeats;
  next_at: number | null;
  due_at: number | null;
  status: Status;
  amount: number;
  quantity: number;
  currency: string;
  parts: PartInput[];
}

/** Validates a service create/update payload. Keys are present only when supplied. */
export function parseServiceInput(body: Record<string, unknown>): Result<Partial<ServiceInput>> {
  const c = collector<ServiceInput>();
  if (has(body, 'type_id')) {
    if (typeof body.type_id !== 'string' || !/^st_[A-Za-z0-9_-]{1,40}$/.test(body.type_id)) c.errors.push('Unknown service type');
    else c.out.type_id = body.type_id;
  }
  if (has(body, 'name')) c.check(parseText(body.name ?? '', 'Service name', 80), (v) => (c.out.name = v ?? ''));
  if (has(body, 'mode')) c.check(oneOf(body.mode, MODES, 'way it works'), (v) => (c.out.mode = v));
  if (has(body, 'details')) c.check(parseMultiline(body.details ?? '', 'Details'), (v) => (c.out.details = v ?? ''));
  if (has(body, 'repeats')) c.check(oneOf(body.repeats, REPEATS, 'repeat'), (v) => (c.out.repeats = v));
  if (has(body, 'next_at')) c.check(parseDay(body.next_at, 'Renewal or next date'), (v) => (c.out.next_at = v));
  if (has(body, 'due_at')) c.check(parseDay(body.due_at, 'Due date'), (v) => (c.out.due_at = v));
  if (has(body, 'status')) c.check(oneOf(body.status, STATUSES, 'status'), (v) => (c.out.status = v));
  if (has(body, 'amount')) c.check(parseNumber(body.amount, 'Charge', { min: 0, max: MONEY_MAX, fallback: 0 }), (v) => (c.out.amount = round2(v)));
  if (has(body, 'quantity')) c.check(parseNumber(body.quantity, 'Quantity', { min: 0, max: 1e7, fallback: 1 }), (v) => (c.out.quantity = v));
  if (has(body, 'currency')) {
    if (typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency.trim())) c.out.currency = body.currency.trim().toUpperCase();
    else c.errors.push('Currency must be a 3-letter code such as NGN');
  }
  if (has(body, 'parts')) {
    if (!Array.isArray(body.parts) || body.parts.length > PART_NAMES.length) c.errors.push('Includes must be a short list');
    else {
      const parts: PartInput[] = [];
      for (const raw of body.parts) {
        const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        c.check(oneOf(p.part, PART_NAMES, 'item under Includes'), (part) => {
          if (parts.some((x) => x.part === part)) return;
          const provider = parseText(p.provider ?? '', 'Provider', 120);
          const count = p.count === undefined || p.count === null || p.count === '' ? ok<number | null>(null) : parseNumber(p.count, 'Mailboxes', { min: 0, max: 100_000 });
          if (!provider.ok) c.errors.push(provider.error);
          else if (!count.ok) c.errors.push(count.error);
          else parts.push({ part, provider: provider.value ?? '', count: count.value === null ? null : Math.floor(count.value) });
        });
      }
      c.out.parts = parts;
    }
  }
  return c.result();
}

export interface ServiceTypeInput {
  name: string;
  price: number;
  price_unit: 'once' | 'each';
  reminder_days: string;
  show_in_add: boolean;
}

/** Validates a service type create/update payload. Keys are present only when supplied. */
export function parseServiceTypeInput(body: Record<string, unknown>): Result<Partial<ServiceTypeInput>> {
  const c = collector<ServiceTypeInput>();
  if (has(body, 'name')) c.check(parseText(body.name ?? '', 'Name', 60), (v) => (c.out.name = v ?? ''));
  if (has(body, 'price')) c.check(parseNumber(body.price, 'Default price', { min: 0, max: MONEY_MAX, fallback: 0 }), (v) => (c.out.price = round2(v)));
  if (has(body, 'price_unit')) c.check(oneOf(body.price_unit, ['once', 'each'] as const, 'price unit'), (v) => (c.out.price_unit = v));
  if (has(body, 'reminder_days')) {
    if (typeof body.reminder_days !== 'string') c.errors.push('Reminder days must be text such as "7,1"');
    else c.out.reminder_days = parseDays(body.reminder_days).join(',');
  }
  if (has(body, 'show_in_add')) c.out.show_in_add = body.show_in_add !== false;
  return c.result();
}
