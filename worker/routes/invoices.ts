import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { InvoiceRow, InvoiceView } from '../../src/lib/types';
import {
  computeTotals,
  currencyCode,
  displayStatus,
  dueDateFromTerms,
  equivalentCurrency,
  formatInvoiceNumber,
  parseItems,
  parsePayments,
  settleStatus,
  toEquivalent,
  type InvoiceStatus,
  type StoredStatus,
} from '../../src/lib/invoices';
import { getSettings, type SettingsMap } from '../lib/settings';
import { parseInvoiceInput, parsePaymentInput } from '../lib/invoice-input';
import { readJsonObject } from '../lib/request';
import { initials } from '../lib/initials';

const invoices = new Hono<AppEnv>();

/** 128-bit random token for the public client view. */
export const newShareToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const STORED: StoredStatus[] = ['draft', 'sent', 'partially-paid', 'paid', 'cancelled'];
const asStored = (status: string): StoredStatus => (STORED.includes(status as StoredStatus) ? (status as StoredStatus) : 'sent');

/** Row → API shape with totals, equivalent and the status people see. */
export function toView(row: InvoiceRow, now = Date.now()): InvoiceView {
  const payments = parsePayments(row.payments);
  const totals = computeTotals(
    {
      items: parseItems(row.items),
      discount: Number(row.discount) || 0,
      discountType: row.discount_type === 'percent' ? 'percent' : 'value',
      charges: Number(row.charges) || 0,
      taxRate: Number(row.tax_rate) || 0,
    },
    payments
  );
  const rate = Number(row.exchange_rate) || 0;
  const equivalentTotal = toEquivalent(totals.total, row.currency, rate);
  return {
    ...row,
    payments: JSON.stringify(payments),
    display_status: displayStatus(asStored(row.status), row.due_at, totals.balance, now),
    totals,
    equivalent:
      equivalentTotal === null
        ? null
        : {
            currency: equivalentCurrency(row.currency),
            rate,
            total: equivalentTotal,
            balance: toEquivalent(totals.balance, row.currency, rate) ?? 0,
          },
  };
}

const defaultOr = (value: string | undefined, fallback: string | null) => (value && value !== 'None' ? value : fallback);

/**
 * Allocates the next number from the sequence in one atomic upsert, so two
 * invoices created at the same moment can never get the same number.
 */
async function allocateNumber(db: D1Database, settings: SettingsMap): Promise<string> {
  const prefix = settings.inv_number_prefix ?? '';
  const padding = Number(settings.inv_number_padding) || 6;
  const start = Number(settings.inv_next_number) || 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('inv_next_number', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at
         RETURNING value`
      )
      .bind(String(start + 1), Date.now())
      .first<{ value: string }>();
    const number = formatInvoiceNumber(prefix, padding, Number(row?.value ?? start + 1) - 1);
    // A hand-edited invoice may already use this number; skip past it.
    const taken = await db.prepare('SELECT 1 FROM invoices WHERE number = ?1').bind(number).first();
    if (!taken) return number;
  }
  throw new Error('Could not allocate an invoice number');
}

async function numberTaken(db: D1Database, number: string, exceptId = '') {
  return !!(await db.prepare('SELECT 1 FROM invoices WHERE number = ?1 AND id != ?2').bind(number, exceptId).first());
}

async function loadRow(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first<InvoiceRow>();
}

/** Writes every editable column of a row (after totals/status are recomputed). */
async function saveRow(db: D1Database, row: InvoiceRow) {
  const view = toView(row);
  const status = settleStatus(asStored(row.status), view.totals);
  await db
    .prepare(
      `UPDATE invoices SET
        number = ?1, client_name = ?2, client_contact = ?3, client_email = ?4, client_address = ?5, reference = ?6,
        issued_at = ?7, due_at = ?8, currency = ?9, status = ?10, items = ?11, payments = ?12,
        subtotal = ?13, tax_rate = ?14, discount = ?15, discount_type = ?16, charges = ?17, total = ?18,
        exchange_rate = ?19, payment_method = ?20, notes = ?21, terms = ?22, folder = ?23, tag = ?24,
        sent_at = ?25, updated_at = ?26
       WHERE id = ?27`
    )
    .bind(
      row.number, row.client_name, row.client_contact, row.client_email, row.client_address, row.reference,
      row.issued_at, row.due_at, row.currency, status, row.items, row.payments,
      view.totals.subtotal, row.tax_rate, row.discount, row.discount_type, row.charges, view.totals.total,
      row.exchange_rate, row.payment_method, row.notes, row.terms, row.folder, row.tag,
      row.sent_at, Date.now(), row.id
    )
    .run();
}

invoices.get('/', async (c) => {
  const status = (c.req.query('status')?.trim() || 'all') as InvoiceStatus | 'all';
  const folder = c.req.query('folder')?.trim() || '';
  const search = c.req.query('search')?.trim().toLowerCase().slice(0, 200) || '';

  // One scan; statuses depend on today's date, so filtering and counting
  // happen in memory instead of in extra GROUP BY queries.
  const { results } = await c.env.DB.prepare('SELECT * FROM invoices ORDER BY issued_at DESC, created_at DESC').all<InvoiceRow>();
  const now = Date.now();
  const all = results.map((row) => toView(row, now));
  const inFolder = all.filter((inv) => !folder || folder === 'All' || inv.folder === folder);

  const counts: Record<string, number> = { all: inFolder.length };
  for (const inv of inFolder) counts[inv.display_status] = (counts[inv.display_status] ?? 0) + 1;

  const list = inFolder.filter(
    (inv) =>
      (status === 'all' || inv.display_status === status) &&
      (!search ||
        inv.number.toLowerCase().includes(search) ||
        inv.client_name.toLowerCase().includes(search) ||
        inv.reference.toLowerCase().includes(search))
  );
  return c.json({ invoices: list, total: list.length, counts });
});

/** Past clients for the "Bill to" autocomplete: the latest details per client name. */
invoices.get('/clients', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT client_name, client_contact, client_email, client_address, currency, MAX(issued_at) AS last_issued
     FROM invoices GROUP BY client_name COLLATE NOCASE ORDER BY last_issued DESC LIMIT 200`
  ).all();
  return c.json({ clients: results });
});

