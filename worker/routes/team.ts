import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { DAY, displayName, listOf, newSetupCode, normaliseCode, requireAdmin, SETUP_CODE_DAYS, sha256, type UserRow } from '../lib/auth';
import { activity } from '../lib/activity';
import { initials } from '../lib/initials';
import { readJsonObject } from '../lib/request';
import { isMailAddress } from '../lib/invoice-mail';
import { parseText } from '../../src/lib/validate';

const team = new Hono<AppEnv>();

/** The signed-in person and their role. */
team.get('/me', (c) => c.json({ user: c.var.user, auth: { mode: c.var.authMode } }));

team.patch('/me', async (c) => {
  const body = await readJsonObject(c);
  const name = parseText(body?.name ?? '', 'Name', 60);
  if (!name.ok) return c.json({ error: name.error }, 400);
  await c.env.DB.prepare('UPDATE users SET name = ?1 WHERE email = ?2').bind(name.value ?? '', c.var.user.email).run();
  const display = displayName(c.var.user.email, name.value);
  return c.json({ user: { ...c.var.user, name: display, initials: initials(display) } });
});

/** Fields safe to send to the browser: never hashes, codes or lock state. */
function publicUser(u: UserRow & { devices?: number }, admin: boolean) {
  const base = { email: u.email, name: u.name, role: u.role, display_name: displayName(u.email, u.name) };
  if (!admin) return base;
  return {
    ...base,
    status: u.status,
    source: u.source,
    invited_by: u.invited_by,
    created_at: u.created_at,
    last_seen_at: u.last_seen_at,
    devices: u.devices ?? 0,
    code_state:
      u.status !== 'invited' ? null : !u.setup_code_hash ? 'used_up' : (u.setup_expires_at ?? 0) < Date.now() ? 'expired' : 'valid',
  };
}

/** Everyone in the workspace, so the UI can show who made each change. */
team.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM sessions s WHERE s.email = u.email AND s.expires_at > ?1) AS devices
     FROM users u ORDER BY u.created_at`
  )
    .bind(Date.now())
    .all<UserRow & { devices: number }>();
  const admin = c.var.user.role === 'admin';
  return c.json({ users: results.map((u) => publicUser(u, admin)), ...(admin ? { admins: listOf(c.env.ADMIN_EMAILS) } : {}) });
});

/**
 * Gives a person a fresh one-time setup code and returns it once (only its
 * hash is kept). Any password and sessions they had are cleared.
 */
async function issueCode(db: D1Database, email: string, invitedBy: string, now: number) {
  const code = newSetupCode();
  const hash = await sha256(normaliseCode(code));
  const expires = now + SETUP_CODE_DAYS * DAY;
  return {
    code,
    expires,
    statements: [
      db
        .prepare(
          `INSERT INTO users (email, name, role, status, source, invited_by, created_at, setup_code_hash, setup_expires_at)
           VALUES (?1, '', 'member', 'invited', 'invite', ?2, ?3, ?4, ?5)
           ON CONFLICT(email) DO UPDATE SET status = 'invited', password_hash = NULL, setup_code_hash = ?4,
             setup_expires_at = ?5, setup_attempts = 0, failed_logins = 0, locked_until = NULL, invited_by = ?2`
        )
        .bind(email, invitedBy, now, hash, expires),
      db.prepare('DELETE FROM sessions WHERE email = ?1').bind(email),
    ],
  };
}

/** Add someone (any email). Returns their setup code for the admin to hand over. */
team.post('/invites', requireAdmin, async (c) => {
  const body = await readJsonObject(c);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isMailAddress(email)) return c.json({ error: 'Enter a valid email address' }, 400);
  const db = c.env.DB;
  const now = Date.now();
  const existing = await db.prepare('SELECT status FROM users WHERE email = ?1').bind(email).first<{ status: string }>();
  if (existing && existing.status !== 'removed') return c.json({ error: `${email} is already on the team` }, 409);
  const issued = await issueCode(db, email, c.var.user.email, now);
  await db.batch([
    ...issued.statements,
    activity(db, c.var.user, { action: existing ? 're-invited' : 'invited', type: 'team', id: email, label: email }, now),
  ]);
  return c.json({ email, code: issued.code, expires_at: issued.expires }, 201);
});

/** A new code for someone who has not finished setting up (the old one stops working). */
team.post('/users/:email/code', requireAdmin, async (c) => {
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  const db = c.env.DB;
  const now = Date.now();
  const row = await db.prepare('SELECT status FROM users WHERE email = ?1').bind(email).first<{ status: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status !== 'invited') return c.json({ error: 'Only people who have not set up their account get new codes. Remove and re-invite to reset a password.' }, 409);
  const issued = await issueCode(db, email, c.var.user.email, now);
  await db.batch([...issued.statements, activity(db, c.var.user, { action: 'issued a new code for', type: 'team', id: email, label: email }, now)]);
  return c.json({ email, code: issued.code, expires_at: issued.expires });
});

/** Removes someone: every session ends now and their password is wiped. */
team.delete('/users/:email', requireAdmin, async (c) => {
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  if (email === c.var.user.email) return c.json({ error: 'You cannot remove yourself' }, 400);
  if (listOf(c.env.ADMIN_EMAILS).includes(email)) return c.json({ error: 'Admins are set with the ADMIN_EMAILS secret and cannot be removed here' }, 400);
  const db = c.env.DB;
  const now = Date.now();
  const existing = await db.prepare('SELECT email FROM users WHERE email = ?1').bind(email).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await db.batch([
    db
      .prepare(
        `UPDATE users SET status = 'removed', role = 'member', password_hash = NULL, setup_code_hash = NULL,
           setup_expires_at = NULL, failed_logins = 0, locked_until = NULL WHERE email = ?1`
      )
      .bind(email),
    db.prepare('DELETE FROM sessions WHERE email = ?1').bind(email),
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
