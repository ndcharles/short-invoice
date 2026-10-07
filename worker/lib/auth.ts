import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv, Env } from '../env';
import { initials } from './initials';
import { hashPassword, verifyPassword } from './password';

/**
 * Built-in sign-in. An admin adds a person (Settings → Team), which creates a
 * one-time setup code the admin hands over. On first sign-in the person
 * enters the code with a name and password; after that, email + password.
 * Each sign-in is a 365-day session on that device (a random token in an
 * HttpOnly cookie; only its SHA-256 is stored).
 */

export type Role = 'admin' | 'member';
export type AuthMode = 'session' | 'dev';

export interface CurrentUser {
  email: string;
  name: string;
  role: Role;
  initials: string;
}

export interface UserRow {
  email: string;
  name: string;
  role: Role;
  status: 'invited' | 'active' | 'removed';
  source: 'admin' | 'invite';
  invited_by: string | null;
  created_at: number;
  last_seen_at: number | null;
  password_hash: string | null;
  setup_code_hash: string | null;
  setup_expires_at: number | null;
  setup_attempts: number;
  failed_logins: number;
  locked_until: number | null;
}

export const SESSION_COOKIE = '__Host-session';
export const SESSION_DAYS = 365;
export const SETUP_CODE_DAYS = 7;
/** Wrong codes before a setup code stops working (the admin issues a new one). */
export const MAX_CODE_ATTEMPTS = 5;
/** Wrong passwords before the account locks for LOCK_MINUTES (doubling after that). */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const PASSWORD_MIN = 12;
/** Account passwords cost more than link passwords; still inside the CPU budget. */
const ACCOUNT_ITERATIONS = 60_000;
const SEEN_EVERY_MS = 10 * 60 * 1000;
const DAY = 86_400_000;

const encoder = new TextEncoder();

export const listOf = (value: string | undefined) =>
  (value ?? '')
    .split(/[,\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

export function displayName(email: string, name?: string | null): string {
  if (name && name.trim()) return name.trim();
  return email.split('@')[0];
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(value: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

/** Constant-time comparison of two equal-length strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Passwords are first keyed with the AUTH_PEPPER secret (HMAC), then hashed
 * with PBKDF2 and a per-user salt: a copy of the database alone is not enough
 * to try guesses offline.
 */
async function peppered(env: Env, password: string): Promise<string> {
  if (!env.AUTH_PEPPER) return password;
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.AUTH_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(password))));
}

export async function hashAccountPassword(env: Env, password: string): Promise<string> {
  return hashPassword(await peppered(env, password), ACCOUNT_ITERATIONS);
}

export async function checkAccountPassword(env: Env, password: string, stored: string | null): Promise<boolean> {
  return verifyPassword(await peppered(env, password), stored);
}

// Unambiguous characters (no 0/O, 1/I/L) so a code can be read out or retyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** "K7MD2-XQ9PA": ten random characters, about 49 bits. */
export function newSetupCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function setupCodeMatches(code: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) return false;
  return safeEqual(await sha256(normaliseCode(code)), storedHash);
}

/** Password rules: length, and not the email or an obvious repeat. */
export function passwordProblem(password: unknown, email: string): string | null {
  if (typeof password !== 'string') return 'Choose a password';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > 128) return 'Use at most 128 characters';
  const lower = password.toLowerCase();
  if (lower.includes(email.split('@')[0]) || lower === email) return 'Do not use your email in the password';
  if (/^(.)\1+$/.test(password)) return 'That password is too easy to guess';
  return null;
}

/**
 * Fixed-window rate limit in D1. Returns false once `limit` hits within
 * `windowMs`. Keys are hashed so no raw IP is stored.
 */
export async function withinLimit(db: D1Database, rawKey: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const key = await sha256(rawKey);
  const row = await db
    .prepare(
      `INSERT INTO auth_limits (key, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN auth_limits.window_start < ?3 THEN 1 ELSE auth_limits.count + 1 END,
         window_start = CASE WHEN auth_limits.window_start < ?3 THEN ?2 ELSE auth_limits.window_start END
       RETURNING count`
    )
    .bind(key, now, now - windowMs)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}

