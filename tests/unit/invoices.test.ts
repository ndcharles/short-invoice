import { describe, expect, it } from 'vitest';
import {
  convertEquivalent,
  currencyCode,
  currencySymbol,
  discountAmount,
  draftTotals,
  dueDateFor,
  fillTemplate,
  fmtMoney,
  invoiceEquivalent,
  invoiceTotals,
  joinAddress,
  moneyInWords,
  parseItems,
  parseMoneyInput,
  parsePayments,
  rateLine,
  resolveStatus,
  splitAddress,
  termsDays,
} from '@/lib/invoices';
import { parseInvoiceInput } from '../../worker/lib/invoice-input';

const DAY = 86_400_000;
const item = (qty: number, unitPrice: number) => ({ name: 'Item', desc: '', qty, unitPrice });

describe('draftTotals', () => {
  it('applies discount, then charges, then tax on the result', () => {
    // 100,000 − 10,000 + 5,000 = 95,000; 7.5% tax = 7,125
    const t = draftTotals({ items: [item(2, 50_000)], discount: 10, discountType: 'percent', charges: 5_000, taxRate: 0.075 });
    expect(t).toEqual({ subtotal: 100_000, discount: 10_000, charges: 5_000, tax: 7_125, grand: 102_125 });
  });

  it('treats a value discount as a flat amount', () => {
    const t = draftTotals({ items: [item(1, 1_000)], discount: 250, discountType: 'value', taxRate: 0 });
    expect(t.grand).toBe(750);
  });

  it('never discounts below zero or past 100%', () => {
    expect(discountAmount({ items: [item(1, 500)], discount: 900, discountType: 'value' })).toBe(500);
    expect(discountAmount({ items: [item(1, 500)], discount: 150, discountType: 'percent' })).toBe(500);
    expect(draftTotals({ items: [item(1, 500)], discount: 900, taxRate: 0.075 }).grand).toBe(0);
  });

  it('rounds every row to kobo so the printed rows add up', () => {
    const t = draftTotals({ items: [item(3, 33.333)], discount: 0, taxRate: 0.075 });
    expect(t.subtotal).toBe(100);
    expect(t.tax).toBe(7.5);
    expect(t.grand).toBe(t.subtotal - t.discount + t.charges + t.tax);
  });

  it('handles an empty invoice', () => {
    expect(draftTotals({ items: [], discount: 0, taxRate: 0.075 }).grand).toBe(0);
  });
});

describe('invoiceTotals', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    items: JSON.stringify([item(1, 200_000)]),
    payments: '[]',
    total: 0,
    tax_rate: 0.075,
    discount: 0,
    discount_type: 'value',
    charges: 0,
    ...over,
  });

  it('derives the total from items and nets off payments', () => {
    const t = invoiceTotals(row({ payments: JSON.stringify([{ amount: 15_000, date: '2026-10-01', method: 'Cash', note: '' }]) }));
    expect(t.grand).toBe(215_000);
    expect(t.paid).toBe(15_000);
    expect(t.balance).toBe(200_000);
    expect(t.credit).toBe(0);
  });

  it('reports overpayment as credit, never a negative balance', () => {
    const t = invoiceTotals(row({ payments: JSON.stringify([{ amount: 220_000, date: '2026-10-01', method: '', note: '' }]) }));
    expect(t.balance).toBe(0);
    expect(t.credit).toBe(5_000);
  });

  it('keeps the stored total for legacy rows without items', () => {
    const t = invoiceTotals(row({ items: '[]', total: 1_075 }));
    expect(t.grand).toBe(1_075);
    expect(t.subtotal).toBe(1_000);
    expect(t.tax).toBe(75);
  });

  it('includes charges and percentage discounts (the list used to ignore them)', () => {
    const t = invoiceTotals(row({ discount: 50, discount_type: 'percent', charges: 10_000, tax_rate: 0 }));
    expect(t.grand).toBe(110_000);
  });
});

