import { describe, expect, it } from 'vitest';
import {
  computeTotals,
  currencyCode,
  daysUntil,
  displayStatus,
  dueDateFromTerms,
  fillTemplate,
  fmtMoney,
  formatInvoiceNumber,
  moneyInWords,
  parseItems,
  parsePayments,
  rateLabel,
  settleStatus,
  toEquivalent,
  toNaira,
} from '@/lib/invoices';
import { formatDate, fromDateInput } from '@/lib/dates';

const items = [
  { name: 'Design', desc: '', qty: 3, unitPrice: 150_000 },
  { name: 'Hosting', desc: '', qty: 12, unitPrice: 4_999.99 },
];

describe('computeTotals', () => {
  it('adds lines, discount, charges and VAT in minor units', () => {
    const t = computeTotals({ items, discount: 10_000, discountType: 'value', charges: 5_000, taxRate: 0.075 });
    // 450,000 + 59,999.88 = 509,999.88; − 10,000 + 5,000 = 504,999.88; VAT 37,874.99
    expect(t.subtotal).toBe(509_999.88);
    expect(t.discount).toBe(10_000);
    expect(t.charges).toBe(5_000);
    expect(t.tax).toBe(37_874.99);
    expect(t.total).toBe(542_874.87);
    expect(t.balance).toBe(542_874.87);
  });

  it('supports percentage discounts, capped at the subtotal', () => {
    const pct = computeTotals({ items, discount: 10, discountType: 'percent', charges: 0, taxRate: 0 });
    expect(pct.discount).toBe(50_999.99);
    const huge = computeTotals({ items, discount: 9e9, discountType: 'value', charges: 0, taxRate: 0 });
    expect(huge.discount).toBe(huge.subtotal);
    expect(huge.total).toBe(0);
  });

  it('tracks payments, balance and overpayment', () => {
    const base = { items: [{ name: 'x', desc: '', qty: 1, unitPrice: 1000 }], discount: 0, discountType: 'value' as const, charges: 0, taxRate: 0 };
    expect(computeTotals(base, [{ amount: 400 }])).toMatchObject({ paid: 400, balance: 600, overpaid: 0 });
    expect(computeTotals(base, [{ amount: 400 }, { amount: 700 }])).toMatchObject({ paid: 1100, balance: 0, overpaid: 100 });
  });

  it('avoids floating point drift', () => {
    const t = computeTotals({ items: [{ name: 'x', desc: '', qty: 3, unitPrice: 0.1 }], discount: 0, discountType: 'value', charges: 0, taxRate: 0 });
    expect(t.total).toBe(0.3);
  });
});

describe('statuses', () => {
  const totals = (paid: number, total = 1000) => ({ paid, total, balance: Math.max(0, total - paid) });

  it('settles from payments', () => {
    expect(settleStatus('sent', totals(0))).toBe('sent');
    expect(settleStatus('sent', totals(500))).toBe('partially-paid');
    expect(settleStatus('partially-paid', totals(1000))).toBe('paid');
    expect(settleStatus('draft', totals(1000))).toBe('paid');
    expect(settleStatus('paid', totals(0))).toBe('sent');
    expect(settleStatus('cancelled', totals(1000))).toBe('cancelled');
    expect(settleStatus('draft', totals(0))).toBe('draft');
  });

  it('derives overdue from the due date', () => {
    const now = Date.UTC(2026, 9, 6, 15);
    const yesterday = Date.UTC(2026, 9, 5);
    const today = Date.UTC(2026, 9, 6);
    expect(displayStatus('sent', yesterday, 100, now)).toBe('overdue');
    expect(displayStatus('partially-paid', yesterday, 100, now)).toBe('overdue');
    expect(displayStatus('sent', today, 100, now)).toBe('sent');
    expect(displayStatus('sent', yesterday, 0, now)).toBe('sent');
    expect(displayStatus('draft', yesterday, 100, now)).toBe('draft');
    expect(displayStatus('cancelled', yesterday, 100, now)).toBe('cancelled');
    expect(daysUntil(yesterday, now)).toBe(-1);
    expect(daysUntil(Date.UTC(2026, 9, 16), now)).toBe(10);
  });
});

describe('currency', () => {
  it('converts NGN invoices to USD and foreign invoices to NGN', () => {
    expect(toEquivalent(1_500_000, 'NGN', 1500)).toBe(1000);
    expect(toEquivalent(1000, 'USD', 1500)).toBe(1_500_000);
    expect(toEquivalent(1000, 'GBP', 2000)).toBe(2_000_000);
    expect(toEquivalent(1000, 'NGN', 0)).toBeNull();
    expect(toNaira(1000, 'USD', 1500)).toBe(1_500_000);
    expect(toNaira(1000, 'USD', 0)).toBeNull();
    expect(toNaira(1000, 'NGN', 0)).toBe(1000);
    expect(rateLabel('NGN', 1500)).toBe('₦1,500.00 = $1');
    expect(rateLabel('GBP', 2000)).toBe('₦2,000.00 = £1');
  });

  it('formats money and reads older currency settings', () => {
    expect(fmtMoney(1234.5, 'NGN')).toBe('₦1,234.50');
    expect(fmtMoney(-5, 'USD')).toBe('−$5.00');
    expect(currencyCode('NGN (₦)')).toBe('NGN');
    expect(currencyCode('usd')).toBe('USD');
    expect(currencyCode('XYZ')).toBe('NGN');
  });

  it('writes amounts in words with minor units', () => {
    expect(moneyInWords(6665, 'NGN')).toBe('Six Thousand, Six Hundred and Sixty-Five Naira Only');
    expect(moneyInWords(1_250_000.5, 'NGN')).toBe('One Million, Two Hundred and Fifty Thousand Naira, Fifty Kobo Only');
    expect(moneyInWords(0.99, 'USD')).toBe('Zero US Dollars, Ninety-Nine Cents Only');
  });
});

describe('helpers', () => {
  it('numbers, due dates and templates', () => {
    expect(formatInvoiceNumber('INV-', 6, 42)).toBe('INV-000042');
    expect(dueDateFromTerms('Net 14', 0)).toBe(14 * 86_400_000);
    expect(dueDateFromTerms('Due on receipt', 5)).toBe(5);
    expect(fillTemplate('Hi {client}, {number} {unknown}', { client: 'Ada', number: 'INV-1' })).toBe('Hi Ada, INV-1 {unknown}');
  });

  it('parses stored JSON defensively', () => {
    expect(parseItems('not json')).toEqual([]);
    expect(parseItems('[{"name":"a","qty":"2","unitPrice":"x"}, null]')).toEqual([{ name: 'a', desc: '', qty: 2, unitPrice: 0 }]);
    expect(parsePayments('[{"amount":5,"date":"2026-01-01"}]')[0]).toMatchObject({ id: 'pay_1', amount: 5, method: '' });
  });

  it('formats dates in UTC', () => {
    const ms = fromDateInput('2026-03-19')!;
    expect(formatDate(ms)).toBe('19 Mar 2026');
    expect(formatDate(ms, 'Mar 19, 2026')).toBe('Mar 19, 2026');
    expect(formatDate(ms, '19/03/2026')).toBe('19/03/2026');
    expect(formatDate(ms, '2026-03-19')).toBe('2026-03-19');
    expect(fromDateInput('2026-13-45')).toBeNull();
  });
});
