import { beforeAll, describe, expect, it } from 'vitest';
import { api, raw, uniqueAlias } from './helpers';
import type { InvoiceRow, LinkItem } from '@/lib/types';

const as = (email: string) => ({ 'x-dev-user': email });
const BOSS = 'boss@test.example';
const ADA = 'ada@team.example';
const CAROL = 'carol@team.example';
const FRIEND = 'friend@gmail.com';

interface Activity {
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  label: string;
  detail: string;
}

/** Every row for a query, following the cursor through the 20-row pages. */
const feed = async (query = '') => {
  const rows: Activity[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 200; i += 1) {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    if (cursor) params.set('cursor', cursor);
    const res: { body: { activity: Activity[]; next: string | null } } = await api('GET', `/api/team/activity?${params}`, undefined, as(BOSS));
    rows.push(...res.body.activity);
    cursor = res.body.next;
    if (!cursor) break;
  }
  return rows;
};

beforeAll(async () => {
  // The admin (from ADMIN_EMAILS) adds Ada and Carol; everyone else is unknown.
  for (const email of [ADA, CAROL]) {
    const res = await api('POST', '/api/team/invites', { email }, as(BOSS));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
});

describe('who gets in', () => {
  it('makes ADMIN_EMAILS admins', async () => {
    const res = await api('GET', '/api/team/me', undefined, as(BOSS));
    expect(res.body.user).toMatchObject({ email: BOSS, role: 'admin' });
  });

  it('treats added people as members', async () => {
    const res = await api('GET', '/api/team/me', undefined, as(ADA));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: ADA, role: 'member' });
  });

  it('refuses everyone else, including the company domain', async () => {
    expect((await api('GET', '/api/links', undefined, as(FRIEND))).status).toBe(401);
    expect((await api('GET', '/api/links', undefined, as('dave@team.example'))).status).toBe(401);
  });

  it('returns a one-time setup code when adding someone, and refuses duplicates', async () => {
    const res = await api('POST', '/api/team/invites', { email: FRIEND }, as(BOSS));
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect((await api('POST', '/api/team/invites', { email: FRIEND }, as(BOSS))).status).toBe(409);
    // The code itself is never readable afterwards.
    expect(JSON.stringify((await api('GET', '/api/team/users', undefined, as(BOSS))).body)).not.toContain(res.body.code);
  });

  it('removes and re-invites people', async () => {
    expect((await api('DELETE', `/api/team/users/${encodeURIComponent(CAROL)}`, undefined, as(BOSS))).status).toBe(200);
    expect((await api('GET', '/api/team/me', undefined, as(CAROL))).status).toBe(401);
    const again = await api('POST', '/api/team/invites', { email: CAROL }, as(BOSS));
    expect(again.status).toBe(201);
    expect(again.body.code).toBeTruthy();
  });

  it('protects admins and yourself from removal', async () => {
    expect((await api('DELETE', `/api/team/users/${encodeURIComponent(BOSS)}`, undefined, as(BOSS))).status).toBe(400);
  });

  it('lists the team for everyone, with details for admins only', async () => {
    const member = await api('GET', '/api/team/users', undefined, as(ADA));
    expect(member.body.users.find((u: { email: string }) => u.email === BOSS)).toEqual(
      expect.objectContaining({ email: BOSS, role: 'admin', owner: true })
    );
    expect(member.body.users[0].status).toBeUndefined();
    const admin = await api('GET', '/api/team/users', undefined, as(BOSS));
    const ada = admin.body.users.find((u: { email: string }) => u.email === ADA);
    expect(ada).toMatchObject({ status: 'invited', code_state: 'valid' });
    expect(JSON.stringify(admin.body)).not.toMatch(/password_hash|setup_code_hash|pbkdf2/);
  });

  it('lets each person set their own name', async () => {
    const res = await api('PATCH', '/api/team/me', { name: 'Ada Obi' }, as(ADA));
    expect(res.body.user.name).toBe('Ada Obi');
    expect(res.body.user.initials).toBe('AO');
  });
});