describe('currency equivalent', () => {
  it('converts a naira invoice to dollars at naira-per-dollar', () => {
    const eq = invoiceEquivalent({ currency: 'NGN', grand: 1_550_000, balance: 775_000, exchangeRate: 1_550 });
    expect(eq).toMatchObject({ code: 'USD', total: 1_000, balance: 500, overridden: false, rateLine: '₦1,550 = $1' });
  });

  it('converts a dollar invoice to naira', () => {
    const eq = invoiceEquivalent({ currency: 'USD', grand: 4_800, balance: 4_800, exchangeRate: 1_550 });
    expect(eq).toMatchObject({ code: 'NGN', total: 7_440_000 });
  });

  it('lets an agreed figure override the conversion, keeping the balance proportional', () => {
    const eq = invoiceEquivalent({ currency: 'NGN', grand: 3_100_000, balance: 1_550_000, exchangeRate: 1_550, equivalentAmount: 2_100 });
    expect(eq).toMatchObject({ total: 2_100, balance: 1_050, overridden: true });
  });

  it('is hidden when no rate is set', () => {
    expect(invoiceEquivalent({ currency: 'NGN', grand: 1_000, balance: 1_000, exchangeRate: 0, equivalentAmount: 50 })).toBeNull();
  });

  it('labels the rate against the foreign currency', () => {
    expect(rateLine('NGN', 1500)).toBe('₦1,500 = $1');
    expect(rateLine('EUR', 1650.5)).toBe('₦1,650.5 = €1');
    expect(convertEquivalent(3_000, 'NGN', 1_500)).toBe(2);
    expect(convertEquivalent(3_000, 'NGN', 0)).toBe(0);
  });
});

describe('resolveStatus', () => {
  const now = Date.UTC(2026, 9, 6, 15, 0);
  const today = Date.UTC(2026, 9, 6);
  const base = { grand: 1_000, paid: 0, dueAt: today + 10 * DAY, now };

  it('keeps drafts and cancelled invoices as set', () => {
    expect(resolveStatus({ ...base, status: 'draft', dueAt: today - 10 * DAY })).toBe('draft');
    expect(resolveStatus({ ...base, status: 'cancelled', paid: 1_000 })).toBe('cancelled');
  });

  it('marks issued invoices overdue only after the due date', () => {
    expect(resolveStatus({ ...base, status: 'sent' })).toBe('sent');
    expect(resolveStatus({ ...base, status: 'sent', dueAt: today })).toBe('sent');
    expect(resolveStatus({ ...base, status: 'sent', dueAt: today - DAY })).toBe('overdue');
    // Moving the due date forward clears overdue.
    expect(resolveStatus({ ...base, status: 'overdue' })).toBe('sent');
  });

  it('follows payments', () => {
    expect(resolveStatus({ ...base, status: 'sent', paid: 400 })).toBe('partially-paid');
    expect(resolveStatus({ ...base, status: 'overdue', paid: 1_000 })).toBe('paid');
    expect(resolveStatus({ ...base, status: 'sent', paid: 1_200 })).toBe('paid');
    // A payment logged against a draft issues it.
    expect(resolveStatus({ ...base, status: 'draft', paid: 100 })).toBe('partially-paid');
  });

  it('reopens an invoice whose payments were removed or whose total grew', () => {
    expect(resolveStatus({ ...base, status: 'paid' })).toBe('sent');
    expect(resolveStatus({ ...base, status: 'paid', dueAt: today - DAY })).toBe('overdue');
    expect(resolveStatus({ ...base, status: 'paid', paid: 900 })).toBe('partially-paid');
  });

  it('falls back to draft for unknown values', () => {
    expect(resolveStatus({ ...base, status: 'nonsense' })).toBe('draft');
  });
});

describe('payment terms', () => {
  it('reads the number of days', () => {
    expect(termsDays('Net 30')).toBe(30);
    expect(termsDays('net14')).toBe(14);
    expect(termsDays('Due on receipt')).toBe(0);
    expect(termsDays('Custom')).toBeNull();
  });

  it('dates from the start of the invoice day', () => {
    const issued = Date.UTC(2026, 9, 6, 13, 45);
    expect(dueDateFor(issued, 'Net 14')).toBe(Date.UTC(2026, 9, 20));
    expect(dueDateFor(issued, 'Custom')).toBe(Date.UTC(2026, 10, 5));
  });
});

describe('formatting', () => {
  it('formats money with the currency symbol', () => {
    expect(fmtMoney(1_234_567.5)).toBe('₦1,234,567.50');
    expect(fmtMoney(99, 'USD')).toBe('$99.00');
    expect(fmtMoney(-5, 'GBP')).toBe('−£5.00');
    expect(fmtMoney(10, 'XYZ')).toBe('XYZ 10.00');
  });

  it('writes amounts in words with kobo', () => {
    expect(moneyInWords(1_151_325)).toBe('One Million, One Hundred and Fifty-One Thousand, Three Hundred and Twenty-Five Naira Only');
    expect(moneyInWords(575_662.5)).toBe('Five Hundred and Seventy-Five Thousand, Six Hundred and Sixty-Two Naira, Fifty Kobo Only');
    expect(moneyInWords(0, 'USD')).toBe('Zero US Dollars Only');
  });

  it('reads currency labels from settings', () => {
    expect(currencyCode('NGN (₦)')).toBe('NGN');
    expect(currencyCode('usd ($)')).toBe('USD');
    expect(currencyCode('')).toBe('NGN');
    expect(currencySymbol('AED', ['AED (د.إ)'])).toBe('د.إ');
  });

  it('parses typed money', () => {
    expect(parseMoneyInput('₦1,500.50')).toBe(1500.5);
    expect(parseMoneyInput('')).toBe(0);
    expect(parseMoneyInput('-20')).toBe(20);
  });

  it('fills email templates and leaves unknown placeholders', () => {
    expect(fillTemplate('Hi {client}, {number} is {amount}. {other}', { client: 'Ada', number: 'INV-1', amount: '₦5' })).toBe(
      'Hi Ada, INV-1 is ₦5. {other}'
    );
  });
});

