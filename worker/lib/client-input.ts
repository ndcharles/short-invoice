import {
  CLIENT_STATUSES,
  CYCLES,
  INVOICE_WHEN,
  JOB_STATUSES,
  LOOKS_AFTER,
  SERVICE_KINDS,
  parseDays,
  type ClientStatus,
  type Cycle,
  type InvoiceWhen,
  type JobStatus,
  type ServiceKind,
  type ServiceMeta,
  type TypeKind,
} from '../../src/lib/clients';
import { round2 } from '../../src/lib/invoices';
import { LIMITS, parseEmail, parseMultiline, parseNumber, parseText, type Result } from '../../src/lib/validate';

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

type Collector<T> = { out: Partial<T>; errors: (string | null)[] };

function collector<T>(): Collector<T> & {
  check: <V>(res: Result<V>, apply: (value: V) => void) => void;
} {
  const errors: (string | null)[] = [];
  return {
    out: {},
    errors,
    check(res, apply) {
      if (!res.ok) errors.push(res.error);
      else apply(res.value);
    },
  };
}

export interface ClientInput {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  whatsapp: boolean;
  website: string;
  status: ClientStatus;
  tags: string[];
  notes: string;
  service_notes: string;
  logins: string;
  billing_address: string;
  tax_id: string;
}

/** Validates a client create/update payload. Keys are present only when supplied. */
export function parseClientInput(body: Record<string, unknown>): Result<Partial<ClientInput>> {
  const c = collector<ClientInput>();
  const text = (key: keyof ClientInput, label: string, max: number = LIMITS.shortText) => {
    if (has(body, key)) c.check(parseText(body[key] ?? '', label, max), (v) => ((c.out as Record<string, unknown>)[key] = v ?? ''));
  };
  const multi = (key: keyof ClientInput, label: string) => {
    if (has(body, key)) c.check(parseMultiline(body[key] ?? '', label), (v) => ((c.out as Record<string, unknown>)[key] = v ?? ''));
  };
  text('name', 'Client name');
  text('contact_name', 'Contact person');
  if (has(body, 'email')) c.check(parseEmail(body.email ?? '', 'Email'), (v) => (c.out.email = v ?? ''));
  text('phone', 'Phone', 40);
  if (has(body, 'whatsapp')) c.out.whatsapp = body.whatsapp === true;
  text('website', 'Main website or domain', 253);
  if (has(body, 'status')) c.check(oneOf(body.status, CLIENT_STATUSES, 'client status'), (v) => (c.out.status = v));
  if (has(body, 'tags')) {
    if (!Array.isArray(body.tags) || body.tags.length > 20) c.errors.push('Tags must be a list of up to 20 names');
    else {
      const tags: string[] = [];
      for (const tag of body.tags) {
        const res = parseText(tag, 'Tag', LIMITS.name);
        if (!res.ok) c.errors.push(res.error);
        else if (res.value && !tags.some((t) => t.toLowerCase() === res.value!.toLowerCase())) tags.push(res.value);
      }
      c.out.tags = tags;
    }
  }
  multi('notes', 'Notes');
  multi('service_notes', 'Service notes');
  text('logins', 'Where the logins are kept');
  multi('billing_address', 'Billing address');
  text('tax_id', 'Tax ID', 60);
  const error = c.errors.find((e) => e !== null);
  return error ? fail(error) : ok(c.out);
}

export interface ServiceInput {
  type_id: string;
  name: string;
  kind: ServiceKind;
  details: string;
  meta: ServiceMeta;
  cycle: Cycle;
  next_date: number | null;
  price: number;
  quantity: number;
  currency: string;
  job_status: JobStatus;
  invoice_when: InvoiceWhen | '';
}

const META_TEXT: (keyof ServiceMeta)[] = ['built_with', 'registrar', 'provider', 'plan', 'mailboxes'];