describe('what members can do', () => {
  it('cannot change settings, domains, folders or tags, export, or send test emails', async () => {
    const checks = [
      api('PATCH', '/api/settings', { workspace_name: 'Hijacked' }, as(ADA)),
      api('POST', '/api/domains', { name: 'evil.example' }, as(ADA)),
      api('PATCH', '/api/collections/does-not-matter', { kind: 'tags', name: 'Nope' }, as(ADA)),
      api('DELETE', '/api/collections/does-not-matter?kind=tags', undefined, as(ADA)),
      api('GET', '/api/export', undefined, as(ADA)),
      api('POST', '/api/email/test', {}, as(ADA)),
      api('POST', '/api/team/invites', { email: 'x@y.example' }, as(ADA)),
      api('GET', '/api/team/activity', undefined, as(ADA)),
    ];
    for (const res of await Promise.all(checks)) expect(res.status).toBe(403);
    // Members pick from the folders and tags; creating, renaming or removing them is for admins.
    expect((await api('POST', '/api/collections', { kind: 'tags', name: `member-tag-${Date.now()}` }, as(ADA))).status).toBe(403);
    expect((await api('POST', '/api/collections', { kind: 'folders', name: `member-folder-${Date.now()}` }, as(ADA))).status).toBe(403);
    expect((await api('GET', '/api/collections?kind=tags', undefined, as(ADA))).status).toBe(200);
    // Reading settings is fine: the invoice canvas needs them.
    expect((await api('GET', '/api/settings', undefined, as(ADA))).status).toBe(200);
  });

  it('creates and edits links, but only admins delete them', async () => {
    const created = await api('POST', '/api/links', { dest: 'https://example.com/a', alias: uniqueAlias('team') }, as(ADA));
    expect(created.status).toBe(201);
    const link = created.body.link as LinkItem;
    expect(link.created_by).toBe(ADA);
    expect(link.avatar).toBe('AO');

    // Members pick from the tags an admin has made, so one has to exist first.
    await api('POST', '/api/collections', { kind: 'tags', name: 'Client' }, as(BOSS)); // 409 if an earlier test made it
    const edited = await api('PATCH', `/api/links/${link.id}`, { dest: 'https://example.com/b', tag: 'Client' }, as(FRIEND));
    expect(edited.body.link).toMatchObject({ created_by: ADA, updated_by: FRIEND });

    expect((await api('DELETE', `/api/links/${link.id}`, undefined, as(ADA))).status).toBe(403);
    expect((await api('DELETE', `/api/links/${link.id}`, undefined, as(BOSS))).status).toBe(200);

    const rows = (await feed(`?type=link`)).filter((a) => a.entity_id === link.id);
    expect(rows.map((a) => [a.actor, a.action, a.detail])).toEqual([
      [BOSS, 'deleted', ''],
      [FRIEND, 'updated', 'destination and tag'],
      [ADA, 'created', 'https://example.com/a'],
    ]);
  });

  it('records who logged each invoice payment and who changed the status', async () => {
    const created = await api('POST', '/api/invoices', { client_name: 'Team Ltd', items: [{ name: 'x', qty: 1, unitPrice: 1000 }] }, as(ADA));
    const inv = created.body.invoice as InvoiceRow;
    expect(inv.created_by).toBe(ADA);
    await api('PATCH', `/api/invoices/${inv.id}`, { status: 'sent' }, as(ADA));
    const first = await api('PATCH', `/api/invoices/${inv.id}`, { payments: [{ amount: 500, date: '2026-10-01', method: 'Cash', note: '' }] }, as(ADA));
    // A second person logs another payment; the first keeps Ada's name.
    const second = await api(
      'PATCH',
      `/api/invoices/${inv.id}`,
      { payments: [...JSON.parse(first.body.invoice.payments), { amount: 575, date: '2026-10-02', method: 'Card', note: '' }] },
      as(FRIEND)
    );
    const payments = JSON.parse(second.body.invoice.payments);
    expect(payments.map((p: { by: string }) => p.by)).toEqual([ADA, FRIEND]);
    expect(second.body.invoice.status).toBe('paid');

    // A client cannot claim someone else logged a payment.
    const spoof = await api(
      'PATCH',
      `/api/invoices/${inv.id}`,
      { payments: [...payments, { amount: 1, date: '2026-10-03', method: 'Cash', note: '', by: BOSS }] },
      as(ADA)
    );
    expect(JSON.parse(spoof.body.invoice.payments)[2].by).toBe(ADA);

    const rows = (await feed('?type=invoice')).filter((a) => a.entity_id === inv.id);
    expect(rows.map((a) => `${a.actor} ${a.action}`)).toEqual(
      expect.arrayContaining([
        `${ADA} created`,
        `${ADA} status`,
        `${ADA} logged payment`,
        `${FRIEND} logged payment`,
        `${FRIEND} status`,
      ])
    );
    expect((await api('DELETE', `/api/invoices/${inv.id}`, undefined, as(FRIEND))).status).toBe(403);
  });

  it('filters the activity feed by person', async () => {
    const rows = await feed(`?actor=${encodeURIComponent(FRIEND)}`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => a.actor === FRIEND)).toBe(true);
  });
});

describe('missing short links', () => {
  it('go to the Redirect URL when one is set', async () => {
    expect((await raw('/s/does-not-exist')).status).toBe(404);
    await api('PATCH', '/api/settings', { root_redirect: 'https://company.example/' }, as(BOSS));
    try {
      const res = await raw('/s/does-not-exist');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://company.example/');
      expect((await raw('/s/')).headers.get('location')).toBe('https://company.example/');
    } finally {
      await api('PATCH', '/api/settings', { root_redirect: '' }, as(BOSS));
    }
  });
});
