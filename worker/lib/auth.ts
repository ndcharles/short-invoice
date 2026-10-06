import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from '../env';
import { verifyAccessJwt } from './access-jwt';
import { initials } from './initials';

export type Role = 'admin' | 'member';

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
  source: 'admin' | 'domain' | 'invite';
  invited_by: string | null;
  created_at: number;
  last_seen_at: number | null;
}

/** How the request was authenticated, reported by /api/me. */
export type AuthMode = 'access' | 'local' | 'unprotected';

const SEEN_EVERY_MS = 10 * 60 * 1000;

export const listOf = (value: string | undefined) =>
  (value ?? '')
    .split(/[,\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

export const accessEnabled = (env: Env) => !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

export function displayName(email: string, name?: string | null): string {
  if (name && name.trim()) return name.trim();
  return email.split('@')[0];
}

function cookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Allowed sign-in domains from Settings → Team, e.g. ["4th-entity.com"]. */
export async function teamDomains(db: D1Database): Promise<string[]> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'team_domains'").first<{ value: string }>();
  try {
    const list = JSON.parse(row?.value ?? '[]');
    return Array.isArray(list) ? list.map((d) => String(d).toLowerCase()) : [];
  } catch {
    return [];
  }
}

type Decision = { ok: true; user: CurrentUser } | { ok: false; status: 401 | 403; code: string; error: string };

/**
 * Who is calling and whether they may use the app. Admins are the emails in
 * the ADMIN_EMAILS secret (or, if that is unset, the first person to sign in).
 * Everyone else is a member if invited or on an allowed domain, unless removed.
 */
export async function authorize(
  db: D1Database,
  identity: { email: string; name?: string },
  opts: { admins: string[]; forceAdmin?: boolean; now?: number }
): Promise<Decision> {
  const now = opts.now ?? Date.now();
  const email = identity.email.toLowerCase();
  const row = await db.prepare('SELECT * FROM users WHERE email = ?1').bind(email).first<UserRow>();

  let role: Role | null = null;
  let source: UserRow['source'] = row?.source ?? 'invite';
  if (opts.forceAdmin || opts.admins.includes(email)) {
    role = 'admin';
    source = 'admin';
  } else if (row?.status === 'removed') {
    return { ok: false, status: 403, code: 'removed', error: 'Your access to this workspace was removed. Ask an admin if this is a mistake.' };
  } else if (row && row.role === 'admin') {
    role = 'admin';
  } else if (row) {
    role = 'member';
  } else if ((await teamDomains(db)).includes(email.split('@')[1] ?? '')) {
    role = 'member';
    source = 'domain';
  } else if (opts.admins.length === 0) {
    // No ADMIN_EMAILS yet: the first person in becomes the admin.
    const anyAdmin = await db.prepare("SELECT email FROM users WHERE role = 'admin' AND status != 'removed' LIMIT 1").first();
    if (!anyAdmin) {
      role = 'admin';
      source = 'admin';
    }
  }
  if (!role) {
    return {
      ok: false,
      status: 403,
      code: 'not_invited',
      error: `${email} has not been invited to this workspace. Ask an admin to add you in Settings → Team.`,
    };
  }

  const name = row?.name || identity.name || '';
  if (!row) {
    await db
      .prepare(
        `INSERT INTO users (email, name, role, status, source, created_at, last_seen_at) VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?5)
         ON CONFLICT(email) DO NOTHING`
      )
      .bind(email, name, role, source, now)
      .run();
  } else if (row.role !== role || row.status !== 'active' || !row.last_seen_at || now - row.last_seen_at > SEEN_EVERY_MS || (!row.name && name)) {
    // Only written when something changed or every few minutes, to spare D1 writes.
    await db
      .prepare('UPDATE users SET role = ?1, status = ?2, last_seen_at = ?3, name = ?4, source = ?5 WHERE email = ?6')
      .bind(role, 'active', now, name, source, email)
      .run();
  }
  return { ok: true, user: { email, name: displayName(email, name), role, initials: initials(displayName(email, name)) } };
}

/** Reads the caller from Cloudflare Access (or the local dev stand-in). */
export async function identify(c: Context<AppEnv>): Promise<{ identity: { email: string; name?: string } | null; mode: AuthMode }> {
  const env = c.env;
  const host = new URL(c.req.url).hostname.toLowerCase();
  if (accessEnabled(env)) {
    const token = c.req.header('cf-access-jwt-assertion') ?? cookie(c.req.header('cookie'), 'CF_Authorization');
    const identity = token
      ? await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN as string, audiences: listOf(env.ACCESS_AUD) }).catch(() => null)
      : null;
    return { identity, mode: 'access' };
  }
  const admins = listOf(env.ADMIN_EMAILS);
  if (isLocalHost(host)) {
    // Local development and tests: `x-dev-user` picks who you are.
    const devUser = c.req.header('x-dev-user')?.trim().toLowerCase();
    return { identity: { email: devUser || env.DEV_USER_EMAIL?.toLowerCase() || admins[0] || 'dev@localhost' }, mode: 'local' };
  }
  // Deployed without Access: the app is not protected; behave as the single owner.
  return { identity: { email: admins[0] || 'owner@workspace' }, mode: 'unprotected' };
}

/** Sets `c.var.user` for every API call, or answers 401/403. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { identity, mode } = await identify(c);
  if (!identity) {
    return c.json({ error: 'Sign in through Cloudflare Access to use this app.', code: 'signed_out' }, 401);
  }
  const admins = listOf(c.env.ADMIN_EMAILS);
  const isDevDefault = mode === 'local' && !c.req.header('x-dev-user');
  const decision = await authorize(c.env.DB, identity, { admins, forceAdmin: mode === 'unprotected' || isDevDefault });
  if (!decision.ok) return c.json({ error: decision.error, code: decision.code }, decision.status);
  c.set('user', decision.user);
  c.set('authMode', mode);
  await next();
};

/** Admin-only routes: settings, team, domains, exports and deletions. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.user?.role !== 'admin') return c.json({ error: 'Only admins can do this.', code: 'admin_only' }, 403);
  await next();
};
