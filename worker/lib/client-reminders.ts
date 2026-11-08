import type { Env } from '../env';
import {
  clientRules,
  daysUntil,
  parseMeta,
  visitChecklist,
  draftDateFor,
  reminderDaysFor,
  renewalLine,
  type ClientRow,
  type ServiceRow,
  type ServiceTypeRow,
} from '../../src/lib/clients';
import { fmtMoney } from '../../src/lib/invoices';
import { formatDate, startOfDay } from '../../src/lib/dates';
import { getSettings } from './settings';
import { listOf, type CurrentUser } from './auth';
import { draftInvoiceStatements } from './invoice-create';
import { activity } from './activity';
import { mailSetup, isMailAddress } from './invoice-mail';
import { decryptSecret } from './secrets';
import { sendMail, SmtpError } from './smtp';

/** Most invoices one daily run drafts, so a big backlog cannot blow the CPU budget in one go. */
const MAX_DRAFTS_PER_RUN = 15;

/** Who the daily run's own changes are credited to in the activity feed. */
const DAILY_RUN: CurrentUser = { email: 'reminders', name: 'Daily reminders', role: 'admin', owner: false, initials: 'DR' };

type Row = ServiceRow & { client_name: string; client_email: string; client_website: string; client_address: string; reminder_days: string | null };

export interface ReminderLine {
  service_id: string;
  client: string;
  text: string;
  days_before: number;
  for_date: number;
}

export interface DailyRunResult {
  reminders: ReminderLine[];
  drafted: { invoice: string; client: string; service: string }[];
  email: 'sent' | 'off' | 'nothing' | 'not set up' | 'failed';
  error?: string;
}

/**
 * The once-a-day job (cron, see wrangler.jsonc): emails the team today's reminders and drafts the
 * invoices that are due to be drafted. Reminders are only for the team, never the client.
 *
 * Every reminder is written to `service_reminders` once it is emailed, so running twice in a day (the
 * cron and the "Send today's reminders now" button) never sends the same reminder again.
 */
