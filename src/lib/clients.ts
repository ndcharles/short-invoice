/**
 * Client tracker rules shared by the Worker and the UI (no runtime imports).
 *
 * Every service a client has works one of three ways:
 *  - renews:  it comes back on a date (`next_date`) and you bill for it again (domain, hosting, email, SSL).
 *  - visits:  the same checklist on a schedule; `next_date` is the next visit (maintenance plan).
 *  - job:     done once; `next_date` is the due date, `job_status` moves to delivered (LMS setup, certificates).
 * Dates are UTC midnights in epoch ms, like invoice dates.
 */

import { startOfDay } from './dates';

export type ServiceKind = 'renews' | 'visits' | 'job';
export type TypeKind = ServiceKind | 'any';
export type Cycle = 'yearly' | 'monthly' | 'once';
export type JobStatus = 'not_started' | 'in_progress' | 'delivered';
export type ClientStatus = 'prospect' | 'active' | 'past';
export type InvoiceWhen = 'delivered' | 'start' | 'none';
export type Part = 'website' | 'domain' | 'hosting' | 'email' | 'maintenance' | 'ssl' | 'other';

export const SERVICE_KINDS: ServiceKind[] = ['renews', 'visits', 'job'];
export const CYCLES: Cycle[] = ['yearly', 'monthly', 'once'];
export const JOB_STATUSES: JobStatus[] = ['not_started', 'in_progress', 'delivered'];
export const CLIENT_STATUSES: ClientStatus[] = ['prospect', 'active', 'past'];
export const INVOICE_WHEN: InvoiceWhen[] = ['delivered', 'start', 'none'];
/** The parts on the Log a client form, in order. Website, domain and hosting sit together. */
export const FORM_PARTS: Part[] = ['website', 'domain', 'hosting', 'email', 'maintenance'];

export const KIND_LABEL: Record<TypeKind, string> = {
  renews: 'Renews',
  visits: 'Visits',
  job: 'One-off job',
  any: 'You choose',
};
export const KIND_HELP: Record<ServiceKind, string> = {
  renews: 'It comes back on a date and you bill for it again.',
  visits: 'You do the same checklist on a schedule.',
  job: 'You do it once, then mark it delivered.',
};
export const CYCLE_LABEL: Record<Cycle, string> = { yearly: 'Yearly', monthly: 'Monthly', once: 'Once' };
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  delivered: 'Delivered',
};
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = { prospect: 'Prospect', active: 'Active', past: 'Past' };
export const INVOICE_WHEN_LABEL: Record<InvoiceWhen, string> = {
  delivered: 'When I mark it delivered',
  start: 'When I start it',
  none: 'I will invoice it myself',
};

export interface ServiceTypeRow {
  id: string;
  name: string;
  kind: TypeKind;
  part: Part | null;
  cycle: Cycle;
  price: number;
  price_unit: 'once' | 'each';
  reminder_days: string;
  invoice_when: string;
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
  whatsapp: number;
  website: string;
  status: ClientStatus;
  tags: string;
  notes: string;
  service_notes: string;
  logins: string;
  billing_address: string;
  tax_id: string;
  archived: number;
  created_at: number;
  updated_at: number;
  created_by?: string | null;
  updated_by?: string | null;
}

/** Part-specific details, kept as JSON in `client_services.meta`. */
export interface ServiceMeta {
  built_with?: string;
  registrar?: string;
  provider?: string;
  plan?: string;
  mailboxes?: string;
  looks_after?: string[];
}

export interface ServiceRow {
  id: string;
  client_id: string;
  type_id: string;
  name: string;
  kind: ServiceKind;
  details: string;
  meta: string;
  cycle: Cycle;
  next_date: number | null;
  price: number;
  quantity: number;
  currency: string;
  job_status: JobStatus | '';
  invoice_when: InvoiceWhen | '';
  invoice_id: string | null;
  invoiced_for: number | null;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
  created_by?: string | null;
  updated_by?: string | null;
  /** Added by the API on lists: the service type's part (website, domain, ...). */
  part?: Part | null;
}

/** A client on the Clients list, with what the list shows about their services. */
export interface ClientSummary extends ClientRow {
  services: number;
  parts: string[];
  next_date: number | null;
  next_name: string | null;
  unpaid: number;
  overdue_invoices: number;
}

/** One row on the due list (every client's active services by date). */
export interface DueRow extends ServiceRow {
  client_name: string;
}

export const LOOKS_AFTER = ['Website', 'Hosting', 'Domain', 'Email', 'Other'] as const;

export function parseMeta(value: string | null | undefined): ServiceMeta {
  try {
    const meta = JSON.parse(value || '{}');
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as ServiceMeta) : {};
  } catch {
    return {};
  }
}