/** Validates a service create/update payload. Keys are present only when supplied. */
export function parseServiceInput(body: Record<string, unknown>): Result<Partial<ServiceInput>> {
  const c = collector<ServiceInput>();
  if (has(body, 'type_id')) {
    if (typeof body.type_id !== 'string' || !/^st_[A-Za-z0-9_-]{1,40}$/.test(body.type_id)) c.errors.push('Unknown service type');
    else c.out.type_id = body.type_id;
  }
  if (has(body, 'name')) c.check(parseText(body.name ?? '', 'Service name', 80), (v) => (c.out.name = v ?? ''));
  if (has(body, 'kind')) c.check(oneOf(body.kind, SERVICE_KINDS, 'way it works'), (v) => (c.out.kind = v));
  if (has(body, 'details')) c.check(parseMultiline(body.details ?? '', 'Details'), (v) => (c.out.details = v ?? ''));
  if (has(body, 'meta')) {
    const raw = body.meta;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) c.errors.push('Service details are invalid');
    else {
      const m = raw as Record<string, unknown>;
      const meta: ServiceMeta = {};
      for (const key of META_TEXT) {
        if (m[key] === undefined) continue;
        c.check(parseText(m[key] ?? '', key.replace('_', ' '), 120), (v) => {
          if (v) (meta as Record<string, unknown>)[key] = v;
        });
      }
      if (m.looks_after !== undefined) {
        if (!Array.isArray(m.looks_after)) c.errors.push('"Looks after" must be a list');
        else meta.looks_after = (LOOKS_AFTER as readonly string[]).filter((name) => (m.looks_after as unknown[]).includes(name));
      }
      c.out.meta = meta;
    }
  }
  if (has(body, 'cycle')) c.check(oneOf(body.cycle, CYCLES, 'billing cycle'), (v) => (c.out.cycle = v));
  if (has(body, 'next_date')) c.check(parseDay(body.next_date, 'Date'), (v) => (c.out.next_date = v));
  if (has(body, 'price')) c.check(parseNumber(body.price, 'Price', { min: 0, max: MONEY_MAX, fallback: 0 }), (v) => (c.out.price = round2(v)));
  if (has(body, 'quantity')) c.check(parseNumber(body.quantity, 'Quantity', { min: 0, max: 1e7, fallback: 1 }), (v) => (c.out.quantity = v));
  if (has(body, 'currency')) {
    if (typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency.trim())) c.out.currency = body.currency.trim().toUpperCase();
    else c.errors.push('Currency must be a 3-letter code such as NGN');
  }
  if (has(body, 'job_status')) c.check(oneOf(body.job_status, JOB_STATUSES, 'job status'), (v) => (c.out.job_status = v));
  if (has(body, 'invoice_when')) {
    if (body.invoice_when === '') c.out.invoice_when = '';
    else c.check(oneOf(body.invoice_when, INVOICE_WHEN, 'invoice choice'), (v) => (c.out.invoice_when = v));
  }
  const error = c.errors.find((e) => e !== null);
  return error ? fail(error) : ok(c.out);
}

export interface ServiceTypeInput {
  name: string;
  kind: TypeKind;
  cycle: Cycle;
  price: number;
  price_unit: 'once' | 'each';
  reminder_days: string;
  invoice_when: InvoiceWhen | '';
  show_in_add: boolean;
}

/** Validates a service type create/update payload. Keys are present only when supplied. */
export function parseServiceTypeInput(body: Record<string, unknown>): Result<Partial<ServiceTypeInput>> {
  const c = collector<ServiceTypeInput>();
  if (has(body, 'name')) c.check(parseText(body.name ?? '', 'Name', 60), (v) => (c.out.name = v ?? ''));
  if (has(body, 'kind')) c.check(oneOf(body.kind, [...SERVICE_KINDS, 'any'] as const, 'way it works'), (v) => (c.out.kind = v));
  if (has(body, 'cycle')) c.check(oneOf(body.cycle, CYCLES, 'billing cycle'), (v) => (c.out.cycle = v));
  if (has(body, 'price')) c.check(parseNumber(body.price, 'Default price', { min: 0, max: MONEY_MAX, fallback: 0 }), (v) => (c.out.price = round2(v)));
  if (has(body, 'price_unit')) c.check(oneOf(body.price_unit, ['once', 'each'] as const, 'price unit'), (v) => (c.out.price_unit = v));
  if (has(body, 'reminder_days')) {
    if (typeof body.reminder_days !== 'string') c.errors.push('Reminder days must be text such as "7,1"');
    else c.out.reminder_days = parseDays(body.reminder_days).join(',');
  }
  if (has(body, 'invoice_when')) {
    if (body.invoice_when === '') c.out.invoice_when = '';
    else c.check(oneOf(body.invoice_when, INVOICE_WHEN, 'invoice choice'), (v) => (c.out.invoice_when = v));
  }
  if (has(body, 'show_in_add')) c.out.show_in_add = body.show_in_add !== false;
  const error = c.errors.find((e) => e !== null);
  return error ? fail(error) : ok(c.out);
}
