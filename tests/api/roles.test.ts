import { beforeAll, describe, expect, it } from 'vitest';
import { api, TEST_ADMIN, uniqueAlias } from './helpers';
import type { LinkItem } from '@/lib/types';

const OWNER = TEST_ADMIN;
const stamp = Date.now();
const DELEGATE = `delegate-${stamp}@roles.example`;
const MEMBER = `member-${stamp}@roles.example`;
const as = (email: string) => ({ 'x-dev-user': email });
const enc = encodeURIComponent;

interface Activity {
  actor: string;
  action: string;
  label: string;
}
const feed = async () => (await api('GET', '/api/team/activity?type=team', undefined, as(OWNER))).body.activity as Activity[];

beforeAll(async () => {
  for (const email of [DELEGATE, MEMBER]) expect((await api('POST', '/api/team/invites', { email }, as(OWNER))).status).toBe(201);
});

describe('owner, admin and member', () => {
  it('marks the owner (ADMIN_EMAILS) and nobody else as the owner', async () => {
    expect((await api('GET', '/api/team/me', undefined, as(OWNER))).body.user).toMatchObject({ email: OWNER, role: 'admin', owner: true });
    expect((await api('GET', '/api/team/me', undefined, as(MEMBER))).body.user).toMatchObject({ email: MEMBER, role: 'member', owner: false });
    const list = (await api('GET', '/api/team/users', undefined, as(MEMBER))).body;
    expect(list.users.find((u: { email: string }) => u.email === OWNER)).toMatchObject({ owner: true, role: 'admin' });
    expect(list.users.find((u: { email: string }) => u.email === MEMBER)).toMatchObject({ owner: false, role: 'member' });
    expect(list.admins).toBeUndefined();
  });

  it('only the owner can give or take away admin access', async () => {
    const granted = await api('PATCH', `/api/team/users/${enc(DELEGATE)}`, { role: 'admin' }, as(OWNER));
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({ email: DELEGATE, role: 'admin' });
    expect((await api('GET', '/api/team/me', undefined, as(DELEGATE))).body.user).toMatchObject({ role: 'admin', owner: false });
    const shown = (await api('GET', '/api/team/users', undefined, as(OWNER))).body.users.find((u: { email: string }) => u.email === DELEGATE);
    expect(shown).toMatchObject({ role: 'admin', owner: false });
    expect((await feed()).find((a) => a.label === DELEGATE && a.action === 'gave admin access to')?.actor).toBe(OWNER);
  });

  it('a delegated admin can do the admin things', async () => {
    const admin = as(DELEGATE);
    expect((await api('GET', '/api/export', undefined, admin)).status).toBe(200);
    expect((await api('GET', '/api/team/activity', undefined, admin)).status).toBe(200);
    expect((await api('PATCH', '/api/settings', { default_folder: (await api('GET', '/api/settings', undefined, admin)).body.settings.default_folder }, admin)).status).toBe(200);
    const folder = await api('POST', '/api/collections', { kind: 'folders', name: `Admin folder ${stamp}` }, admin);
    expect(folder.status).toBe(201);
    expect((await api('PATCH', `/api/collections/${folder.body.item.id}`, { kind: 'folders', name: `Renamed ${stamp}` }, admin)).status).toBe(200);
    expect((await api('DELETE', `/api/collections/${folder.body.item.id}?kind=folders`, undefined, admin)).status).toBe(200);
    const link = await api('POST', '/api/links', { dest: 'https://example.com/r', alias: uniqueAlias('role') }, admin);
    expect((await api('DELETE', `/api/links/${(link.body.link as LinkItem).id}`, undefined, admin)).status).toBe(200);
  });

  it('but cannot manage the team, so nobody can promote themselves or lock the owner out', async () => {
    const admin = as(DELEGATE);
    const attempts: [string, string, unknown?][] = [
      ['POST', '/api/team/invites', { email: 'sneaky@roles.example' }],
      ['POST', `/api/team/users/${enc(MEMBER)}/code`],
      ['DELETE', `/api/team/users/${enc(MEMBER)}`],
      ['DELETE', `/api/team/users/${enc(OWNER)}`],
      ['PATCH', `/api/team/users/${enc(MEMBER)}`, { role: 'admin' }],
      ['PATCH', `/api/team/users/${enc(DELEGATE)}`, { role: 'admin' }],
      ['PATCH', `/api/team/users/${enc(OWNER)}`, { role: 'member' }],
    ];
    for (const [method, route, body] of attempts) {
      const res = await api(method, route, body, admin);
      expect(res.status, `${method} ${route}`).toBe(403);
      expect(res.body.code).toBe('owner_only');
    }
    // Still an admin afterwards, and the member is still a member.
    expect((await api('GET', '/api/team/me', undefined, as(MEMBER))).body.user.role).toBe('member');
  });

  it('a member cannot give themselves admin access', async () => {
    const res = await api('PATCH', `/api/team/users/${enc(MEMBER)}`, { role: 'admin' }, as(MEMBER));
    expect(res.status).toBe(403);
    expect((await api('PATCH', '/api/settings', { workspace_name: 'x' }, as(MEMBER))).status).toBe(403);
  });

  it('taking admin access back applies on the very next request', async () => {
    expect((await api('PATCH', '/api/settings', {}, as(DELEGATE))).status).toBe(200);
    expect((await api('PATCH', `/api/team/users/${enc(DELEGATE)}`, { role: 'member' }, as(OWNER))).status).toBe(200);
    expect((await api('PATCH', '/api/settings', {}, as(DELEGATE))).status).toBe(403);
    expect((await api('GET', '/api/export', undefined, as(DELEGATE))).status).toBe(403);
    expect((await feed()).find((a) => a.label === DELEGATE && a.action === 'took admin access from')?.actor).toBe(OWNER);
  });

  it('refuses nonsense: the owner, unknown people, bad roles and removed people', async () => {
    expect((await api('PATCH', `/api/team/users/${enc(OWNER)}`, { role: 'member' }, as(OWNER))).status).toBe(400);
    expect((await api('PATCH', `/api/team/users/${enc('nobody@roles.example')}`, { role: 'admin' }, as(OWNER))).status).toBe(404);
    for (const role of ['owner', 'superuser', '', null, 1, undefined]) {
      expect((await api('PATCH', `/api/team/users/${enc(MEMBER)}`, { role }, as(OWNER))).status, String(role)).toBe(400);
    }
    const gone = `gone-${stamp}@roles.example`;
    await api('POST', '/api/team/invites', { email: gone }, as(OWNER));
    await api('DELETE', `/api/team/users/${enc(gone)}`, undefined, as(OWNER));
    expect((await api('PATCH', `/api/team/users/${enc(gone)}`, { role: 'admin' }, as(OWNER))).status).toBe(409);
  });

  it('removing a delegated admin takes the access with them, even if they are added again', async () => {
    const temp = `temp-admin-${stamp}@roles.example`;
    await api('POST', '/api/team/invites', { email: temp }, as(OWNER));
    await api('PATCH', `/api/team/users/${enc(temp)}`, { role: 'admin' }, as(OWNER));
    expect((await api('GET', '/api/team/me', undefined, as(temp))).body.user.role).toBe('admin');
    expect((await api('DELETE', `/api/team/users/${enc(temp)}`, undefined, as(OWNER))).status).toBe(200);
    expect((await api('GET', '/api/team/me', undefined, as(temp))).status).toBe(401);
    await api('POST', '/api/team/invites', { email: temp }, as(OWNER));
    expect((await api('GET', '/api/team/me', undefined, as(temp))).body.user).toMatchObject({ role: 'member', owner: false });
  });
});