describe('client address', () => {
  it('keeps empty lines in place so fields do not shift', () => {
    const stored = joinAddress({ name: 'Acme', contact: '', addr1: '1 Road', addr2: '', country: 'Ghana' });
    expect(stored).toBe('Acme\n\n1 Road\n\nGhana');
    expect(splitAddress(stored)).toEqual({ contact: '', addr1: '1 Road', addr2: '', country: 'Ghana' });
  });

  it('drops trailing empty lines and flattens newlines inside a field', () => {
    expect(joinAddress({ name: 'Acme', contact: 'Ada\nObi', addr1: '', addr2: '', country: '' })).toBe('Acme\nAda Obi');
  });
});

describe('stored JSON', () => {
  it('normalises items and payments', () => {
    expect(parseItems('[{"name":"A","qty":"2","unitPrice":"5"}, null, 3]')).toEqual([{ name: 'A', desc: '', qty: 2, unitPrice: 5 }]);
    expect(parseItems('not json')).toEqual([]);
    expect(parsePayments('[{"amount":10}]')).toEqual([{ amount: 10, date: '', method: '', note: '' }]);
  });
});

describe('parseInvoiceInput', () => {
  const valid = {
    client_name: '  Acme Ltd ',
    client_email: 'ap@acme.com',
    currency: 'ngn',
    items: [{ name: 'Design', desc: 'Two rounds', qty: 2, unitPrice: 1500 }],
    payments: [{ amount: 100, date: '2026-10-01', method: 'Cash', note: '' }],
    tax_rate: 0.075,
    discount: 10,
    discount_type: 'percent',
    exchangeRate: 1550,
    issued_at: Date.UTC(2026, 9, 1),
    due_at: Date.UTC(2026, 9, 31),
  };

  it('accepts and normalises a full invoice', () => {
    const res = parseInvoiceInput(valid);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({ client_name: 'Acme Ltd', currency: 'NGN', exchange_rate: 1550, discount_type: 'percent' });
    expect(res.value.items).toEqual([{ name: 'Design', desc: 'Two rounds', qty: 2, unitPrice: 1500 }]);
  });

  it('only returns the keys that were sent', () => {
    expect(parseInvoiceInput({ notes: 'Thanks' })).toEqual({ ok: true, value: { notes: 'Thanks' } });
  });

  it.each([
    [{ items: [{ name: 'A', qty: -1, unitPrice: 5 }] }, 'quantity'],
    [{ items: [{ name: 'A', qty: 1, unitPrice: -5 }] }, 'price'],
    [{ items: 'nope' }, 'list'],
    [{ payments: [{ amount: 0, date: '2026-10-01' }] }, 'amount'],
    [{ payments: [{ amount: 5, date: '01/10/2026' }] }, 'date'],
    [{ currency: 'naira' }, 'Currency'],
    [{ status: 'archived' }, 'status'],
    [{ client_email: 'not-an-email' }, 'email'],
    [{ tax_rate: 7.5 }, 'Tax rate'],
    [{ discount: 120, discount_type: 'percent' }, '100%'],
    [{ discount_type: 'half' }, 'Discount type'],
    [{ exchange_rate: -1 }, 'Exchange rate'],
    [{ issued_at: 'yesterday' }, 'Invoice date'],
    [{ due_at: 1 }, 'Due date'],
    [{ issued_at: Date.UTC(2026, 9, 10), due_at: Date.UTC(2026, 9, 1) }, 'before'],
    [{ client_name: 'Acme\u0000' }, 'invalid'],
    [{ items: Array.from({ length: 201 }, () => ({ name: 'x', qty: 1, unitPrice: 1 })) }, 'at most'],
  ])('rejects %j', (body, message) => {
    const res = parseInvoiceInput(body as Record<string, unknown>);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(message);
  });
});
