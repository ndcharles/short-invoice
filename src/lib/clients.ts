/**
 * Client tracker rules shared by the Worker and the UI (no runtime imports).
 *
 * A client's service has up to two dates:
 *  - `due_at`:  when the work itself is due (a build, a setup, a one-off job). Its `status` moves from Not started
 *               to In progress to Delivered (or Cancelled).
 *  - `next_at`: the next renewal (`recurs = 'renews'`) or scheduled date (`recurs = 'scheduled'`, maintenance),
 *               repeating monthly, quarterly or yearly.
 * Website and Email have both (the work, then a yearly renewal); Maintenance and the other types pick one way:
 * Renews, Scheduled or One-off. What a service includes (domain, hosting, ...) is a list of parts with providers.
 * Dates are UTC midnights in epoch ms, like invoice dates.
 */

import { startOfDay } from './dates';
import { joinAddress } from './invoices';

export type Recurs = 'renews' | 'scheduled';
export type Mode = Recurs | 'oneoff';
export type Repeats = 'monthly' | 'quarterly' | 'yearly';
export type Status = 'not_started' | 'in_progress' | 'delivered' | 'cancelled';
export type ClientStatus = 'prospect' | 'active' | 'past';
export type InvoiceWhen = 'delivered' | 'start' | 'none';
/** What a service can include (or, for maintenance, look after). */
export type PartName = 'website' | 'domain' | 'hosting' | 'email' | 'other';
/** The built-in service types; custom types have none. */
export type TypePart = 'website' | 'email' | 'maintenance' | 'other';

export const MODES: Mode[] = ['renews', 'scheduled', 'oneoff'];
export const REPEATS: Repeats[] = ['monthly', 'quarterly', 'yearly'];
export const STATUSES: Status[] = ['not_started', 'in_progress', 'delivered', 'cancelled'];
export const CLIENT_STATUSES: ClientStatus[] = ['prospect', 'active', 'past'];
export const INVOICE_WHEN: InvoiceWhen[] = ['delivered', 'start', 'none'];
export const PART_NAMES: PartName[] = ['website', 'domain', 'hosting', 'email', 'other'];

export const MODE_LABEL: Record<Mode, string> = { renews: 'Renews', scheduled: 'Scheduled', oneoff: 'One-off' };
export const REPEATS_LABEL: Record<Repeats, string> = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
export const PER_LABEL: Record<Repeats, string> = { monthly: '/ month', quarterly: '/ quarter', yearly: '/ year' };
export const STATUS_LABEL: Record<Status, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
export const PART_LABEL: Record<PartName, string> = { website: 'Website', domain: 'Domain', hosting: 'Hosting', email: 'Email', other: 'Other' };
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = { prospect: 'Prospect', active: 'Active', past: 'Past' };
export const INVOICE_WHEN_LABEL: Record<InvoiceWhen, string> = {
  delivered: 'When I mark it delivered',
  start: 'When I start it',
  none: 'I will invoice it myself',
};

/** The ticks each type offers under Includes (Looks after, for maintenance). */
export function includesFor(part: TypePart | null): PartName[] {
  if (part === 'website') return ['website', 'domain', 'hosting', 'other'];
  if (part === 'email') return ['domain', 'other'];
  return PART_NAMES;
}

/** The ways a type can work: Website and Email have a fixed shape; maintenance is scheduled or one-off. */
export function modesFor(part: TypePart | null): Mode[] {
  if (part === 'website' || part === 'email') return [];
  if (part === 'maintenance') return ['scheduled', 'oneoff'];
  return MODES;
}

export interface ServiceTypeRow {
  id: string;
  name: string;
  part: TypePart | null;
  price: number;
  price_unit: 'once' | 'each';
  reminder_days: string;
  show_in_add: number;
  sort: number;
  created_at: number;
  updated_at: number;
  /** Added by the API: how many services use it. */
  used?: number;
}

