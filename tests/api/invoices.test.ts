import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { inject } from 'vitest';
import { api } from './helpers';
import { invoiceTotals, parsePayments } from '@/lib/invoices';
import type { InvoiceRow } from '@/lib/types';

const DAY = 86_400_000;
const todayUtc = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const pay = (amount: number, date = '2026-10-01', method = 'Bank transfer') => ({ amount, date, method, note: '' });

let counter = 0;
async function create(body: Record<string, unknown> = {}): Promise<InvoiceRow> {
  counter += 1;
  const res = await api('POST', '/api/invoices', {
    client_name: `Client ${counter}`,
    items: [{ name: 'Work', desc: '', qty: 1, unitPrice: 100_000 }],
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.invoice as InvoiceRow;
}

async function update(id: string, body: Record<string, unknown>) {
  const res = await api('PATCH', `/api/invoices/${id}`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.invoice as InvoiceRow;
}

const setSettings = (patch: Record<string, string>) => api('PATCH', '/api/settings', patch);

const ROOT = path.resolve(__dirname, '../..');
/** Runs SQL straight against the test database, e.g. to simulate time passing. */
function d1(args: string[]) {
  execFileSync(
    path.join(ROOT, 'node_modules/.bin/wrangler'),
    ['d1', 'execute', 'short-invoice', '--local', '--persist-to', inject('persistDir'), ...args],
    { cwd: ROOT, stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }
  );
}

describe('creating invoices', () => {
  it('fills every default from Settings → Invoice', async () => {
    const inv = await create();
    expect(inv.currency).toBe('NGN');
    expect(inv.status).toBe('draft');
    expect(inv.tax_rate).toBe(0.075);
    expect(inv.issued_at).toBe(todayUtc());
    expect(inv.due_at).toBe(todayUtc() + 30 * DAY); // Net 30
    expect(inv.folder).toBe('Invoices');
    expect(inv.tag).toBeNull();
    expect(inv.payment_method).toBe('Bank transfer');
    expect(inv.terms).toContain('Net 30');
    expect(inv.exchange_rate).toBe(0);
    expect(inv.total).toBe(107_500);
  });

  it('uses changed settings for the next invoice', async () => {
    const saved = await setSettings({
      inv_default_currency: 'USD ($)',
      inv_tax_rate: '0',
      inv_payment_terms: 'Net 14',
      inv_default_folder: 'Campaigns',
      inv_default_tag: 'VIP',
      inv_default_method: 'Card',
      inv_terms_note: 'Pay within two weeks.',
    });
    expect(saved.status).toBe(200);
    try {
      const inv = await create();
      expect(inv).toMatchObject({
        currency: 'USD',
        tax_rate: 0,
        total: 100_000,
        folder: 'Campaigns',
        tag: 'VIP',
        payment_method: 'Card',
        terms: 'Pay within two weeks.',
      });
      expect(inv.due_at).toBe(todayUtc() + 14 * DAY);
    } finally {
      await setSettings({
        inv_default_currency: 'NGN (₦)',
        inv_tax_rate: '7.5',
        inv_payment_terms: 'Net 30',
        inv_default_folder: 'None',
        inv_default_tag: 'None',
        inv_default_method: 'Bank transfer',
        inv_terms_note: 'Net 30. Late payments accrue 1.5% interest per month.',
      });
    }
  });

  it('rejects invalid numeric settings', async () => {
    expect((await setSettings({ inv_tax_rate: 'seven' })).status).toBe(400);
    expect((await setSettings({ inv_usd_rate: '-5' })).status).toBe(400);
    expect((await setSettings({ inv_number_padding: '2.5' })).status).toBe(400);
  });

  it('numbers invoices from the configured sequence and skips numbers in use', async () => {
    await setSettings({ inv_number_prefix: 'T-', inv_number_padding: '4', inv_next_number: '7' });
    // Someone already typed the next number by hand.
    await create({ number: 'T-0007' });
    const a = await create();
    const b = await create();
    expect(a.number).toBe('T-0008');
    expect(b.number).toBe('T-0009');
    const settings = (await api('GET', '/api/settings')).body.settings;
    expect(settings.inv_next_number).toBe('10');
  });

  it('refuses a duplicate invoice number', async () => {
    const first = await create({ number: 'DUP-1' });
    const res = await api('POST', '/api/invoices', { client_name: 'X', number: 'DUP-1' });
    expect(res.status).toBe(409);
    const second = await create();
    const clash = await api('PATCH', `/api/invoices/${second.id}`, { number: first.number });
    expect(clash.status).toBe(409);
  });

  it('computes totals on the server, ignoring any total the client sends', async () => {
    const inv = await create({
      items: [
        { name: 'Design', desc: '', qty: 2, unitPrice: 50_000 },
        { name: 'Hosting', desc: '', qty: 1, unitPrice: 0 },
      ],
      discount: 10,
      discount_type: 'percent',
      charges: 5_000,
      total: 1,
      subtotal: 1,
    });
    expect(inv.subtotal).toBe(100_000);
    expect(inv.total).toBe(102_125);
  });

  it.each([
    [{ client_name: '' }, 'client name'],
    [{ client_name: 'A', currency: 'naira' }, 'Currency'],
    [{ client_name: 'A', items: [{ name: 'x', qty: 1, unitPrice: -1 }] }, 'price'],
    [{ client_name: 'A', client_email: 'nope' }, 'email'],
    [{ client_name: 'A', issued_at: Date.UTC(2026, 9, 10), due_at: Date.UTC(2026, 9, 1) }, 'before'],
    [{ client_name: 'A', status: 'archived' }, 'status'],
  ])('rejects %j', async (body, message) => {
    const res = await api('POST', '/api/invoices', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  it('rejects non-JSON and cross-site writes', async () => {
    const res = await api('POST', '/api/invoices', { client_name: 'A' }, { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
  });
});

describe('status follows the invoice', () => {
  it('becomes overdue the day after the due date, and back when the date moves', async () => {
    const issued = todayUtc() - 40 * DAY;
    const inv = await create({ issued_at: issued, due_at: todayUtc() - DAY });
    expect(inv.status).toBe('draft');
    const sent = await update(inv.id, { status: 'sent' });
    expect(sent.status).toBe('overdue');
    const extended = await update(inv.id, { due_at: todayUtc() + 7 * DAY });
    expect(extended.status).toBe('sent');
    const dueToday = await update(inv.id, { due_at: todayUtc() });
    expect(dueToday.status).toBe('sent');
  });

  it('flips stale "sent" rows to overdue when the list is read', async () => {
    const inv = await create({ issued_at: todayUtc() - 20 * DAY, due_at: todayUtc() + DAY });
    expect((await update(inv.id, { status: 'sent' })).status).toBe('sent');
    // Time passes: the stored row is still "sent" but its due date is now behind us.
    d1(['--command', `UPDATE invoices SET due_at = ${todayUtc() - 2 * DAY} WHERE id = '${inv.id}'`]);
    const list = await api('GET', '/api/invoices?status=overdue');
    expect((list.body.invoices as InvoiceRow[]).map((row) => row.id)).toContain(inv.id);
    expect((await api('GET', `/api/invoices/${inv.id}`)).body.invoice.status).toBe('overdue');
  });

  it('moves through partially paid and paid as payments are logged and removed', async () => {
    const inv = await update((await create()).id, { status: 'sent' });
    expect(inv.total).toBe(107_500);

    const partial = await update(inv.id, { payments: [pay(50_000)] });
    expect(partial.status).toBe('partially-paid');

    const paid = await update(inv.id, { payments: [pay(50_000), pay(57_500, '2026-10-02', 'Card')] });
    expect(paid.status).toBe('paid');
    expect(invoiceTotals(paid).balance).toBe(0);

    // A bigger total after payment reopens the balance.
    const grown = await update(inv.id, { items: [{ name: 'Work', desc: '', qty: 2, unitPrice: 100_000 }] });
    expect(grown.status).toBe('partially-paid');

    const removed = await update(inv.id, { payments: [] });
    expect(removed.status).toBe('sent');
  });

  it('cannot be marked paid by hand without payments', async () => {
    const inv = await create();
    const res = await update(inv.id, { status: 'paid' });
    expect(res.status).toBe('sent');
  });

  it('keeps cancelled and draft invoices as set', async () => {
    const inv = await create({ issued_at: todayUtc() - 60 * DAY, due_at: todayUtc() - 30 * DAY });
    expect(inv.status).toBe('draft');
    const cancelled = await update(inv.id, { status: 'cancelled', payments: [pay(10)] });
    expect(cancelled.status).toBe('cancelled');
  });

  it('validates payments', async () => {
    const inv = await create();
    const res = await api('PATCH', `/api/invoices/${inv.id}`, { payments: [{ amount: -5, date: '2026-10-01' }] });
    expect(res.status).toBe(400);
  });
});

describe('currency equivalent', () => {
  it('stores the per-invoice rate and the optional agreed figure', async () => {
    const inv = await create({ exchange_rate: 1550, equivalent_amount: 0 });
    expect(inv.exchange_rate).toBe(1550);
    const agreed = await update(inv.id, { equivalentAmount: 70 });
    expect(agreed.equivalent_amount).toBe(70);
    const removed = await update(inv.id, { exchange_rate: 0, equivalent_amount: 0 });
    expect(removed.exchange_rate).toBe(0);
    expect((await api('PATCH', `/api/invoices/${inv.id}`, { exchange_rate: -1 })).status).toBe(400);
  });
});

describe('listing and filtering', () => {
  let tagged: InvoiceRow;

  beforeAll(async () => {
    tagged = await create({ client_name: 'Filter Target Ltd', client_email: 'billing@filter-target.test', tag: 'Retainer', folder: 'Client work' });
    await create({ client_name: 'Someone Else', tag: 'Other', folder: 'Client work' });
  });

  it('filters by tag and folder, with counts that follow the filters', async () => {
    const res = await api('GET', '/api/invoices?tag=Retainer&folder=Client%20work');
    const ids = (res.body.invoices as InvoiceRow[]).map((row) => row.id);
    expect(ids).toEqual([tagged.id]);
    expect(res.body.counts.all).toBe(1);
  });

  it('searches number, client name and client email', async () => {
    for (const term of ['Filter Target', 'filter-target.test', tagged.number]) {
      const res = await api('GET', `/api/invoices?search=${encodeURIComponent(term)}`);
      expect((res.body.invoices as InvoiceRow[]).map((row) => row.id)).toContain(tagged.id);
    }
  });

  it('clears a tag with null', async () => {
    const res = await update(tagged.id, { tag: null });
    expect(res.tag).toBeNull();
  });

  it('deletes an invoice', async () => {
    const inv = await create();
    expect((await api('DELETE', `/api/invoices/${inv.id}`)).status).toBe(200);
    expect((await api('GET', `/api/invoices/${inv.id}`)).status).toBe(404);
  });
});

describe('demo seed', () => {
  beforeAll(() => d1(['--file', 'seed/demo-invoices.sql']));

  afterAll(async () => {
    const list = await api('GET', '/api/invoices?search=DEMO-');
    for (const row of list.body.invoices as InvoiceRow[]) await api('DELETE', `/api/invoices/${row.id}`);
  });

  it('covers every status, tag and currency case with totals the app agrees with', async () => {
    const res = await api('GET', '/api/invoices?search=DEMO-');
    const rows = res.body.invoices as InvoiceRow[];
    expect(rows).toHaveLength(11);

    expect(new Set(rows.map((r) => r.status))).toEqual(
      new Set(['draft', 'sent', 'overdue', 'partially-paid', 'paid', 'cancelled'])
    );
    expect(new Set(rows.map((r) => r.tag))).toEqual(new Set(['Client', 'Retainer', 'International', null]));
    expect(rows.some((r) => r.currency === 'NGN' && r.exchange_rate > 0)).toBe(true);
    expect(rows.some((r) => r.currency === 'USD' && r.exchange_rate > 0)).toBe(true);
    expect(rows.some((r) => r.discount_type === 'percent')).toBe(true);
    expect(rows.some((r) => r.charges > 0)).toBe(true);
    expect(rows.some((r) => r.equivalent_amount > 0)).toBe(true);

    for (const row of rows) {
      const totals = invoiceTotals(row);
      expect(totals.grand, row.number).toBe(row.total);
      expect(totals.subtotal, row.number).toBe(row.subtotal);
      if (row.status === 'paid') expect(totals.balance, row.number).toBe(0);
      if (row.status === 'partially-paid') expect(totals.paid, row.number).toBeGreaterThan(0);
      if (row.status === 'overdue') expect(row.due_at, row.number).toBeLessThan(todayUtc());
    }
    // One fully paid invoice was overpaid, leaving a credit.
    expect(rows.some((r) => invoiceTotals(r).credit > 0)).toBe(true);
    // Payment dates are real calendar dates.
    for (const row of rows) for (const p of parsePayments(row.payments)) expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
