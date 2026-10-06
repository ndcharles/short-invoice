import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { InvoiceRow } from '../../src/lib/types';
import {
  currencyCode,
  draftTotals,
  dueDateFor,
  paidTotal,
  parseItems,
  parsePayments,
  resolveStatus,
} from '../../src/lib/invoices';
import { startOfDay } from '../../src/lib/dates';
import { getSettings, type SettingsMap } from '../lib/settings';
import { readJsonObject } from '../lib/request';
import { initials } from '../lib/initials';
import { parseInvoiceInput, type InvoiceInput } from '../lib/invoice-input';
import { DAILY_EMAIL_CAP, mailSetup, parseSendRequest } from '../lib/invoice-mail';
import { sendMail, SmtpError } from '../lib/smtp';

const invoices = new Hono<AppEnv>();

/**
 * Issued invoices become overdue the day after their due date. One UPDATE
 * that only writes rows that actually change, run before every read so lists,
 * counts and the status filter always agree.
 */
const markOverdue = (db: D1Database, now: number) =>
  db
    .prepare("UPDATE invoices SET status = 'overdue', updated_at = ?1 WHERE status = 'sent' AND due_at < ?2")
    .bind(now, startOfDay(now));

const settingOrNull = (value: string | undefined) => (!value || value === 'None' ? null : value);

/** Defaults for a new invoice, all taken from Settings → Invoice. */
function invoiceDefaults(settings: SettingsMap, now: number) {
  const methods = (() => {
    try {
      const list = JSON.parse(settings.inv_methods || '[]') as { name?: string; enabled?: boolean }[];
      return list.filter((m) => m && m.enabled !== false && m.name).map((m) => String(m.name));
    } catch {
      return [];
    }
  })();
  const taxPercent = Number(settings.inv_tax_rate);
  const issuedAt = startOfDay(now);
  return {
    issued_at: issuedAt,
    due_at: dueDateFor(issuedAt, settings.inv_payment_terms),
    currency: currencyCode(settings.inv_default_currency),
    tax_rate: Number.isFinite(taxPercent) && taxPercent >= 0 && taxPercent <= 100 ? taxPercent / 100 : 0,
    terms: settings.inv_terms_note ?? '',
    payment_method: methods.includes(settings.inv_default_method) ? settings.inv_default_method : methods[0] ?? 'Bank transfer',
    folder: settingOrNull(settings.inv_default_folder) ?? 'Invoices',
    tag: settingOrNull(settings.inv_default_tag),
  };
}

/** Totals and status derived from the merged fields; the client never sends these. */
type DerivedFrom = Required<Pick<InvoiceInput, 'items' | 'payments' | 'discount' | 'discount_type' | 'charges' | 'tax_rate' | 'due_at'>> & {
  status: string;
};

function derive(fields: DerivedFrom, now: number) {
  const totals = draftTotals({
    items: fields.items,
    discount: fields.discount,
    discountType: fields.discount_type,
    charges: fields.charges,
    taxRate: fields.tax_rate,
  });
  const status = resolveStatus({
    status: fields.status,
    grand: totals.grand,
    paid: paidTotal(fields.payments),
    dueAt: fields.due_at,
    now,
  });
  return { totals, status };
}

async function numberTaken(db: D1Database, number: string, exceptId = ''): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM invoices WHERE number = ?1 AND id != ?2 LIMIT 1').bind(number, exceptId).first();
  return !!row;
}