invoices.post('/', async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = parseInvoiceInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  if (!input.client_name) return c.json({ error: 'A client name is required' }, 400);

  const db = c.env.DB;
  const settings = await getSettings(db);
  if (input.number && (await numberTaken(db, input.number))) {
    return c.json({ error: `Invoice number ${input.number} is already used` }, 409);
  }
  const number = input.number ?? (await allocateNumber(db, settings));
  const now = Date.now();
  const issuedAt = input.issued_at ?? now;

  const row: InvoiceRow = {
    id: `inv_${nanoid(12)}`,
    workspace_id: 'ws_default',
    number,
    client_name: input.client_name,
    client_contact: input.client_contact ?? '',
    client_email: input.client_email ?? '',
    client_address: input.client_address ?? '',
    reference: input.reference ?? '',
    issued_at: issuedAt,
    due_at: input.due_at ?? dueDateFromTerms(settings.inv_payment_terms, issuedAt),
    currency: input.currency ?? currencyCode(settings.inv_default_currency),
    status: input.status ?? 'draft',
    items: JSON.stringify(input.items ?? []),
    payments: '[]',
    subtotal: 0,
    tax_rate: input.tax_rate ?? (Number(settings.inv_tax_rate) || 0) / 100,
    discount: input.discount ?? 0,
    discount_type: input.discount_type ?? 'value',
    charges: input.charges ?? 0,
    payment_method: input.payment_method ?? '',
    equivalent_amount: 0,
    exchange_rate: input.exchange_rate ?? 0,
    total: 0,
    notes: input.notes ?? '',
    terms: input.terms ?? settings.inv_terms_note ?? '',
    folder: input.folder ?? defaultOr(settings.inv_default_folder, 'Invoices') ?? 'Invoices',
    tag: input.tag !== undefined ? input.tag : defaultOr(settings.inv_default_tag, null),
    avatar: initials(settings.profile_name),
    share_token: newShareToken(),
    sent_at: input.status === 'sent' ? now : null,
    viewed_at: null,
    created_at: now,
    updated_at: now,
  };
  const view = toView(row);

  await db
    .prepare(
      `INSERT INTO invoices (id, number, client_name, client_contact, client_email, client_address, reference,
        issued_at, due_at, currency, status, items, payments, subtotal, tax_rate, discount, discount_type, charges,
        payment_method, equivalent_amount, exchange_rate, total, notes, terms, folder, tag, avatar, share_token,
        sent_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, 0, ?20, ?21,
        ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?29)`
    )
    .bind(
      row.id, row.number, row.client_name, row.client_contact, row.client_email, row.client_address, row.reference,
      row.issued_at, row.due_at, row.currency, row.status, row.items, row.payments, view.totals.subtotal, row.tax_rate,
      row.discount, row.discount_type, row.charges, row.payment_method, row.exchange_rate, view.totals.total,
      row.notes, row.terms, row.folder, row.tag, row.avatar, row.share_token, row.sent_at, now
    )
    .run();

  return c.json({ invoice: toView((await loadRow(db, row.id))!) }, 201);
});

