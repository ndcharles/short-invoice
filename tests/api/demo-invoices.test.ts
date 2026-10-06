import { beforeAll, describe, expect, inject, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { api, raw } from './helpers';

const ROOT = path.resolve(__dirname, '../..');

function runSql(file: string) {
  execFileSync(
    path.join(ROOT, 'node_modules/.bin/wrangler'),
    ['d1', 'execute', 'short-invoice', '--local', '--persist-to', inject('persistDir'), '--file', file],
    { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe' }
  );
}

interface Inv {
  number: string;
  display_status: string;
  status: string;
  currency: string;
  share_token: string;
  totals: { total: number; paid: number; balance: number; overpaid: number; discount: number; tax: number };
  equivalent: { currency: string; total: number } | null;
}

let byNumber: Map<string, Inv>;

describe('demo invoice seed', () => {
  beforeAll(async () => {
    // Twice: the seed must be idempotent.
    runSql('seed/demo-invoices.sql');
    runSql('seed/demo-invoices.sql');
    const res = await api('GET', '/api/invoices?search=DEMO-');
    byNumber = new Map((res.body.invoices as Inv[]).map((inv) => [inv.number, inv]));
  }, 120_000);

  it('loads twelve invoices exactly once', () => {
    expect(byNumber.size).toBe(12);
  });

  it.each([
    ['DEMO-0001', 'draft', 1_268_500, 0],
    ['DEMO-0002', 'sent', 612_750, 0],
    ['DEMO-0003', 'overdue', 645_000, 0],
    ['DEMO-0004', 'partially-paid', 1_236_250, 618_125],
    ['DEMO-0005', 'overdue', 1_505_000, 500_000],
    ['DEMO-0006', 'paid', 483_750, 483_750],
    ['DEMO-0007', 'sent', 3_255_000, 0],
    ['DEMO-0008', 'paid', 1_650, 1_650],
    ['DEMO-0009', 'cancelled', 752_500, 0],
    ['DEMO-0010', 'sent', 722_500, 0],
    ['DEMO-0011', 'paid', 193_500, 200_000],
    ['DEMO-0012', 'sent', 344_000, 0],
  ])('%s is %s with total %d and paid %d', (number, status, total, paid) => {
    const inv = byNumber.get(number)!;
    expect(inv.display_status).toBe(status);
    expect(inv.totals.total).toBe(total);
    expect(inv.totals.paid).toBe(paid);
  });

  it('covers the special cases', () => {
    expect(byNumber.get('DEMO-0005')!.status).toBe('partially-paid');
    expect(byNumber.get('DEMO-0005')!.totals.balance).toBe(1_005_000);
    expect(byNumber.get('DEMO-0007')!.equivalent).toMatchObject({ currency: 'USD', total: 2100 });
    expect(byNumber.get('DEMO-0008')!.equivalent).toMatchObject({ currency: 'NGN', total: 2_557_500 });
    expect(byNumber.get('DEMO-0010')!.totals.discount).toBe(112_500);
    expect(byNumber.get('DEMO-0010')!.totals.tax).toBe(0);
    expect(byNumber.get('DEMO-0011')!.totals.overpaid).toBe(6_500);
  });

  it('renders every demo invoice and receipt', async () => {
    for (const inv of byNumber.values()) {
      const doc = await raw(`/s/i/${inv.share_token}?preview=1`);
      expect(doc.status).toBe(200);
      expect(await doc.text()).toContain(inv.number);
    }
    const receipt = await (await raw(`/s/i/${byNumber.get('DEMO-0006')!.share_token}?doc=receipt&preview=1`)).text();
    expect(receipt).toContain('Paystack');
    expect(receipt).toContain('PAID');
  });

  it('cleans up without touching other invoices', async () => {
    const before = (await api('GET', '/api/invoices')).body.invoices.length;
    runSql('seed/demo-invoices-clean.sql');
    const after = (await api('GET', '/api/invoices')).body.invoices.length;
    expect(before - after).toBe(12);
    expect((await api('GET', '/api/invoices?search=DEMO-')).body.invoices).toHaveLength(0);
  });
});