invoices.get('/', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const status = c.req.query('status')?.trim() || 'all';
  const folder = c.req.query('folder')?.trim() || '';
  const tag = c.req.query('tag')?.trim() || '';
  const search = c.req.query('search')?.trim().slice(0, 100) || '';

  // Filters shared by the list and the per-status counts, so the tab counts
  // always describe what the folder/tag/search would show.
  let where = '1 = 1';
  const params: unknown[] = [];
  if (folder && folder !== 'All') {
    params.push(folder);
    where += ` AND folder = ?${params.length}`;
  }
  if (tag) {
    params.push(tag);
    where += ` AND tag = ?${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (number LIKE ?${params.length} OR client_name LIKE ?${params.length} OR client_email LIKE ?${params.length})`;
  }
  let listSql = `SELECT * FROM invoices WHERE ${where}`;
  const listParams = [...params];
  if (status !== 'all') {
    listParams.push(status);
    listSql += ` AND status = ?${listParams.length}`;
  }
  listSql += ' ORDER BY issued_at DESC, created_at DESC';

  const [, rows, grouped] = await db.batch([
    markOverdue(db, now),
    db.prepare(listSql).bind(...listParams),
    db.prepare(`SELECT status, COUNT(*) AS count FROM invoices WHERE ${where} GROUP BY status`).bind(...params),
  ]);
  const list = rows.results as InvoiceRow[];
  const counts: Record<string, number> = { all: 0 };
  for (const row of grouped.results as { status: string; count: number }[]) {
    counts[row.status] = row.count;
    counts.all += row.count;
  }

  return c.json({ invoices: list, total: list.length, counts });
});

invoices.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseInvoiceInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  if (!input.client_name) return c.json({ error: 'A client name is required' }, 400);

  const db = c.env.DB;
  const now = Date.now();
  const settings = await getSettings(db);
  const defaults = invoiceDefaults(settings, now);

  // A typed number is kept as-is; otherwise the next one in the configured
  // sequence, skipping any number that is already in use.
  let advanceTo: number | null = null;
  let number = input.number || '';
  if (number) {
    if (await numberTaken(db, number)) return c.json({ error: `Invoice number ${number} is already in use` }, 409);
  } else {
    const padding = Math.min(12, Math.max(1, Number(settings.inv_number_padding) || 6));
    let next = Math.max(1, Math.floor(Number(settings.inv_next_number) || 1));
    for (let attempt = 0; attempt < 20; attempt += 1, next += 1) {
      number = `${settings.inv_number_prefix ?? ''}${String(next).padStart(padding, '0')}`;
      if (!(await numberTaken(db, number))) break;
    }
    if (await numberTaken(db, number)) {
      return c.json({ error: 'Could not find a free invoice number. Check "Next number" in Settings → Invoice.' }, 409);
    }
    advanceTo = next + 1;
  }

  const issuedAt = input.issued_at ?? defaults.issued_at;
  const fields = {
    items: input.items ?? [],
    payments: input.payments ?? [],
    discount: input.discount ?? 0,
    discount_type: input.discount_type ?? 'value',
    charges: input.charges ?? 0,
    tax_rate: input.tax_rate ?? defaults.tax_rate,
    status: input.status ?? 'draft',
    due_at: input.due_at ?? (input.issued_at ? dueDateFor(issuedAt, settings.inv_payment_terms) : defaults.due_at),
  };
  if (fields.due_at < issuedAt) return c.json({ error: 'The due date cannot be before the invoice date' }, 400);
  const { totals, status } = derive(fields, now);
  const id = `inv_${nanoid(10)}`;

  const statements = [
    db
      .prepare(
        `INSERT INTO invoices (id, number, client_name, client_email, client_address, issued_at, due_at, currency, status,
          items, payments, subtotal, tax_rate, discount, total, notes, terms, folder, tag, avatar, created_at, updated_at,
          discount_type, charges, payment_method, equivalent_amount, exchange_rate)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21,
          ?22, ?23, ?24, ?25, ?26)`
      )
      .bind(
        id,
        number,
        input.client_name,
        input.client_email ?? '',
        input.client_address ?? '',
        issuedAt,
        fields.due_at,
        input.currency ?? defaults.currency,
        status,
        JSON.stringify(fields.items),
        JSON.stringify(fields.payments),
        totals.subtotal,
        fields.tax_rate,
        fields.discount,
        totals.grand,
        input.notes ?? '',
        input.terms ?? defaults.terms,
        input.folder ?? defaults.folder,
        input.tag === undefined ? defaults.tag : input.tag,
        initials(settings.profile_name),
        now,
        fields.discount_type,
        fields.charges,
        input.payment_method ?? defaults.payment_method,
        input.equivalent_amount ?? 0,
        input.exchange_rate ?? 0
      ),
  ];
  if (advanceTo !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES ('inv_next_number', ?1, ?2)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .bind(String(advanceTo), now)
    );
  }
  await db.batch(statements);

  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first<InvoiceRow>();
  return c.json({ invoice }, 201);
});

