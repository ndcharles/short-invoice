import { describe, expect, it } from 'vitest';
import { api, raw } from './helpers';

const DAY = 86_400_000;

const createInvoice = async (body: Record<string, unknown> = {}) => {
  const res = await api('POST', '/api/invoices', {
    client_name: 'Ada Ventures Ltd',
    client_email: 'accounts@ada.example',
    items: [{ name: 'Brand identity', desc: 'Logo and guidelines', qty: 1, unitPrice: 500_000 }],
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.invoice;
};

describe('invoice defaults and numbering', () => {
  it('applies settings defaults: currency, VAT, terms, due date and number', async () => {
    await api('PATCH', '/api/settings', {
      inv_number_prefix: 'TST-',
      inv_number_padding: '4',
      inv_next_number: '7',
      inv_tax_rate: '7.5',
      inv_payment_terms: 'Net 14',
      inv_terms_note: 'Pay within 14 days.',
      inv_default_currency: 'NGN',
    });
    const a = await createInvoice();
    const b = await createInvoice();
    expect(a.number).toBe('TST-0007');
    expect(b.number).toBe('TST-0008');
    expect(a.currency).toBe('NGN');
    expect(a.tax_rate).toBe(0.075);
    expect(a.terms).toBe('Pay within 14 days.');
    expect(a.due_at - a.issued_at).toBe(14 * DAY);
    expect(a.status).toBe('draft');
    expect(a.display_status).toBe('draft');
    expect(a.share_token).toMatch(/^[0-9a-f]{32}$/);
    expect(a.totals).toMatchObject({ subtotal: 500_000, tax: 37_500, total: 537_500, balance: 537_500 });
    expect(a.equivalent).toBeNull();

    const settings = await api('GET', '/api/settings');
    expect(settings.body.settings.inv_next_number).toBe('9');
  });

  it('allocates unique numbers under concurrent creates', async () => {
    const created = await Promise.all(Array.from({ length: 6 }, () => createInvoice()));
    const numbers = created.map((inv) => inv.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('rejects a duplicate manual number', async () => {
    const a = await createInvoice({ number: 'MANUAL-1' });
    expect(a.number).toBe('MANUAL-1');
    const dup = await api('POST', '/api/invoices', { client_name: 'X', number: 'MANUAL-1' });
    expect(dup.status).toBe(409);
    const b = await createInvoice();
    expect((await api('PATCH', `/api/invoices/${b.id}`, { number: 'MANUAL-1' })).status).toBe(409);
  });
});

describe('invoice validation', () => {
  it.each([
    ['missing client', { client_name: '' }],
    ['bad email', { client_email: 'not-an-email' }],
    ['unknown currency', { currency: 'XYZ' }],
    ['negative price', { items: [{ name: 'x', qty: 1, unitPrice: -5 }] }],
    ['items not a list', { items: 'x' }],
    ['percent over 100', { discount: 150, discount_type: 'percent' }],
    ['tax as percent instead of fraction', { tax_rate: 7.5 }],
    ['paid set directly', { status: 'paid' }],
    ['script in the number', { number: '<script>' }],
    ['bad date', { due_at: 'tomorrow' }],
    ['control characters in a name', { items: [{ name: 'a\u0000b', qty: 1, unitPrice: 1 }] }],
  ])('rejects %s', async (_label, patch) => {
    const res = await api('POST', '/api/invoices', { client_name: 'Valid Client', ...patch });
    expect(res.status).toBe(400);
  });

  it('rejects a due date before the invoice date', async () => {
    const inv = await createInvoice();
    const res = await api('PATCH', `/api/invoices/${inv.id}`, { due_at: inv.issued_at - 2 * DAY });
    expect(res.status).toBe(400);
  });

  it('recomputes totals on the server, ignoring client-sent totals', async () => {
    const res = await api('POST', '/api/invoices', {
      client_name: 'Totals Check',
      items: [{ name: 'a', qty: 2, unitPrice: 100 }],
      total: 1,
      subtotal: 1,
    });
    expect(res.body.invoice.total).toBe(215);
    expect(res.body.invoice.totals.total).toBe(215);
  });
});

describe('invoice lifecycle', () => {
  it('goes draft → sent → partially paid → paid, with payments removable', async () => {
    const inv = await createInvoice({ tax_rate: 0 });
    const sent = await api('PATCH', `/api/invoices/${inv.id}`, { status: 'sent' });
    expect(sent.body.invoice.status).toBe('sent');
    expect(sent.body.invoice.sent_at).toBeGreaterThan(0);

    const partial = await api('POST', `/api/invoices/${inv.id}/payments`, { amount: 200_000, date: '2026-10-01', method: 'Bank transfer', note: '40% deposit' });
    expect(partial.status).toBe(201);
    expect(partial.body.invoice.status).toBe('partially-paid');
    expect(partial.body.invoice.totals).toMatchObject({ paid: 200_000, balance: 300_000 });

    const paid = await api('POST', `/api/invoices/${inv.id}/payments`, { amount: 300_000, date: '2026-10-05', method: 'Cash' });
    expect(paid.body.invoice.status).toBe('paid');
    expect(paid.body.invoice.totals.balance).toBe(0);

    const payments = JSON.parse(paid.body.invoice.payments);
    expect(payments).toHaveLength(2);
    const removed = await api('DELETE', `/api/invoices/${inv.id}/payments/${payments[1].id}`);
    expect(removed.body.invoice.status).toBe('partially-paid');
    const none = await api('DELETE', `/api/invoices/${inv.id}/payments/${payments[0].id}`);
    expect(none.body.invoice.status).toBe('sent');
  });

  it('marks a draft as sent when a payment is logged and records overpayment', async () => {
    const inv = await createInvoice({ tax_rate: 0 });
    const res = await api('POST', `/api/invoices/${inv.id}/payments`, { amount: 600_000 });
    expect(res.body.invoice.status).toBe('paid');
    expect(res.body.invoice.totals.overpaid).toBe(100_000);
    expect(res.body.invoice.sent_at).toBeGreaterThan(0);
  });

  it('becomes paid when the total drops to what was already paid', async () => {
    const inv = await createInvoice({ tax_rate: 0, status: 'sent' });
    await api('POST', `/api/invoices/${inv.id}/payments`, { amount: 400_000 });
    const res = await api('PATCH', `/api/invoices/${inv.id}`, { discount: 100_000 });
    expect(res.body.invoice.status).toBe('paid');
  });

  it('derives overdue for unpaid sent invoices past their due date', async () => {
    const inv = await createInvoice({ status: 'sent', issued_at: Date.now() - 40 * DAY, due_at: Date.now() - 10 * DAY });
    expect(inv.status).toBe('sent');
    expect(inv.display_status).toBe('overdue');
    const list = await api('GET', '/api/invoices?status=overdue');
    expect(list.body.invoices.map((i: { id: string }) => i.id)).toContain(inv.id);
    expect(list.body.counts.overdue).toBeGreaterThanOrEqual(1);
  });

  it('refuses payments on cancelled invoices and validates amounts', async () => {
    const inv = await createInvoice({ status: 'cancelled' });
    expect((await api('POST', `/api/invoices/${inv.id}/payments`, { amount: 10 })).status).toBe(409);
    const open = await createInvoice();
    expect((await api('POST', `/api/invoices/${open.id}/payments`, { amount: 0 })).status).toBe(400);
    expect((await api('POST', `/api/invoices/${open.id}/payments`, { amount: -5 })).status).toBe(400);
    expect((await api('POST', `/api/invoices/${open.id}/payments`, { amount: 5, date: 'yesterday' })).status).toBe(400);
  });

  it('duplicates as a fresh draft and deletes', async () => {
    const inv = await createInvoice({ status: 'sent', reference: 'PO-77', exchange_rate: 1500 });
    await api('POST', `/api/invoices/${inv.id}/payments`, { amount: 1000 });
    const copy = await api('POST', `/api/invoices/${inv.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body.invoice.number).not.toBe(inv.number);
    expect(copy.body.invoice.status).toBe('draft');
    expect(JSON.parse(copy.body.invoice.payments)).toEqual([]);
    expect(copy.body.invoice.reference).toBe('PO-77');
    expect(copy.body.invoice.exchange_rate).toBe(1500);
    expect(copy.body.invoice.share_token).not.toBe(inv.share_token);

    expect((await api('DELETE', `/api/invoices/${copy.body.invoice.id}`)).status).toBe(200);
    expect((await api('GET', `/api/invoices/${copy.body.invoice.id}`)).status).toBe(404);
  });

  it('searches by number, client and reference and filters by folder', async () => {
    const inv = await createInvoice({ client_name: 'Searchable Client Co', reference: 'REF-SEARCH-1' });
    for (const q of ['searchable', inv.number, 'ref-search']) {
      const res = await api('GET', `/api/invoices?search=${encodeURIComponent(q)}`);
      expect(res.body.invoices.map((i: { id: string }) => i.id)).toContain(inv.id);
    }
    const other = await api('GET', '/api/invoices?folder=Nope');
    expect(other.body.invoices).toHaveLength(0);
  });

  it('lists past clients for autocomplete', async () => {
    await createInvoice({ client_name: 'Repeat Client', client_address: '1 Marina\nLagos' });
    const res = await api('GET', '/api/invoices/clients');
    const client = res.body.clients.find((c: { client_name: string }) => c.client_name === 'Repeat Client');
    expect(client.client_address).toBe('1 Marina\nLagos');
  });
});

describe('currency equivalents', () => {
  it('shows a USD equivalent on a naira invoice', async () => {
    const inv = await createInvoice({ tax_rate: 0, exchange_rate: 1600, items: [{ name: 'Retainer', qty: 1, unitPrice: 1_600_000 }] });
    expect(inv.equivalent).toEqual({ currency: 'USD', rate: 1600, total: 1000, balance: 1000 });
  });

  it('shows a naira equivalent on a foreign-currency invoice', async () => {
    const inv = await createInvoice({ currency: 'GBP', tax_rate: 0, exchange_rate: 2100, items: [{ name: 'Audit', qty: 2, unitPrice: 500 }] });
    expect(inv.equivalent).toEqual({ currency: 'NGN', rate: 2100, total: 2_100_000, balance: 2_100_000 });
  });

  it('can turn the equivalent off', async () => {
    const inv = await createInvoice({ exchange_rate: 1500 });
    const res = await api('PATCH', `/api/invoices/${inv.id}`, { exchange_rate: 0 });
    expect(res.body.invoice.equivalent).toBeNull();
  });
});

describe('public client view', () => {
  it('renders the invoice with the USD column, escapes content and records the first view', async () => {
    const inv = await createInvoice({
      client_name: 'Evil <script>alert(1)</script> Ltd',
      exchange_rate: 1500,
      tax_rate: 0,
      notes: 'Thanks!\n<img src=x onerror=alert(1)>',
      items: [{ name: 'Workshop', desc: 'Two days', qty: 2, unitPrice: 750_000 }],
    });
    const preview = await raw(`/s/i/${inv.share_token}?preview=1`);
    expect(preview.status).toBe(200);
    const html = await preview.text();
    expect(html).toContain('Workshop');
    expect(html).toContain('₦1,500,000.00');
    expect(html).toContain('$1,000.00');
    expect(html).toContain('₦1,500.00 = $1');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(preview.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(preview.headers.get('x-robots-tag')).toContain('noindex');

    // Previews do not count as the client opening it; a real visit does.
    expect((await api('GET', `/api/invoices/${inv.id}`)).body.invoice.viewed_at).toBeNull();
    await raw(`/s/i/${inv.share_token}`);
    let viewed = null;
    for (let i = 0; i < 30 && !viewed; i++) {
      viewed = (await api('GET', `/api/invoices/${inv.id}`)).body.invoice.viewed_at;
      if (!viewed) await new Promise((r) => setTimeout(r, 100));
    }
    expect(viewed).toBeGreaterThan(0);
  });

  it('renders a receipt once paid', async () => {
    const inv = await createInvoice({ tax_rate: 0, status: 'sent' });
    await api('POST', `/api/invoices/${inv.id}/payments`, { amount: 500_000, method: 'Bank transfer', date: '2026-10-02' });
    const html = await (await raw(`/s/i/${inv.share_token}?doc=receipt&preview=1`)).text();
    expect(html).toContain('Receipt');
    expect(html).toContain('Paid in full');
    expect(html).toContain('Bank transfer');
  });

  it('stops serving the old link after a reset and 404s unknown tokens', async () => {
    const inv = await createInvoice();
    const reset = await api('POST', `/api/invoices/${inv.id}/share/reset`);
    expect(reset.body.invoice.share_token).not.toBe(inv.share_token);
    expect((await raw(`/s/i/${inv.share_token}`)).status).toBe(404);
    expect((await raw(`/s/i/${reset.body.invoice.share_token}?preview=1`)).status).toBe(200);
    expect((await raw('/s/i/not-a-token')).status).toBe(404);
    expect((await raw(`/s/i/${'0'.repeat(32)}`)).status).toBe(404);
  });
});

describe('export', () => {
  it('exports everything without password hashes or the verify token', async () => {
    const res = await raw('/api/export');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.invoices)).toBe(true);
    expect(JSON.stringify(data)).not.toContain('pbkdf2');
    expect(data.settings.domain_verify_token).toBeUndefined();
  });
});
