import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import type { LinkItem } from '../../src/lib/types';
import { getCookie, setCookie } from 'hono/cookie';
import { verifyPassword } from '../lib/password';
import { signUnlock, unlockCookieName, UNLOCK_TTL_SECONDS, verifyUnlock } from '../lib/unlock';
import { withUtm, pickUtm } from '../../src/lib/links/utm';
import { browserOf, deviceOf, isBot, osOf, refererHost } from '../lib/ua';
import { DEFAULT_SETTINGS } from '../lib/settings-defaults';
import { parseHttpUrl } from '../../src/lib/validate';
import { cloakPage } from '../lib/cloak';
import { clientIp, withinLimit } from '../lib/auth';

/**
 * Which domain an alias is looked up on:
 *  - `path`: `/s/:alias` on any host (the app host, before a custom domain is
 *    attached) resolves against the configured default domain.
 *  - `host`: `/:alias` on an attached custom domain resolves against that host.
 */
export type LinkScope = { kind: 'path' } | { kind: 'host'; host: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
/** Minimal page shell reusing the workspace's design tokens. */
function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { --border:#e5e5e5; --muted:#f5f5f5; --muted-2:#fafafa; --muted-foreground:#737373; --foreground:#0a0a0a; --destructive:#dc2626; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--muted-2); color:var(--foreground);
         font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif; font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .card { width:min(420px, calc(100vw - 40px)); background:#fff; border:1px solid var(--border); border-radius:10px; padding:28px 26px; text-align:center; }
  .icon { width:48px; height:48px; margin:0 auto 14px; border-radius:50%; background:var(--muted); display:flex; align-items:center; justify-content:center; color:var(--muted-foreground); }
  h1 { margin:0 0 6px; font-size:16px; font-weight:600; }
  p { margin:0 0 18px; color:var(--muted-foreground); }
  .field { display:flex; flex-direction:column; gap:6px; text-align:left; margin-bottom:14px; }
  label { font-size:12px; font-weight:500; }
  input { width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px; font-family:inherit; color:var(--foreground); outline:none; }
  input:focus { border-color:var(--foreground); box-shadow:0 0 0 3px rgba(0,0,0,.05); }
  button { width:100%; padding:8px 12px; border:1px solid var(--foreground); border-radius:6px; background:var(--foreground); color:#fff; font-size:13px; font-weight:500; font-family:inherit; cursor:pointer; }
  button:hover { background:#262626; }
  .error { color:var(--destructive); font-size:12px; margin:0 0 12px; }
  .meta { font-family:'SFMono-Regular', ui-monospace, monospace; font-size:12px; color:var(--muted-foreground); word-break:break-all; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

type RedirectContext = Context<AppEnv>;
type LinkRecord = Pick<
  LinkItem,
  'id' | 'dest' | 'cloak' | 'password_hash' | 'expires_at' | 'expires_url' |
  'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_term' | 'utm_content' | 'utm_referral'
>;

/**
 * One rollup upsert plus one counter update per human click (bots skipped),
 * run after the response is sent so the redirect never waits on a write.
 */
function logClick(c: RedirectContext, linkId: string) {
  const ua = c.req.header('user-agent') ?? '';
  if (isBot(ua)) return;

  const now = Date.now();
  const country = (c.req.raw.cf?.country as string | undefined) ?? c.req.header('cf-ipcountry') ?? 'XX';
  const db = c.env.DB;

  c.executionCtx.waitUntil(
    db
      .batch([
        db.prepare('UPDATE links SET clicks = clicks + 1, last_clicked_at = ?1 WHERE id = ?2').bind(now, linkId),
        db
          .prepare(
            `INSERT INTO link_clicks_daily (link_id, day, country, device, browser, os, referer, clicks)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
             ON CONFLICT DO UPDATE SET clicks = clicks + 1`
          )
          .bind(
            linkId,
            new Date(now).toISOString().slice(0, 10),
            country,
            deviceOf(ua),
            browserOf(ua),
            osOf(ua),
            refererHost(c.req.header('referer') ?? null)
          ),
      ])
      .catch((err) => console.error('click logging failed', err))
  );
}

/**
 * The password page is the one generated page with a form, and a correct password answers with a
 * redirect to the destination, which can be any website. Chrome applies `form-action` to that
 * redirect too, so `'self'` here made every right password end in a blocked request (blank page).
 * Everything else about the page stays locked down.
 */
const PASSWORD_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self' http: https:; base-uri 'none'; frame-ancestors 'none'";

type PasswordState = 'ask' | 'wrong' | 'limited';

function passwordPage(action: string, state: PasswordState) {
  return htmlPage('Password required', `
    <div class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
    <h1>This link is password protected</h1>
    <p>Enter the password to continue.</p>
    ${state === 'wrong' ? '<p class="error">Incorrect password. Try again.</p>' : ''}
    ${state === 'limited' ? '<p class="error">Too many attempts. Wait a few minutes, then try again.</p>' : ''}
    <form method="POST" action="${escapeHtml(action)}">
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" type="password" name="pw" placeholder="Enter password" autofocus required />
      </div>
      <button type="submit">Unlock link</button>
    </form>`);
}

/** Wrong guesses allowed per visitor (IP) per window, and per link per hour across everyone. */
const PASSWORDS_PER_VISITOR = 10;
const PASSWORD_WINDOW_MS = 10 * 60_000;
const PASSWORDS_PER_LINK_HOUR = 300;

const LINK_COLUMNS = `id, domain, dest, cloak, password_hash, expires_at, expires_url,
  utm_source, utm_medium, utm_campaign, utm_term, utm_content, utm_referral`;

/** One indexed lookup on UNIQUE(domain, alias); the default domain is read in the same query. */
export function findLink(db: D1Database, scope: LinkScope, alias: string) {
  if (scope.kind === 'host') {
    return db
      .prepare(`SELECT ${LINK_COLUMNS} FROM links WHERE domain = ?1 AND alias = ?2 AND archived = 0`)
      .bind(scope.host, alias)
      .first<LinkRecord & { domain: string }>();
  }
  return db
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM links
       WHERE domain = COALESCE((SELECT value FROM settings WHERE key = 'default_domain'), ?1)
         AND alias = ?2 AND archived = 0`
    )
    .bind(DEFAULT_SETTINGS.default_domain, alias)
    .first<LinkRecord & { domain: string }>();
}

export function notFoundPage(label: string) {
  return htmlPage('Link not found', `
        <div class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="2" y1="2" x2="22" y2="22"/></svg></div>
        <h1>Link not found</h1>
        <p>This short link does not exist or has been removed.</p>
        <div class="meta">${escapeHtml(label)}</div>`);
}

/**
 * Serves one short link. Returns null when no link matches, so the caller
 * decides which 404 to show (link-not-found vs. the app's own 404 page).
 */
export async function serveLink(
  c: RedirectContext,
  scope: LinkScope,
  alias: string,
  supplied: string | null
): Promise<Response | null> {
  const record = await findLink(c.env.DB, scope, alias);
  if (!record) return null;
  const label = `${record.domain}/${alias}`;

  // Expiration wins over everything else. Where visitors go instead: the link's own expiration URL,
  // else the Redirect URL from Settings → URL Shortener (the same place a missing link goes), else
  // a plain "expired" page.
  if (record.expires_at && Date.now() > record.expires_at) {
    const own = record.expires_url ? parseHttpUrl(record.expires_url) : null;
    const fallback = own?.ok ? own.value : await settingsRedirect(c);
    if (fallback) return c.redirect(fallback, c.req.method === 'POST' ? 303 : 302);
    return c.html(
      htmlPage('Link expired', `
        <div class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <h1>This link has expired</h1>
        <p>The owner set an expiration date and it has passed.</p>
        <div class="meta">${escapeHtml(label)}</div>`),
      410
    );
  }

  // Password gate. The password arrives as a POST body so it never lands in
  // URLs, logs or Referer headers. A valid unlock cookie skips PBKDF2.
  if (record.password_hash) {
    const secret = c.env.LINK_COOKIE_SECRET;
    const cookieName = unlockCookieName(record.id);
    const unlocked =
      !!secret && (await verifyUnlock(secret, record.id, record.password_hash, getCookie(c, cookieName)));
    if (!unlocked) {
      const page = (state: PasswordState, status: 401 | 429) =>
        c.html(passwordPage(c.req.path, state), status, {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': PASSWORD_PAGE_CSP,
          ...(status === 429 ? { 'Retry-After': String(PASSWORD_WINDOW_MS / 1000) } : {}),
        });
      if (supplied === null) return page('ask', 401);
      // Every submitted password is counted, so guessing is slow per visitor and per link.
      // Visitors who already hold the unlock cookie never reach this point.
      const ip = clientIp(c);
      const allowed =
        (await withinLimit(c.env.DB, `link-pw:${record.id}:${ip}`, PASSWORDS_PER_VISITOR, PASSWORD_WINDOW_MS)) &&
        (await withinLimit(c.env.DB, `link-pw:${record.id}`, PASSWORDS_PER_LINK_HOUR, 60 * 60_000));
      if (!allowed) return page('limited', 429);
      if (!supplied || !(await verifyPassword(supplied, record.password_hash))) return page('wrong', 401);
      if (secret) {
        setCookie(c, cookieName, await signUnlock(secret, record.id, record.password_hash), {
          path: c.req.path,
          maxAge: UNLOCK_TTL_SECONDS,
          httpOnly: true,
          secure: new URL(c.req.url).protocol === 'https:',
          sameSite: 'Lax',
        });
      }
    }
  }

  // Rows are validated on write; this re-check means a bad row written before
  // validation existed can never become a javascript:/data: redirect or iframe.
  const checked = parseHttpUrl(withUtm(record.dest, pickUtm(record)));
  if (!checked.ok) {
    return c.html(
      htmlPage('Link unavailable', `
        <h1>This link is unavailable</h1>
        <p>Its destination is not a valid web address.</p>
        <div class="meta">${escapeHtml(label)}</div>`),
      410
    );
  }
  const target = checked.value;
  logClick(c, record.id);

  if (record.cloak) {
    const page = cloakPage(alias, target, new URL(c.req.url).protocol === 'https:');
    return c.html(page.html, 200, { 'Content-Security-Policy': page.csp });
  }

  // 303 after a POST so the browser follows with a GET.
  return c.redirect(target, c.req.method === 'POST' ? 303 : 302);
}

async function suppliedPassword(c: RedirectContext): Promise<string> {
  const form = await c.req.parseBody();
  // Cap the length so an oversized post cannot make PBKDF2 hash megabytes.
  return typeof form.pw === 'string' ? form.pw.slice(0, 1024) : '';
}

/**
 * A short link that does not exist (or a bare `/s/`): send visitors to the
 * Redirect URL from Settings → URL Shortener when one is set, otherwise show
 * the "link not found" page.
 */
export async function missingLink(c: RedirectContext, label: string): Promise<Response> {
  const target = await settingsRedirect(c);
  if (target) return c.redirect(target, 302);
  return c.html(notFoundPage(label), 404);
}

/** The "Redirect URL" from Settings → URL Shortener, when one is set and valid. */
async function settingsRedirect(c: RedirectContext): Promise<string | null> {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'root_redirect'").first<{ value: string }>();
  const target = row?.value ? parseHttpUrl(row.value) : null;
  return target?.ok ? target.value : null;
}

/** `/s/:alias`, available on every host. */
const redirect = new Hono<AppEnv>();

const servePath = async (c: RedirectContext, supplied: string | null) => {
  const alias = c.req.param('alias') ?? '';
  const res = await serveLink(c, { kind: 'path' }, alias, supplied);
  return res ?? missingLink(c, `/s/${alias}`);
};

redirect.get('/', (c) => missingLink(c, '/s/'));
redirect.get('/:alias', (c) => servePath(c, null));
redirect.post('/:alias', async (c) => servePath(c, await suppliedPassword(c)));

export { suppliedPassword };
export default redirect;