const EMAIL_HISTORY = `SELECT id, sent_at, recipients, subject, attachments, status, error
  FROM invoice_emails WHERE invoice_id = ?1 ORDER BY sent_at DESC LIMIT 20`;

invoices.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const [, found, emails] = await db.batch([
    markOverdue(db, Date.now()),
    db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id),
    db.prepare(EMAIL_HISTORY).bind(id),
  ]);
  const invoice = (found.results as InvoiceRow[])[0];
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
  return c.json({ invoice, emails: emails.results });
});

/**
 * Emails the invoice and/or receipt PDFs (rendered in the browser) through the
 * SMTP server from Settings. Sending a draft issues it. Every attempt is
 * logged, and the log doubles as a daily cap.
 */
invoices.post('/:id/send', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseSendRequest(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const req = parsed.value;

  const db = c.env.DB;
  const now = Date.now();
  const [found, recent] = await db.batch([
    db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id),
    db.prepare("SELECT COUNT(*) AS n FROM invoice_emails WHERE status = 'sent' AND sent_at > ?1").bind(now - 86_400_000),
  ]);
  const invoice = (found.results as InvoiceRow[])[0];
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
  if (((recent.results[0] as { n: number } | undefined)?.n ?? 0) >= DAILY_EMAIL_CAP) {
    return c.json({ error: `The daily limit of ${DAILY_EMAIL_CAP} emails is reached. Try again tomorrow.` }, 429);
  }

  const settings = await getSettings(db);
  const setup = mailSetup(settings);
  if (!setup.ok) return c.json({ error: setup.error }, 400);
  const bcc = req.copyMe && setup.value.replyTo && !req.to.includes(setup.value.replyTo) ? [setup.value.replyTo] : [];

  let error: string | null = null;
  try {
    await sendMail(setup.value.smtp, {
      from: setup.value.from,
      to: req.to,
      cc: req.cc,
      bcc,
      replyTo: setup.value.replyTo || undefined,
      subject: req.subject,
      text: req.message,
      attachments: req.attachments,
    });
  } catch (err) {
    error = err instanceof SmtpError ? err.message : 'Could not reach the mail server. Check the host, port and security.';
    if (!(err instanceof SmtpError)) console.error('SMTP send failed', err);
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO invoice_emails (id, invoice_id, sent_at, recipients, subject, attachments, status, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      )
      .bind(
        `eml_${nanoid(10)}`,
        id,
        now,
        [...req.to, ...req.cc].join(', '),
        req.subject,
        req.attachments.map((a) => a.kind).join(','),
        error ? 'failed' : 'sent',
        error
      ),
  ];
  // Sending a draft issues it; the due date then decides sent vs overdue.
  if (!error && invoice.status === 'draft') {
    const status = resolveStatus({
      status: 'sent',
      grand: Number(invoice.total),
      paid: paidTotal(parsePayments(invoice.payments)),
      dueAt: invoice.due_at,
      now,
    });
    statements.push(db.prepare('UPDATE invoices SET status = ?1, updated_at = ?2 WHERE id = ?3').bind(status, now, id));
  }
  await db.batch(statements);

  const [updated, emails] = await db.batch([
    db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id),
    db.prepare(EMAIL_HISTORY).bind(id),
  ]);
  const payload = { invoice: (updated.results as InvoiceRow[])[0], emails: emails.results };
  if (error) return c.json({ ...payload, error }, 502);
  return c.json(payload);
});

