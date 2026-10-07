import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { readJsonObject } from '../lib/request';
import { DEFAULT_SETTINGS } from '../lib/settings-defaults';
import { activity } from '../lib/activity';
import { parseText } from '../../src/lib/validate';
import {
  checkAccountPassword,
  cleanupStatements,
  clearSessionCookie,
  clientIp,
  hashAccountPassword,
  listOf,
  LOCK_MINUTES,
  MAX_CODE_ATTEMPTS,
  MAX_FAILED_LOGINS,
  passwordProblem,
  requireUser,
  sessionToken,
  setupCodeMatches,
  sha256,
  startSession,
  withinLimit,
  type UserRow,
} from '../lib/auth';

/**
 * Sign-in endpoints. Only these (and /api/health) answer without a session.
 * Unknown emails get exactly the same answer as a rate-limited request:
 * `{ next: null }`, which the sign-in page treats as "do nothing".
 */
const auth = new Hono<AppEnv>();

const WINDOW_MS = 15 * 60 * 1000;
const CHECKS_PER_WINDOW = 30;
const ATTEMPTS_PER_WINDOW = 20;
// Used to spend the same time on unknown emails as on a real password check.
const DUMMY_HASH = 'pbkdf2$60000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const emailOf = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : '');

async function userRow(db: D1Database, email: string) {
  if (!email) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?1').bind(email).first<UserRow>();
}

const codeUsable = (row: UserRow, now: number) =>
  row.status === 'invited' && !!row.setup_code_hash && (row.setup_expires_at ?? 0) > now && row.setup_attempts < MAX_CODE_ATTEMPTS;

/** Workspace name and logo for the sign-in page (nothing else is public). */
auth.get('/brand', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('workspace_name', 'workspace_logo')"
  ).all<{ key: string; value: string }>();
  const map = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return c.json({ name: map.workspace_name || DEFAULT_SETTINGS.workspace_name, logo: map.workspace_logo || '' });
});

/** Step 1: which form comes next for this email, if any. */
auth.post('/check', async (c) => {
  const body = await readJsonObject(c);
  const email = emailOf(body?.email);
  const now = Date.now();
  if (!(await withinLimit(c.env.DB, `check:${clientIp(c)}`, CHECKS_PER_WINDOW, WINDOW_MS, now))) return c.json({ next: null });
  const row = await userRow(c.env.DB, email);
  if (row?.status === 'active' && row.password_hash) return c.json({ next: 'password' });
  if (row && codeUsable(row, now)) return c.json({ next: 'setup' });
  return c.json({ next: null });
});

/** First sign-in: setup code from the admin + name + new password. */
auth.post('/setup', async (c) => {
  const db = c.env.DB;
  const body = await readJsonObject(c);
  const email = emailOf(body?.email);
  const now = Date.now();
  if (!(await withinLimit(db, `attempt:${clientIp(c)}`, ATTEMPTS_PER_WINDOW, WINDOW_MS, now))) {
    return c.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, 429);
  }
  const row = await userRow(db, email);
  if (!row || !codeUsable(row, now)) return c.json({ error: 'That code is not valid. Ask your admin for a new one.' }, 400);

  if (!(await setupCodeMatches(String(body?.code ?? ''), row.setup_code_hash))) {
    const attempts = row.setup_attempts + 1;
    // After too many wrong codes the code is burned; the admin issues a new one.
    await db
      .prepare('UPDATE users SET setup_attempts = ?1, setup_code_hash = CASE WHEN ?1 >= ?2 THEN NULL ELSE setup_code_hash END WHERE email = ?3')
      .bind(attempts, MAX_CODE_ATTEMPTS, email)
      .run();
    return c.json(
      { error: attempts >= MAX_CODE_ATTEMPTS ? 'That code no longer works. Ask your admin for a new one.' : 'That code is not right.' },
      400
    );
  }

  const name = parseText(body?.name, 'Name', 60);
  if (!name.ok) return c.json({ error: name.error }, 400);
  if (!name.value) return c.json({ error: 'Enter your name' }, 400);
  const problem = passwordProblem(body?.password, email);
  if (problem) return c.json({ error: problem }, 400);

  await db.batch([
    db
      .prepare(
        `UPDATE users SET password_hash = ?1, name = ?2, status = 'active', setup_code_hash = NULL, setup_expires_at = NULL,
           setup_attempts = 0, failed_logins = 0, locked_until = NULL, last_seen_at = ?3 WHERE email = ?4`
      )
      .bind(await hashAccountPassword(c.env, String(body?.password)), name.value, now, email),
    activity(db, { email, name: name.value, role: row.role, owner: listOf(c.env.ADMIN_EMAILS).includes(email), initials: '' }, { action: 'joined', type: 'team', id: email, label: name.value }, now),
    ...cleanupStatements(db, now),
  ]);
  await startSession(c, email, now);
  return c.json({ ok: true });
});

/** Every later sign-in: email + password. */
auth.post('/login', async (c) => {
  const db = c.env.DB;
  const body = await readJsonObject(c);
  const email = emailOf(body?.email);
  const password = typeof body?.password === 'string' ? body.password.slice(0, 128) : '';
  const now = Date.now();
  if (!(await withinLimit(db, `attempt:${clientIp(c)}`, ATTEMPTS_PER_WINDOW, WINDOW_MS, now))) {
    return c.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, 429);
  }

  const row = await userRow(db, email);
  if (!row || row.status !== 'active' || !row.password_hash) {
    await checkAccountPassword(c.env, password, DUMMY_HASH);
    return c.json({ error: 'That password is not right.' }, 401);
  }
  if (row.locked_until && row.locked_until > now) {
    const minutes = Math.ceil((row.locked_until - now) / 60_000);
    return c.json({ error: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }, 429);
  }

  if (!(await checkAccountPassword(c.env, password, row.password_hash))) {
    const failed = row.failed_logins + 1;
    // 15 min after 5 wrong passwords, then doubling, up to a day.
    const lockMs = failed >= MAX_FAILED_LOGINS ? Math.min(24 * 60, LOCK_MINUTES * 2 ** (failed - MAX_FAILED_LOGINS)) * 60_000 : 0;
    await db
      .prepare('UPDATE users SET failed_logins = ?1, locked_until = ?2 WHERE email = ?3')
      .bind(failed, lockMs ? now + lockMs : null, email)
      .run();
    return c.json({ error: 'That password is not right.' }, 401);
  }

  await db.batch([
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_seen_at = ?1 WHERE email = ?2').bind(now, email),
    activity(db, { email, name: row.name, role: row.role, owner: listOf(c.env.ADMIN_EMAILS).includes(email), initials: '' }, { action: 'signed in', type: 'team', id: email, label: row.name || email }, now),
    ...cleanupStatements(db, now),
  ]);
  await startSession(c, email, now);
  return c.json({ ok: true });
});

/** Signs this device out. */
auth.post('/logout', async (c) => {
  const token = await sessionToken(c);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/** Signs every device of the current person out. */
auth.post('/logout-all', requireUser, async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE email = ?1').bind(c.var.user.email).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

export default auth;