export function parseTags(value: string | null | undefined): string[] {
  try {
    const tags = JSON.parse(value || '[]');
    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** "60, 30, 14, 7" → [60, 30, 14, 7]: whole days 0-730, largest first, no repeats. */
export function parseDays(value: string | null | undefined): number[] {
  const days = String(value ?? '')
    .split(/[,\s]+/)
    .filter((part) => /^\d+$/.test(part))
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 730);
  return Array.from(new Set(days)).sort((a, b) => b - a);
}

export const DAY_MS = 86_400_000;

/** The same calendar day `n` cycles later (31 Jan + 1 month = 28/29 Feb; 29 Feb + 1 year = 28 Feb). */
export function addCycle(date: number, cycle: Cycle, n = 1): number {
  if (cycle === 'once') return date;
  const d = new Date(date);
  const year = d.getUTCFullYear() + (cycle === 'yearly' ? n : 0);
  const month = d.getUTCMonth() + (cycle === 'monthly' ? n : 0);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay));
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

/** Workspace defaults the schedule depends on (Settings → Clients). */
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

/** The reminder days for one service: its type's own list, else the workspace list for its kind. */
export function reminderDaysFor(service: Pick<ServiceRow, 'kind'>, type: Pick<ServiceTypeRow, 'reminder_days'> | null, rules: ClientRules): number[] {
  if (service.kind === 'visits') return [0];
  const own = type ? parseDays(type.reminder_days) : [];
  if (own.length) return own;
  return service.kind === 'job' ? rules.jobDays : rules.renewDays;
}

/** When the renewal invoice for this date is drafted, or null when none is drafted ahead (jobs). */
export function draftDateFor(service: Pick<ServiceRow, 'kind' | 'cycle' | 'next_date'>, rules: ClientRules): number | null {
  if (service.next_date === null || service.kind === 'job') return null;
  const days = service.cycle === 'monthly' ? rules.draftMonthly : rules.draftYearly;
  return service.next_date - days * DAY_MS;
}

/** When a job's invoice is drafted, from the job's own choice or the workspace default. */
export function jobInvoiceWhen(service: Pick<ServiceRow, 'invoice_when'>, type: Pick<ServiceTypeRow, 'invoice_when'> | null, rules: ClientRules): InvoiceWhen {
  const own = service.invoice_when || type?.invoice_when || '';
  return (INVOICE_WHEN as string[]).includes(own) ? (own as InvoiceWhen) : rules.jobInvoice;
}

export interface ComingUp {
  date: number;
  service_id: string;
  kind: 'reminder' | 'draft' | 'visit' | 'due';
  text: string;
}

/** What happens next for these services, in date order: reminders, invoice drafts, visits and due dates. */
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
    if (s.ended_at || s.next_date === null) continue;
    const date = s.next_date;
    if (s.kind === 'visits') {
      out.push({ date, service_id: s.id, kind: 'visit', text: `Visit due: ${s.name}` });
    } else {
      for (const d of reminderDaysFor(s, types.get(s.type_id) ?? null, rules)) {
        const at = date - d * DAY_MS;
        if (at < today || d === 0) continue;
        const word = s.kind === 'job' ? 'is due' : 'renews';
        out.push({ date: at, service_id: s.id, kind: 'reminder', text: `Reminder: ${s.name} ${word} in ${d} ${d === 1 ? 'day' : 'days'}` });
      }
      out.push({ date, service_id: s.id, kind: 'due', text: s.kind === 'job' ? `${s.name} is due` : `${s.name} renews` });
    }
    const draft = draftDateFor(s, rules);
    if (rules.autoDraft && draft !== null && draft >= today && s.invoiced_for !== date && s.price > 0) {
      out.push({ date: draft, service_id: s.id, kind: 'draft', text: `Draft invoice for ${s.name}` });
    }
  }
  return out.sort((a, b) => a.date - b.date).slice(0, limit);
}

/** The words on a renewal invoice line: "Domain renewal: example.com, 14 Mar 2027 to 13 Mar 2028". */
export function renewalLine(service: Pick<ServiceRow, 'name' | 'kind' | 'cycle'>, website: string, from: number, fmt: (ms: number) => string): string {
  const what = website ? `${service.name}: ${website}` : service.name;
  if (service.kind === 'job') return what;
  const to = addCycle(from, service.cycle) - DAY_MS;
  if (service.kind === 'visits') return `${what}, ${fmt(from)} to ${fmt(to)}`;
  return `${service.name} renewal${website ? `: ${website}` : ''}, ${fmt(from)} to ${fmt(to)}`;
}

/** A note on a client's page; `remind_at` puts it in that morning's reminder email until it is done. */
export interface ClientNote {
  id: string;
  client_id: string;
  at: number;
  author: string;
  text: string;
  remind_at: number | null;
  done: number;
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
 * The steps for one maintenance visit, from what the plan looks after: website and hosting steps, domain and email
 * steps, or both. A plan that ticks nothing gets the website steps.
 */
export function visitChecklist(meta: ServiceMeta, settings: Record<string, string | undefined>): string[] {
  const looks = meta.looks_after ?? [];
  const site = looks.some((l) => l === 'Website' || l === 'Hosting');
  const mail = looks.some((l) => l === 'Domain' || l === 'Email');
  const steps: string[] = [];
  if (site || !mail) steps.push(...stringList(settings.clients_checklist_site, DEFAULT_CHECKLIST_SITE));
  if (mail) steps.push(...stringList(settings.clients_checklist_mail, DEFAULT_CHECKLIST_MAIL));
  return steps;
}
