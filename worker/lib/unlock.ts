/**
 * "Unlocked" cookie for password-protected links, so PBKDF2 runs once per
 * visitor instead of on every click.
 *
 * Value: `<expires ms>.<HMAC-SHA256 b64url>` over `<link id>.<expires>.<password hash>`,
 * keyed by the LINK_COOKIE_SECRET Worker secret. Binding the stored hash
 * means changing or removing a link's password invalidates every cookie for
 * it. One cookie per link, scoped to that link's path. Without the secret,
 * cookies are neither issued nor accepted and every click asks again.
 */

export const UNLOCK_TTL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(value: string): Uint8Array | null {
  try {
    const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function unlockCookieName(linkId: string): string {
  return `unlock_${linkId.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

export async function signUnlock(secret: string, linkId: string, passwordHash: string, now = Date.now()): Promise<string> {
  const expires = now + UNLOCK_TTL_SECONDS * 1000;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${linkId}.${expires}.${passwordHash}`));
  return `${expires}.${toB64Url(new Uint8Array(sig))}`;
}

export async function verifyUnlock(
  secret: string,
  linkId: string,
  passwordHash: string,
  cookie: string | undefined,
  now = Date.now()
): Promise<boolean> {
  if (!cookie) return false;
  const dot = cookie.indexOf('.');
  if (dot < 1) return false;
  const expires = Number(cookie.slice(0, dot));
  if (!Number.isSafeInteger(expires) || expires < now) return false;
  const sig = fromB64Url(cookie.slice(dot + 1));
  if (!sig) return false;
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', await hmacKey(secret), sig, encoder.encode(`${linkId}.${expires}.${passwordHash}`));
}