export interface ClientRow {
  id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  /** The phone number is also on WhatsApp. */
  whatsapp: number;
  /** A separate WhatsApp number, used when `whatsapp` is 0. */
  whatsapp_number: string;
  website: string;
  status: ClientStatus;
  notes: string;
  service_notes: string;
  logins: string;
  /** Billing details, laid out like an invoice's "Invoiced To". */
  address_street: string;
  address_city: string;
  address_country: string;
  tax_id: string;
  archived: number;
  created_at: number;
  updated_at: number;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface ServicePart {
  part: PartName;
  provider: string;
  count: number | null;
}

export interface ServiceRow {
  id: string;
  client_id: string;
  type_id: string;
  name: string;
  details: string;
  recurs: Recurs | null;
  repeats: Repeats;
  next_at: number | null;
  due_at: number | null;
  status: Status;
  amount: number;
  quantity: number;
  currency: string;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
  created_by?: string | null;
  updated_by?: string | null;
  /** Added by the API. */
  parts?: ServicePart[];
  type_part?: TypePart | null;
  /** Added by the API: the dates that already have an invoice ("due" for the work itself). */
  invoiced?: (number | 'due')[];
}

/** A client on the Clients list. */
export interface ClientSummary extends ClientRow {
  service_names: string[];
  next_date: number | null;
  next_what: string | null;
  unpaid: number;
  overdue_invoices: number;
}

/** One row on the Due dates page: a service's work due date, or its renewal / scheduled date. */
export interface DueRow {
  service: ServiceRow;
  client_name: string;
  date: number;
  what: 'due' | Recurs;
}

export interface ClientNote {
  id: string;
  client_id: string;
  at: number;
  author: string;
  text: string;
  remind_at: number | null;
  done: number;
}

/** How a service works, for the forms. */
export const modeOf = (s: Pick<ServiceRow, 'recurs'>): Mode => s.recurs ?? 'oneoff';

/** The work is still open (its due date matters). */
export const workOpen = (s: Pick<ServiceRow, 'status'>) => s.status === 'not_started' || s.status === 'in_progress';
/** Still with us: not cancelled and not ended. */
export const isActive = (s: Pick<ServiceRow, 'status' | 'ended_at'>) => s.status !== 'cancelled' && !s.ended_at;

/** "60, 30, 14, 7" → [60, 30, 14, 7]: whole days 0-730, largest first, no repeats. */
export function parseDays(value: string | null | undefined): number[] {
  const days = String(value ?? '')
    .split(/[,\s]+/)
    .filter((part) => /^\d+$/.test(part))
    .map((part) => Number(part))
    .filter((n) => n <= 730);
  return Array.from(new Set(days)).sort((a, b) => b - a);
}

export const DAY_MS = 86_400_000;
const MONTHS: Record<Repeats, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** The same calendar day one period later (31 Jan + 1 month = 28/29 Feb; 29 Feb + 1 year = 28 Feb). */
export function addPeriod(date: number, repeats: Repeats, n = 1): number {
  const d = new Date(date);
  const month = d.getUTCMonth() + MONTHS[repeats] * n;
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Date.UTC(d.getUTCFullYear(), month, Math.min(d.getUTCDate(), lastDay));
}

/** Whole days from today to `date` (negative once it has passed). */
export function daysUntil(date: number, now = Date.now()): number {
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
}

export type DueBucket = 'overdue' | 'week' | 'month' | 'later';

export function dueBucket(date: number, now = Date.now()): DueBucket {
  const days = daysUntil(date, now);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'later';
}

/** "Overdue 5 days", "Today", "Tomorrow", "in 18 days". */
export function countdown(date: number, now = Date.now()): string {
  const days = daysUntil(date, now);
  if (days < -1) return `Overdue ${-days} days`;
  if (days === -1) return 'Overdue 1 day';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days} days`;
}

/** The dates a service puts on the Due dates page: the open work, then the renewal or schedule. */
export function datesOf(s: Pick<ServiceRow, 'due_at' | 'next_at' | 'recurs' | 'status' | 'ended_at'>): { date: number; what: 'due' | Recurs }[] {
  if (!isActive(s)) return [];
  const out: { date: number; what: 'due' | Recurs }[] = [];
  if (s.due_at !== null && workOpen(s)) out.push({ date: s.due_at, what: 'due' });
  if (s.next_at !== null && s.recurs) out.push({ date: s.next_at, what: s.recurs });
  return out;
}

/** Workspace defaults the reminders depend on (Settings → Clients). */
export interface ClientRules {
  renewDays: number[];
  jobDays: number[];
  overdueEvery: number;
  draftYearly: number;
  draftMonthly: number;
  jobInvoice: InvoiceWhen;
  autoDraft: boolean;
}

export const CLIENT_SETTING_DEFAULTS = {
  clients_reminder_days: '60,30,14,7',
  clients_job_reminder_days: '7,1',
  clients_overdue_every: '3',
  clients_draft_days_yearly: '30',
  clients_draft_days_monthly: '5',
  clients_job_invoice: 'delivered',
  clients_auto_draft: 'true',
  clients_reminder_emails: '',
  clients_reminders_on: 'true',
} as const;

export function clientRules(settings: Record<string, string | undefined>): ClientRules {
  const get = (key: keyof typeof CLIENT_SETTING_DEFAULTS) => settings[key] ?? CLIENT_SETTING_DEFAULTS[key];
  const int = (key: keyof typeof CLIENT_SETTING_DEFAULTS, max: number) => {
    const n = Math.floor(Number(get(key)));
    return Number.isFinite(n) && n >= 0 && n <= max ? n : Number(CLIENT_SETTING_DEFAULTS[key]);
  };
  const job = get('clients_job_invoice');
  return {
    renewDays: parseDays(get('clients_reminder_days')),
    jobDays: parseDays(get('clients_job_reminder_days')),
    overdueEvery: int('clients_overdue_every', 60),
    draftYearly: int('clients_draft_days_yearly', 365),
    draftMonthly: int('clients_draft_days_monthly', 28),
    jobInvoice: (INVOICE_WHEN as string[]).includes(job) ? (job as InvoiceWhen) : 'delivered',
    autoDraft: get('clients_auto_draft') !== 'false',
  };
}

/** Days before a date to remind the team: renewals use the type's own list or the workspace one. */
export function reminderDays(what: 'due' | Recurs, type: Pick<ServiceTypeRow, 'reminder_days'> | null, rules: ClientRules): number[] {
  if (what === 'scheduled') return [0];
  if (what === 'due') return rules.jobDays;
  const own = type ? parseDays(type.reminder_days) : [];
  return own.length ? own : rules.renewDays;
}

/** When the invoice for the next renewal or scheduled period is drafted, or null. */
export function draftDateFor(s: Pick<ServiceRow, 'recurs' | 'repeats' | 'next_at' | 'amount'>, rules: ClientRules): number | null {
  if (!s.recurs || s.next_at === null || !(s.amount > 0)) return null;
  return s.next_at - (s.repeats === 'yearly' ? rules.draftYearly : rules.draftMonthly) * DAY_MS;
}

export interface ComingUp {
  date: number;
  service_id: string;
  kind: 'reminder' | 'draft' | 'scheduled' | 'due' | 'renews';
  text: string;
}

/** What happens next for these services, in date order: reminders, invoice drafts, schedules and due dates. */
export function comingUp(
  services: ServiceRow[],
  types: Map<string, Pick<ServiceTypeRow, 'reminder_days'>>,
  rules: ClientRules,
  now = Date.now(),
  limit = 12
): ComingUp[] {
  const today = startOfDay(now);
  const out: ComingUp[] = [];
  for (const s of services) {
    for (const { date, what } of datesOf(s)) {
      if (what === 'scheduled') {
        out.push({ date, service_id: s.id, kind: 'scheduled', text: `Scheduled: ${s.name}` });
        continue;
      }
      const word = what === 'due' ? 'is due' : 'renews';
      for (const d of reminderDays(what, types.get(s.type_id) ?? null, rules)) {
        const at = date - d * DAY_MS;
        if (at >= today && d > 0) out.push({ date: at, service_id: s.id, kind: 'reminder', text: `Reminder: ${s.name} ${word} in ${d} ${d === 1 ? 'day' : 'days'}` });
      }
      out.push({ date, service_id: s.id, kind: what, text: `${s.name} ${word}` });
    }
    const draft = isActive(s) ? draftDateFor(s, rules) : null;
    if (rules.autoDraft && draft !== null && draft >= today && !(s.invoiced ?? []).includes(s.next_at as number)) {
      out.push({ date: draft, service_id: s.id, kind: 'draft', text: `Draft invoice for ${s.name}` });
    }
  }
  return out.sort((a, b) => a.date - b.date).slice(0, limit);
}

/** "Website (domain, hosting)": the service and what it includes beyond itself. */
export function serviceLabel(s: Pick<ServiceRow, 'name' | 'parts' | 'type_part'>): string {
  const extra = (s.parts ?? [])
    .filter((p) => !(s.type_part === 'website' && p.part === 'website') && !(s.type_part === 'email' && p.part === 'email'))
    .map((p) => (p.part === 'other' && p.provider ? p.provider : PART_LABEL[p.part].toLowerCase()));
  return extra.length ? `${s.name} (${extra.join(', ')})` : s.name;
}

/** The words on an invoice line for a renewal or scheduled period: "Website renewal: example.com, 14 Mar 2027 to 13 Mar 2028". */
export function periodLine(s: Pick<ServiceRow, 'name' | 'recurs' | 'repeats' | 'parts' | 'type_part'>, website: string, from: number, fmt: (ms: number) => string): string {
  const to = addPeriod(from, s.repeats) - DAY_MS;
  const label = serviceLabel(s);
  if (s.recurs === 'scheduled') return `${label}${website ? `: ${website}` : ''}, ${fmt(from)} to ${fmt(to)}`;
  return `${label} renewal${website ? `: ${website}` : ''}, ${fmt(from)} to ${fmt(to)}`;
}

export const DEFAULT_CHECKLIST_SITE = ['Update plugins and themes', 'Check that backups ran', 'Check uptime and page speed', 'Send the monthly report'];
export const DEFAULT_CHECKLIST_MAIL = ['Check the DNS records', 'Check mailbox space and spam settings', 'Check the domain expiry date'];

function stringList(value: string | undefined, fallback: string[]): string[] {
  try {
    const list = JSON.parse(value ?? '');
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The steps for "Mark done" on a scheduled service, from what it looks after: website and hosting steps, domain and
 * email steps, or both. A service that ticks nothing gets the website steps.
 */
export function scheduleChecklist(parts: Pick<ServicePart, 'part'>[], settings: Record<string, string | undefined>): string[] {
  const names = parts.map((p) => p.part);
  const site = names.includes('website') || names.includes('hosting');
  const mail = names.includes('domain') || names.includes('email');
  const steps: string[] = [];
  if (site || !mail) steps.push(...stringList(settings.clients_checklist_site, DEFAULT_CHECKLIST_SITE));
  if (mail) steps.push(...stringList(settings.clients_checklist_mail, DEFAULT_CHECKLIST_MAIL));
  return steps;
}

type BillingFields = Pick<ClientRow, 'name' | 'contact_name' | 'email' | 'address_street' | 'address_city' | 'address_country'>;

/** A client's "Invoiced To" block, in the invoice's own layout (name, contact, street, city, country). */
export function invoiceAddressOf(client: BillingFields): string {
  return joinAddress({
    name: client.name,
    contact: client.contact_name,
    addr1: client.address_street,
    addr2: client.address_city,
    country: client.address_country,
  });
}