export async function dailyRun(env: Env, now = Date.now()): Promise<DailyRunResult> {
  const db = env.DB;
  const settings = await getSettings(db);
  const rules = clientRules(settings);
  const today = startOfDay(now);
  const fmt = (ms: number) => formatDate(ms, settings.date_format);

  const { results } = await db
    .prepare(
      `SELECT s.*, c.name AS client_name, c.email AS client_email, c.website AS client_website, c.billing_address AS client_address,
        t.reminder_days FROM client_services s
       JOIN clients c ON c.id = s.client_id
       LEFT JOIN service_types t ON t.id = s.type_id
       WHERE s.ended_at IS NULL AND s.next_date IS NOT NULL AND c.archived = 0 AND c.status != 'past'
       ORDER BY s.next_date`
    )
    .all<Row>();

  // 1. Invoices drafted ahead of the date (renewals and monthly plans), once per date.
  const drafted: DailyRunResult['drafted'] = [];
  if (rules.autoDraft) {
    for (const s of results) {
      if (drafted.length >= MAX_DRAFTS_PER_RUN) break;
      const draftOn = draftDateFor(s, rules);
      if (draftOn === null || draftOn > today || s.invoiced_for === s.next_date || !(Number(s.price) > 0)) continue;
      const client = { id: s.client_id, name: s.client_name, email: s.client_email, billing_address: s.client_address } as ClientRow;
      const draft = await draftInvoiceStatements(db, settings, null, {
        client,
        serviceId: s.id,
        items: [{ name: renewalLine(s, s.client_website, s.next_date as number, fmt).slice(0, 200), desc: s.details.slice(0, 2000), qty: 1, unitPrice: Number(s.price) }],
        currency: s.currency,
      }, now);
      if (!draft) break;
      await db.batch([
        ...draft.statements,
        db.prepare('UPDATE client_services SET invoice_id = ?1, invoiced_for = ?2, updated_at = ?3 WHERE id = ?4').bind(draft.id, s.next_date, now, s.id),
        activity(db, DAILY_RUN, { action: 'created', type: 'invoice', id: draft.id, label: draft.number, detail: `${s.client_name} · ${s.name} · ${fmtMoney(Number(s.price), s.currency)} (draft)` }, now),
      ]);
      settings.inv_next_number = String(draft.advanceTo);
      drafted.push({ invoice: draft.number, client: s.client_name, service: s.name });
    }
  }

  // 2. Today's reminders: the days before each date, the visit day itself, then every few days once overdue.
  const due: ReminderLine[] = [];
  for (const s of results) {
    const date = s.next_date as number;
    const left = daysUntil(date, now);
    const days = reminderDaysFor(s, { reminder_days: s.reminder_days ?? '' } as Pick<ServiceTypeRow, 'reminder_days'>, rules);
    const steps = s.kind === 'visits' ? visitChecklist(parseMeta(s.meta), settings).length : 0;
    const what = s.kind === 'job' ? 'is due' : s.kind === 'visits' ? `is scheduled${steps ? ` (${steps} steps)` : ''}` : 'renews';
    if (left >= 0 && days.includes(left)) {
      const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days (${fmt(date)})`;
      due.push({ service_id: s.id, client: s.client_name, text: `${s.name} ${what} ${when}`, days_before: left, for_date: date });
    } else if (left < 0 && rules.overdueEvery > 0 && -left % rules.overdueEvery === 0) {
      due.push({ service_id: s.id, client: s.client_name, text: `${s.name} is overdue by ${-left} days (was due ${fmt(date)})`, days_before: left, for_date: date });
    }
  }
  // Notes with a "remind me on" date that has come, until someone ticks them done.
  const { results: notes } = await db
    .prepare(
      `SELECT n.id, n.text, n.remind_at, c.name AS client_name FROM client_notes n JOIN clients c ON c.id = n.client_id
       WHERE n.remind_at IS NOT NULL AND n.done = 0 AND n.remind_at <= ?1 AND c.archived = 0 ORDER BY n.remind_at`
    )
    .bind(today)
    .all<{ id: string; text: string; remind_at: number; client_name: string }>();
  for (const n of notes) {
    const first = n.text.split('\n')[0];
    due.push({ service_id: n.id, client: n.client_name, text: `Note: ${first.length > 140 ? `${first.slice(0, 140)}…` : first}`, days_before: 0, for_date: n.remind_at });
  }
  if (!due.length) return { reminders: [], drafted, email: 'nothing' };

  const already = await db.batch(
    due.map((r) => db.prepare('SELECT 1 FROM service_reminders WHERE service_id = ?1 AND for_date = ?2 AND days_before = ?3').bind(r.service_id, r.for_date, r.days_before))
  );
  const fresh = due.filter((_, i) => !already[i].results.length);
  if (!fresh.length) return { reminders: [], drafted, email: 'nothing' };
  if (settings.clients_reminders_on === 'false') return { reminders: fresh, drafted, email: 'off' };

  const to = (settings.clients_reminder_emails ? listOf(settings.clients_reminder_emails) : listOf(env.ADMIN_EMAILS)).filter(isMailAddress).slice(0, 10);
  settings.smtp_password = await decryptSecret(env, settings.smtp_password);
  const setup = mailSetup(settings);
  if (!setup.ok || !to.length) return { reminders: fresh, drafted, email: 'not set up', error: setup.ok ? 'No one to send reminders to' : setup.error };

  try {
    await sendMail(setup.value.smtp, {
      from: setup.value.from,
      to,
      cc: [],
      bcc: [],
      subject: reminderSubject(fresh, today, fmt),
      text: reminderText(fresh, drafted, settings.workspace_name || 'your workspace'),
      attachments: [],
    });
  } catch (err) {
    const error = err instanceof SmtpError ? err.message : 'Could not reach the mail server';
    console.error('Reminder email failed', err);
    return { reminders: fresh, drafted, email: 'failed', error };
  }
  await db.batch(
    fresh.map((r) =>
      db.prepare('INSERT OR IGNORE INTO service_reminders (service_id, for_date, days_before, sent_at) VALUES (?1, ?2, ?3, ?4)').bind(r.service_id, r.for_date, r.days_before, now)
    )
  );
  return { reminders: fresh, drafted, email: 'sent' };
}

export function reminderSubject(lines: ReminderLine[], today: number, fmt: (ms: number) => string): string {
  const overdue = lines.filter((l) => l.days_before < 0).length;
  const parts = [`${lines.length} ${lines.length === 1 ? 'reminder' : 'reminders'}`];
  if (overdue) parts.push(`${overdue} overdue`);
  return `Client reminders for ${fmt(today)}: ${parts.join(', ')}`;
}

export function reminderText(lines: ReminderLine[], drafted: DailyRunResult['drafted'], workspace: string): string {
  const byClient = new Map<string, string[]>();
  for (const line of [...lines].sort((a, b) => a.days_before - b.days_before)) {
    byClient.set(line.client, [...(byClient.get(line.client) ?? []), line.text]);
  }
  const out = [`Here is what needs attention today in ${workspace}.`, ''];
  for (const [client, texts] of byClient) {
    out.push(client);
    for (const text of texts) out.push(`  - ${text}`);
    out.push('');
  }
  if (drafted.length) {
    out.push('Draft invoices created for you to review and send:');
    for (const d of drafted) out.push(`  - ${d.invoice}: ${d.client}, ${d.service}`);
    out.push('');
  }
  out.push('Open Clients → Due dates in the app to renew, mark schedules done or deliver jobs.');
  out.push('These reminders are for your team only. Nothing was sent to your clients.');
  return out.join('\n');
}