export const clientIp = (c: Context<AppEnv>) => c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'unknown';

/** Starts a 365-day session for this device and sets the cookie. */
export async function startSession(c: Context<AppEnv>, email: string, now = Date.now()): Promise<void> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = now + SESSION_DAYS * DAY;
  await c.env.DB.prepare(
    'INSERT INTO sessions (token_hash, email, created_at, expires_at, last_seen_at, user_agent) VALUES (?1, ?2, ?3, ?4, ?3, ?5)'
  )
    .bind(await sha256(token), email, now, expires, (c.req.header('user-agent') ?? '').slice(0, 200))
    .run();
  // __Host- prefix: Secure, Path=/, no Domain, so it never leaves this host.
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; Secure; SameSite=Strict`,
    { append: true }
  );
}

export function clearSessionCookie(c: Context<AppEnv>) {
  c.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`, { append: true });
}

export async function sessionToken(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  return token && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}

const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/**
 * Tests only: with DEV_AUTH_BYPASS=1, a localhost request carrying
 * `x-dev-user: someone@example.com` acts as that person without signing in.
 * Requests without the header always go through real sign-in.
 */
function devUser(c: Context<AppEnv>): string | null {
  if (c.env.DEV_AUTH_BYPASS !== '1' || !isLocalHost(new URL(c.req.url).hostname.toLowerCase())) return null;
  return c.req.header('x-dev-user')?.trim().toLowerCase() || null;
}

function asUser(email: string, name: string, role: Role): CurrentUser {
  const display = displayName(email, name);
  return { email, name: display, role, initials: initials(display) };
}

/** Sets `c.var.user` for every API call, or answers 401. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = c.env.DB;
  const admins = listOf(c.env.ADMIN_EMAILS);
  const now = Date.now();

  const dev = devUser(c);
  if (dev) {
    const row = await db.prepare('SELECT * FROM users WHERE email = ?1').bind(dev).first<UserRow>();
    const isAdmin = admins.includes(dev);
    if (!isAdmin && (!row || row.status === 'removed')) return c.json({ error: 'Sign in to continue.', code: 'signed_out' }, 401);
    if (!row) {
      await db
        .prepare(`INSERT INTO users (email, name, role, status, source, created_at, last_seen_at) VALUES (?1, '', 'admin', 'active', 'admin', ?2, ?2) ON CONFLICT(email) DO NOTHING`)
        .bind(dev, now)
        .run();
    }
    c.set('user', asUser(dev, row?.name ?? '', isAdmin ? 'admin' : row?.role ?? 'member'));
    c.set('authMode', 'dev');
    return next();
  }

  const token = await sessionToken(c);
  if (!token) return c.json({ error: 'Sign in to continue.', code: 'signed_out' }, 401);
  const hash = await sha256(token);
  const found = await db
    .prepare(
      `SELECT s.email, s.expires_at, s.last_seen_at AS session_seen, u.name, u.role, u.status, u.last_seen_at
       FROM sessions s JOIN users u ON u.email = s.email WHERE s.token_hash = ?1`
    )
    .bind(hash)
    .first<{ email: string; expires_at: number; session_seen: number; name: string; role: Role; status: string; last_seen_at: number | null }>();
  if (!found || found.expires_at < now || found.status !== 'active') {
    if (found) await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(hash).run();
    clearSessionCookie(c);
    return c.json({ error: 'Sign in to continue.', code: 'signed_out' }, 401);
  }
  if (now - found.session_seen > SEEN_EVERY_MS) {
    await db.batch([
      db.prepare('UPDATE sessions SET last_seen_at = ?1 WHERE token_hash = ?2').bind(now, hash),
      db.prepare('UPDATE users SET last_seen_at = ?1 WHERE email = ?2').bind(now, found.email),
    ]);
  }
  const role: Role = admins.includes(found.email) ? 'admin' : found.role;
  c.set('user', asUser(found.email, found.name, role));
  c.set('authMode', 'session');
  return next();
};

/** Admin-only routes: settings, team, domains, exports and deletions. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.user?.role !== 'admin') return c.json({ error: 'Only admins can do this.', code: 'admin_only' }, 403);
  await next();
};

export { DAY };
