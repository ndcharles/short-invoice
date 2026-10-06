import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { accessEnabled, displayName, listOf, requireAdmin, teamDomains, type UserRow } from '../lib/auth';
import { activity } from '../lib/activity';
import { initials } from '../lib/initials';
import { readJsonObject } from '../lib/request';
import { isMailAddress } from '../lib/invoice-mail';
import { parseText } from '../../src/lib/validate';

const team = new Hono<AppEnv>();

/** The signed-in person, their role, and whether Access protects the app. */
team.get('/me', (c) =>
  c.json({ user: c.var.user, auth: { mode: c.var.authMode, access: accessEnabled(c.env) } })
);

team.patch('/me', async (c) => {
  const body = await readJsonObject(c);
  const name = parseText(body?.name ?? '', 'Name', 60);
  if (!name.ok) return c.json({ error: name.error }, 400);
  await c.env.DB.prepare('UPDATE users SET name = ?1 WHERE email = ?2').bind(name.value ?? '', c.var.user.email).run();
  const display = displayName(c.var.user.email, name.value);
  return c.json({ user: { ...c.var.user, name: display, initials: initials(display) } });
});

/**
 * Everyone in the workspace, so the UI can show who made each change.
 * Admins also get status, source and last-seen for Settings → Team.
 */
team.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at').all<UserRow>();
  const admin = c.var.user.role === 'admin';
  const users = results.map((u) =>
    admin
      ? { ...u, display_name: displayName(u.email, u.name) }
      : { email: u.email, name: u.name, role: u.role, display_name: displayName(u.email, u.name) }
  );
  const extra = admin
    ? { domains: await teamDomains(c.env.DB), admins: listOf(c.env.ADMIN_EMAILS), access: accessEnabled(c.env) }
    : {};
  return c.json({ users, ...extra });
});

/** Invite an email (any domain) as a member, or let a removed person back in. */
team.post('/invites', requireAdmin, async (c) => {
  const body = await readJsonObject(c);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isMailAddress(email)) return c.json({ error: 'Enter a valid email address' }, 400);
  if (listOf(c.env.ADMIN_EMAILS).includes(email)) return c.json({ error: `${email} is already an admin` }, 409);
  const db = c.env.DB;
  const now = Date.now();
  const existing = await db.prepare('SELECT * FROM users WHERE email = ?1').bind(email).first<UserRow>();
  if (existing && existing.status !== 'removed') return c.json({ error: `${email} already has access` }, 409);
  await db.batch([
    existing
      ? db.prepare("UPDATE users SET status = 'invited', role = 'member', source = 'invite', invited_by = ?1 WHERE email = ?2").bind(c.var.user.email, email)
      : db
          .prepare(`INSERT INTO users (email, name, role, status, source, invited_by, created_at) VALUES (?1, '', 'member', 'invited', 'invite', ?2, ?3)`)
          .bind(email, c.var.user.email, now),
    activity(db, c.var.user, { action: existing ? 'restored' : 'invited', type: 'team', id: email, label: email }, now),
  ]);
  return c.json({ user: await db.prepare('SELECT * FROM users WHERE email = ?1').bind(email).first() }, 201);
});

/** Removes someone: they are refused on their next request, even on an allowed domain. */
team.delete('/users/:email', requireAdmin, async (c) => {
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  if (email === c.var.user.email) return c.json({ error: 'You cannot remove yourself' }, 400);
  if (listOf(c.env.ADMIN_EMAILS).includes(email)) return c.json({ error: 'Admins are set with the ADMIN_EMAILS secret and cannot be removed here' }, 400);
  const db = c.env.DB;
  const now = Date.now();
  const existing = await db.prepare('SELECT email FROM users WHERE email = ?1').bind(email).first();
  await db.batch([
    existing
      ? db.prepare("UPDATE users SET status = 'removed', role = 'member' WHERE email = ?1").bind(email)
      : db
          .prepare(`INSERT INTO users (email, name, role, status, source, invited_by, created_at) VALUES (?1, '', 'member', 'removed', 'invite', ?2, ?3)`)
          .bind(email, c.var.user.email, now),
    activity(db, c.var.user, { action: 'removed', type: 'team', id: email, label: email }, now),
  ]);
  return c.json({ success: true });
});

const ACTIVITY_PAGE = 50;

/** Who did what, newest first. Filter by `actor` and/or `type`; page with `before`. */
team.get('/activity', requireAdmin, async (c) => {
  const actor = c.req.query('actor')?.trim().toLowerCase() || '';
  const type = c.req.query('type')?.trim() || '';
  const before = Number(c.req.query('before')) || Date.now() + 1;
  const params: unknown[] = [before];
  let sql = 'SELECT * FROM activity WHERE at < ?1';
  if (actor) {
    params.push(actor);
    sql += ` AND actor = ?${params.length}`;
  }
  if (type) {
    params.push(type);
    sql += ` AND entity_type = ?${params.length}`;
  }
  sql += ` ORDER BY at DESC LIMIT ${ACTIVITY_PAGE}`;
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ activity: results, more: results.length === ACTIVITY_PAGE });
});

export default team;