invoices.get('/:id', async (c) => {
  const row = await loadRow(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Invoice not found' }, 404);
  return c.json({ invoice: toView(row) });
});

invoices.patch('/:id', async (c) => {
  const db = c.env.DB;
  const row = await loadRow(db, c.req.param('id'));
  if (!row) return c.json({ error: 'Invoice not found' }, 404);
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = parseInvoiceInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;

  if (input.number && input.number !== row.number && (await numberTaken(db, input.number, row.id))) {
    return c.json({ error: `Invoice number ${input.number} is already used` }, 409);
  }
  const { items, status, ...fields } = input;
  const next: InvoiceRow = {
    ...row,
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    tag: input.tag !== undefined ? input.tag : row.tag,
    folder: input.folder !== undefined ? input.folder ?? 'Invoices' : row.folder,
  } as InvoiceRow;
  if (items) next.items = JSON.stringify(items);
  if (status) {
    // Re-opening a cancelled or paid invoice goes back through settleStatus.
    next.status = status;
    if (status === 'sent' && !row.sent_at) next.sent_at = Date.now();
  }
  if (next.due_at < next.issued_at) return c.json({ error: 'The due date cannot be before the invoice date' }, 400);

  await saveRow(db, next);
  return c.json({ invoice: toView((await loadRow(db, row.id))!) });
});

invoices.post('/:id/payments', async (c) => {
  const db = c.env.DB;
  const row = await loadRow(db, c.req.param('id'));
  if (!row) return c.json({ error: 'Invoice not found' }, 404);
  if (row.status === 'cancelled') return c.json({ error: 'Re-open this cancelled invoice before logging a payment' }, 409);
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = parsePaymentInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const payments = parsePayments(row.payments);
  if (payments.length >= 100) return c.json({ error: 'Too many payments on one invoice' }, 400);
  payments.push({ id: `pay_${nanoid(8)}`, ...parsed.value });
  const next: InvoiceRow = {
    ...row,
    payments: JSON.stringify(payments),
    // A payment against a draft means it went out.
    status: row.status === 'draft' ? 'sent' : row.status,
    sent_at: row.sent_at ?? Date.now(),
  };
  await saveRow(db, next);
  return c.json({ invoice: toView((await loadRow(db, row.id))!) }, 201);
});

invoices.delete('/:id/payments/:paymentId', async (c) => {
  const db = c.env.DB;
  const row = await loadRow(db, c.req.param('id'));
  if (!row) return c.json({ error: 'Invoice not found' }, 404);
  const payments = parsePayments(row.payments);
  const remaining = payments.filter((p) => p.id !== c.req.param('paymentId'));
  if (remaining.length === payments.length) return c.json({ error: 'Payment not found' }, 404);
  await saveRow(db, { ...row, payments: JSON.stringify(remaining) });
  return c.json({ invoice: toView((await loadRow(db, row.id))!) });
});

/** Copy as a new draft: new number and dates, no payments, same client and lines. */
invoices.post('/:id/duplicate', async (c) => {
  const db = c.env.DB;
  const row = await loadRow(db, c.req.param('id'));
  if (!row) return c.json({ error: 'Invoice not found' }, 404);
  const settings = await getSettings(db);
  const now = Date.now();
  const term = Math.max(0, row.due_at - row.issued_at);
  const id = `inv_${nanoid(12)}`;
  const number = await allocateNumber(db, settings);
  await db
    .prepare(
      `INSERT INTO invoices (id, number, client_name, client_contact, client_email, client_address, reference,
        issued_at, due_at, currency, status, items, payments, subtotal, tax_rate, discount, discount_type, charges,
        payment_method, equivalent_amount, exchange_rate, total, notes, terms, folder, tag, avatar, share_token,
        created_at, updated_at)
       SELECT ?1, ?2, client_name, client_contact, client_email, client_address, reference,
        ?3, ?4, currency, 'draft', items, '[]', subtotal, tax_rate, discount, discount_type, charges,
        payment_method, 0, exchange_rate, total, notes, terms, folder, tag, ?5, ?6, ?3, ?3
       FROM invoices WHERE id = ?7`
    )
    .bind(id, number, now, now + term, initials(settings.profile_name), newShareToken(), row.id)
    .run();
  return c.json({ invoice: toView((await loadRow(db, id))!) }, 201);
});

/** Issues a new client link; the old one stops working immediately. */
invoices.post('/:id/share/reset', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const result = await db.prepare('UPDATE invoices SET share_token = ?1, updated_at = ?2 WHERE id = ?3').bind(newShareToken(), Date.now(), id).run();
  if (!result.meta.changes) return c.json({ error: 'Invoice not found' }, 404);
  return c.json({ invoice: toView((await loadRow(db, id))!) });
});

invoices.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM invoices WHERE id = ?1').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

export default invoices;