invoices.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid payload' }, 400);
  const parsed = parseInvoiceInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  const db = c.env.DB;
  const now = Date.now();

  const existing = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first<InvoiceRow>();
  if (!existing) return c.json({ error: 'Invoice not found' }, 404);
  if (input.client_name !== undefined && !input.client_name) return c.json({ error: 'A client name is required' }, 400);
  if (input.number !== undefined) {
    if (!input.number) return c.json({ error: 'An invoice number is required' }, 400);
    if (input.number !== existing.number && (await numberTaken(db, input.number, id))) {
      return c.json({ error: `Invoice number ${input.number} is already in use` }, 409);
    }
  }

  const issuedAt = input.issued_at ?? existing.issued_at;
  const fields = {
    items: input.items ?? parseItems(existing.items),
    payments: input.payments ?? parsePayments(existing.payments),
    discount: input.discount ?? Number(existing.discount),
    discount_type: input.discount_type ?? (existing.discount_type === 'percent' ? ('percent' as const) : ('value' as const)),
    charges: input.charges ?? Number(existing.charges),
    tax_rate: input.tax_rate ?? Number(existing.tax_rate),
    status: input.status ?? existing.status,
    due_at: input.due_at ?? existing.due_at,
  };
  if (fields.due_at < issuedAt) return c.json({ error: 'The due date cannot be before the invoice date' }, 400);
  if (fields.discount_type === 'percent' && fields.discount > 100) {
    return c.json({ error: 'A percentage discount cannot exceed 100%' }, 400);
  }
  // Legacy rows with no line items keep their stored total.
  const legacyTotal = fields.items.length === 0 && input.items === undefined && Number(existing.total) > 0;
  const derived = derive(fields, now);
  const total = legacyTotal ? Number(existing.total) : derived.totals.grand;
  const subtotal = legacyTotal ? Number(existing.subtotal) : derived.totals.subtotal;
  const status = legacyTotal
    ? resolveStatus({ status: fields.status, grand: total, paid: paidTotal(fields.payments), dueAt: fields.due_at, now })
    : derived.status;

  await db
    .prepare(
      `UPDATE invoices SET
        number = ?1, client_name = ?2, client_email = ?3, client_address = ?4, issued_at = ?5, due_at = ?6,
        currency = ?7, status = ?8, items = ?9, payments = ?10, subtotal = ?11, tax_rate = ?12, discount = ?13,
        total = ?14, notes = ?15, terms = ?16, folder = ?17, tag = ?18, updated_at = ?19,
        discount_type = ?20, charges = ?21, payment_method = ?22, equivalent_amount = ?23, exchange_rate = ?24
       WHERE id = ?25`
    )
    .bind(
      input.number ?? existing.number,
      input.client_name ?? existing.client_name,
      input.client_email ?? existing.client_email ?? '',
      input.client_address ?? existing.client_address ?? '',
      issuedAt,
      fields.due_at,
      input.currency ?? existing.currency,
      status,
      JSON.stringify(fields.items),
      JSON.stringify(fields.payments),
      subtotal,
      fields.tax_rate,
      fields.discount,
      total,
      input.notes ?? existing.notes ?? '',
      input.terms ?? existing.terms ?? '',
      input.folder === undefined ? existing.folder : input.folder ?? 'Invoices',
      input.tag === undefined ? existing.tag : input.tag,
      now,
      fields.discount_type,
      fields.charges,
      input.payment_method ?? existing.payment_method ?? '',
      input.equivalent_amount ?? Number(existing.equivalent_amount ?? 0),
      input.exchange_rate ?? Number(existing.exchange_rate ?? 0),
      id
    )
    .run();

  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first<InvoiceRow>();
  return c.json({ invoice });
});

invoices.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.batch([
    db.prepare('DELETE FROM invoices WHERE id = ?1').bind(id),
    db.prepare('DELETE FROM invoice_emails WHERE invoice_id = ?1').bind(id),
  ]);
  return c.json({ success: true });
});

export default invoices;
