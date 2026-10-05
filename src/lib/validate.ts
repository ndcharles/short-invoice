/**
 * Input validation shared by the Worker (authoritative) and the UI (instant
 * feedback). Pure functions, no runtime imports.
 *
 * Everything that ends up in a Location header, an href/src, an iframe or an
 * HTML page goes through here first, so the rules are deliberately strict:
 * http(s) only, no embedded credentials, no control characters, bounded size.
 */

export const LIMITS = {
  url: 2048,
  alias: 64,
  hostname: 253,
  name: 40,
  shortText: 200,
  longText: 2000,
  password: 128,
} as const;

/** Paths the app or the Worker already owns, so they can never be aliases. */
export const RESERVED_ALIASES = new Set([
  'api', 's', 'links', 'utms', 'invoices', 'settings', 'index', '404', '_next', 'favicon', 'robots', 'sitemap',
]);

const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
// C0/C1 control characters, which have no business in any single-line field.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

/**
 * Normalises a user-entered web address to an absolute http(s) URL.
 * A missing scheme defaults to https. Rejects other schemes (javascript:,
 * data:, file:, …), user:pass@ credentials (a classic phishing disguise),
 * hosts without a dot (other than localhost), whitespace and control chars.
 */
export function parseHttpUrl(input: unknown, label = 'URL'): Result<string> {
  if (typeof input !== 'string') return fail(`${label} must be text`);
  const trimmed = input.trim();
  if (!trimmed) return fail(`${label} is required`);
  if (trimmed.length > LIMITS.url) return fail(`${label} is too long (max ${LIMITS.url} characters)`);
  if (CONTROL_RE.test(trimmed) || /\s/.test(trimmed)) return fail(`${label} cannot contain spaces or control characters`);

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    // "example.com:8080/x" looks like a scheme to the regex above but is a host:port.
    if (!/^[a-z0-9.-]+:\d+(\/|$)/i.test(trimmed)) return fail(`${label} must start with http:// or https://`);
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return fail(`${label} is not a valid web address`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail(`${label} must start with http:// or https://`);
  if (url.username || url.password) return fail(`${label} cannot contain a username or password`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || (!host.includes('.') && !host.includes(':') && host !== 'localhost')) {
    return fail(`${label} needs a full domain, e.g. example.com`);
  }
  return ok(url.toString());
}

/** Same as parseHttpUrl, but empty input is allowed and returns null. */
export function parseOptionalHttpUrl(input: unknown, label = 'URL'): Result<string | null> {
  if (input === null || input === undefined || (typeof input === 'string' && input.trim() === '')) return ok(null);
  return parseHttpUrl(input, label);
}

/** Short-link alias: letters, digits, `-` and `_`, starting with a letter or digit. */
export function parseAlias(input: unknown): Result<string> {
  if (typeof input !== 'string') return fail('Alias must be text');
  const alias = input.trim().replace(/^\/+/, '').replace(/\s+/g, '-');
  if (!alias) return fail('Alias is required');
  if (alias.length > LIMITS.alias) return fail(`Alias is too long (max ${LIMITS.alias} characters)`);
  if (!ALIAS_RE.test(alias)) return fail('Alias can only contain letters, numbers, "-" and "_"');
  if (RESERVED_ALIASES.has(alias.toLowerCase())) return fail(`"${alias}" is reserved, pick another alias`);
  return ok(alias);
}

/** Bare hostname such as `4th.link` (no scheme, path or port), lower-cased. */
export function parseHostname(input: unknown): Result<string> {
  if (typeof input !== 'string') return fail('Domain must be text');
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!host) return fail('Domain is required');
  if (!HOSTNAME_RE.test(host)) return fail('Enter a domain like links.example.com (no http:// or paths)');
  return ok(host);
}

/**
 * Optional single-line text: trimmed, control characters rejected, length
 * capped. Empty becomes null.
 */
export function parseText(input: unknown, label: string, max: number = LIMITS.shortText): Result<string | null> {
  if (input === null || input === undefined) return ok(null);
  if (typeof input !== 'string') return fail(`${label} must be text`);
  const value = input.trim();
  if (!value) return ok(null);
  if (value.length > max) return fail(`${label} is too long (max ${max} characters)`);
  if (CONTROL_RE.test(value)) return fail(`${label} contains invalid characters`);
  return ok(value);
}

/** Optional multi-line text: like parseText but newlines and tabs are allowed. */
export function parseMultiline(input: unknown, label: string, max: number = LIMITS.longText): Result<string | null> {
  if (input === null || input === undefined) return ok(null);
  if (typeof input !== 'string') return fail(`${label} must be text`);
  const value = input.replace(/\r\n?/g, '\n').trim();
  if (!value) return ok(null);
  if (value.length > max) return fail(`${label} is too long (max ${max} characters)`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return fail(`${label} contains invalid characters`);
  return ok(value);
}

/** Finite number within bounds. Strings like "1500" are accepted. */
export function parseNumber(
  input: unknown,
  label: string,
  { min = -Infinity, max = Infinity, fallback }: { min?: number; max?: number; fallback?: number } = {}
): Result<number> {
  if ((input === null || input === undefined || input === '') && fallback !== undefined) return ok(fallback);
  const value = typeof input === 'string' ? Number(input.trim()) : input;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`${label} must be a number`);
  if (value < min) return fail(`${label} must be at least ${min}`);
  if (value > max) return fail(`${label} must be at most ${max}`);
  return ok(value);
}

/** Loose email check: one @, a dotted domain, no spaces. Empty is allowed. */
export function parseEmail(input: unknown, label = 'Email'): Result<string | null> {
  const text = parseText(input, label, 254);
  if (!text.ok || text.value === null) return text;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.value)) return fail(`${label} is not a valid email address`);
  return ok(text.value);
}

/** `#rrggbb` colours only, so a setting can never smuggle CSS into a style attribute. */
export function parseHexColor(input: unknown, label = 'Colour'): Result<string> {
  if (typeof input !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.trim())) return fail(`${label} must look like #1d4ed8`);
  return ok(input.trim().toLowerCase());
}

/**
 * Images stored in settings (logos): an http(s) URL or a base64 data URL of a
 * raster/SVG image. Rendered only through <img>, where SVG scripts never run.
 */
export function parseImageSource(input: unknown, label = 'Image', maxBytes = 300 * 1024): Result<string | null> {
  if (input === null || input === undefined || input === '') return ok(null);
  if (typeof input !== 'string') return fail(`${label} must be text`);
  const value = input.trim();
  if (value.startsWith('data:')) {
    if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value)) {
      return fail(`${label} must be a PNG, JPEG, GIF, WebP or SVG image`);
    }
    if (value.length > Math.ceil((maxBytes * 4) / 3) + 64) return fail(`${label} is too large`);
    return ok(value);
  }
  return parseHttpUrl(value, label);
}
