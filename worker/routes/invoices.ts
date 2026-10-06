import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../env';
import type { InvoiceRow } from '../../src/lib/types';
import { asText } from '../../src/lib/links/fields';
import { draftTotals, parseItems } from '../../src/lib/invoices';
import { getSettings } from '../lib/settings';

const invoices = new Hono<AppEnv>();

const discountTypeOf = (value: unknown) => (value === 'percent' ? 'percent' : 'value');

invoices.get('/', async (c) => {
  const status = c.req.query('status')?.trim() || 'all';
  const folder = c.req.query('folder')?.trim() || '';
  const search = c.req.query('search')?.trim() || '';

  let sql = 'SELECT * FROM invoices WHERE 1 = 1';
  const params: unknown[] = [];
  if (status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (folder && folder !== 'All') {
    sql += ' AND folder = ?';
    params.push(folder);
  }
  if (search) {
    sql += ' AND (number LIKE ? OR client_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY issued_at DESC';

  const [rows, grouped] = await c.env.DB.batch([
    c.env.DB.prepare(sql).bind(...params),
    c.env.DB.prepare('SELECT status, COUNT(*) AS count FROM invoices GROUP BY status'),
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
  const body = await c.req.json();
  const clientName = asText(body.client_name ?? body.client);
  if (!clientName) return c.json({ error: 'A client name is required' }, 400);

  const db = c.env.DB;
  const id = `inv_${nanoid(10)}`;
  const now = Date.now();

  // Next number from the configured prefix / padding / sequence.
  const settings = await getSettings(db);
  const padding = Number(settings.inv_number_padding) || 6;
  const nextNumber = Number(settings.inv_next_number) || 1;
  const number = asText(body.number) ?? `${settings.inv_number_prefix}${String(nextNumber).padStart(padding, '0')}`;

  const taxRate = Number(body.tax_rate ?? 0.075);
  const discountType = discountTypeOf(body.discount_type);
  const computed = draftTotals({
    items: parseItems(JSON.stringify(body.items ?? [])),
    discount: Number(body.discount ?? 0),
    discountType,
    charges: Number(body.charges ?? 0),
    taxRate,
  });

  await db.batch([
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
        clientName,
        asText(body.client_email) ?? '',
        asText(body.client_address) ?? '',
        body.issued_at ? Number(body.issued_at) : now,
        body.due_at ? Number(body.due_at) : now + 30 * 86_400_000,
        asText(body.currency) ?? 'NGN',
        asText(body.status) ?? 'draft',
        JSON.stringify(body.items ?? []),
        JSON.stringify(body.payments ?? []),
        computed.subtotal,
        taxRate,
        Number(body.discount ?? 0),
        computed.grand,
        asText(body.notes) ?? '',
        asText(body.terms) ?? '',
        asText(body.folder) ?? 'Invoices',
        asText(body.tag),
        asText(body.avatar) ?? 'NC',
        now,
        discountType,
        Number(body.charges ?? 0),
        asText(body.payment_method ?? body.paymentMethod) ?? '',
        Number(body.equivalent_amount ?? body.equivalentAmount ?? 0),
        Number(body.exchange_rate ?? body.exchangeRate ?? 0)
      ),
    // Advance the configured sequence.
    db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('inv_next_number', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(String(nextNumber + 1), now),
  ]);

  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first<InvoiceRow>();
  return c.json({ invoice }, 201);
});

invoices.get('/:id', async (c) => {
  const invoice = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?1').bind(c.req.param('id')).first<InvoiceRow>();
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
  return c.json({ invoice });
});

invoices.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first<InvoiceRow>();
  if (!existing) return c.json({ error: 'Invoice not found' }, 404);

  const value = (key: string, current: unknown) => (body[key] === undefined ? current : body[key]);
  const text = (key: string, current: string) => (body[key] === undefined ? current : asText(body[key]) ?? '');

  // Totals are always derived from the line items, discount and charges so a
  // client-sent total can never disagree with the invoice's own fields.
  const items = body.items === undefined ? existing.items : JSON.stringify(body.items);
  const discount = Number(value('discount', existing.discount));
  const discountType = discountTypeOf(body.discount_type ?? existing.discount_type);
  const charges = Number(value('charges', existing.charges));
  const taxRate = Number(value('tax_rate', existing.tax_rate));
  const totals = draftTotals({ items: parseItems(items), discount, discountType, charges, taxRate });

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
      text('number', existing.number),
      text('client_name', existing.client_name),
      text('client_email', existing.client_email),
      text('client_address', existing.client_address),
      Number(value('issued_at', existing.issued_at)),
      Number(value('due_at', existing.due_at)),
      text('currency', existing.currency),
      text('status', existing.status),
      items,
      body.payments === undefined ? existing.payments : JSON.stringify(body.payments),
      totals.subtotal,
      taxRate,
      discount,
      totals.grand,
      text('notes', existing.notes),
      text('terms', existing.terms),
      text('folder', existing.folder),
      body.tag === undefined ? existing.tag : asText(body.tag),
      Date.now(),
      discountType,
      charges,
      body.payment_method === undefined ? existing.payment_method : asText(body.payment_method) ?? '',
      Number(value('equivalent_amount', existing.equivalent_amount)),
      Number(value('exchange_rate', existing.exchange_rate)),
      id
    )
    .run();

  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first<InvoiceRow>();
  return c.json({ invoice });
});

invoices.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM invoices WHERE id = ?1').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

export default invoices;