describe('folders and tags are for picking, not inventing', () => {
  const tag = `Pick tag ${stamp}`;
  const folder = `Pick folder ${stamp}`;
  const member = as(MEMBER);

  beforeAll(async () => {
    expect((await api('POST', '/api/collections', { kind: 'tags', name: tag }, as(OWNER))).status).toBe(201);
    expect((await api('POST', '/api/collections', { kind: 'folders', name: folder }, as(OWNER))).status).toBe(201);
  });

  it('members can read the lists but not add to them', async () => {
    const list = await api('GET', '/api/collections?kind=tags', undefined, member);
    expect(list.status).toBe(200);
    expect(list.body.items.map((t: { name: string }) => t.name)).toContain(tag);
    for (const kind of ['tags', 'folders']) {
      const res = await api('POST', '/api/collections', { kind, name: `Sneaky ${kind} ${stamp}` }, member);
      expect(res.status, kind).toBe(403);
    }
    const after = await api('GET', '/api/collections?kind=tags', undefined, member);
    expect(JSON.stringify(after.body)).not.toContain('Sneaky');
  });

  it('a link takes existing folders and tags, in any letter case', async () => {
    const ok = await api('POST', '/api/links', { dest: 'https://example.com/p', alias: uniqueAlias('pick'), tag: tag.toUpperCase(), folder }, member);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.link).toMatchObject({ folder });
    const cleared = await api('PATCH', `/api/links/${ok.body.link.id}`, { tag: null }, member);
    expect(cleared.status).toBe(200);
  });

  it('but not one that was only typed in', async () => {
    const badTag = await api('POST', '/api/links', { dest: 'https://example.com/p', alias: uniqueAlias('pick'), tag: `Invented ${stamp}` }, member);
    expect(badTag.status).toBe(400);
    expect(badTag.body.error).toContain('Ask an admin');
    expect((await api('POST', '/api/links', { dest: 'https://example.com/p', alias: uniqueAlias('pick'), folder: `Invented ${stamp}` }, member)).status).toBe(400);
    const good = await api('POST', '/api/links', { dest: 'https://example.com/p', alias: uniqueAlias('pick') }, member);
    expect((await api('PATCH', `/api/links/${good.body.link.id}`, { tag: `Invented ${stamp}` }, member)).status).toBe(400);
    expect((await api('PATCH', `/api/links/${good.body.link.id}`, { folder: `Invented ${stamp}` }, member)).status).toBe(400);
    expect((await api('GET', '/api/collections?kind=tags', undefined, member)).body.items.some((t: { name: string }) => t.name.startsWith('Invented'))).toBe(false);
  });

  it('a record that already carries an older name can still be edited', async () => {
    // Admins may type any text, so older records can hold names that are not in the list.
    const old = await api('POST', '/api/links', { dest: 'https://example.com/old', alias: uniqueAlias('old'), tag: `Legacy ${stamp}` }, as(OWNER));
    expect(old.status).toBe(201);
    const edited = await api('PATCH', `/api/links/${old.body.link.id}`, { dest: 'https://example.com/new', tag: `Legacy ${stamp}` }, member);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.link.tag).toBe(`Legacy ${stamp}`);
  });

  it('UTM campaigns and invoices follow the same rule', async () => {
    const utm = { website: 'https://example.com', source: 's', medium: 'm', campaign: 'c' };
    expect((await api('POST', '/api/utms', { ...utm, folder }, member)).status).toBe(201);
    expect((await api('POST', '/api/utms', { ...utm, folder: `Invented ${stamp}` }, member)).status).toBe(400);
    const made = await api('POST', '/api/utms', utm, member);
    expect((await api('PATCH', `/api/utms/${made.body.campaign.id}`, { folder: `Invented ${stamp}` }, member)).status).toBe(400);
    expect((await api('PATCH', `/api/utms/${made.body.campaign.id}`, { folder }, member)).status).toBe(200);

    const inv = { client_name: 'Roles Ltd', items: [{ name: 'x', qty: 1, unitPrice: 1000 }] };
    expect((await api('POST', '/api/invoices', { ...inv, folder, tag }, member)).status).toBe(201);
    expect((await api('POST', '/api/invoices', { ...inv, tag: `Invented ${stamp}` }, member)).status).toBe(400);
    expect((await api('POST', '/api/invoices', { ...inv, folder: `Invented ${stamp}` }, member)).status).toBe(400);
    const invoice = await api('POST', '/api/invoices', inv, member);
    expect((await api('PATCH', `/api/invoices/${invoice.body.invoice.id}`, { tag: `Invented ${stamp}` }, member)).status).toBe(400);
    expect((await api('PATCH', `/api/invoices/${invoice.body.invoice.id}`, { tag, folder }, member)).status).toBe(200);
  });

  it('admins can still create and use new ones', async () => {
    const name = `Admin tag ${stamp}`;
    expect((await api('POST', '/api/collections', { kind: 'tags', name }, as(OWNER))).status).toBe(201);
    expect((await api('POST', '/api/links', { dest: 'https://example.com/a', alias: uniqueAlias('adm'), tag: `Free text ${stamp}` }, as(OWNER))).status).toBe(201);
  });
});
