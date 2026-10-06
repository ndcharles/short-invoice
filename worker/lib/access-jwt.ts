/**
 * Verifies the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion` header or
 * `CF_Authorization` cookie): RS256 signature against the team's public keys,
 * audience, issuer and expiry. Pure WebCrypto, so it runs in the Worker and in
 * unit tests alike.
 */

export interface AccessIdentity {
  email: string;
  name?: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

export interface AccessConfig {
  /** e.g. "yourteam.cloudflareaccess.com" */
  teamDomain: string;
  /** Application Audience (AUD) tag(s) from the Access application. */
  audiences: string[];
  /** Fetches `{ keys: Jwk[] }`; defaults to the team's certs endpoint. */
  fetchKeys?: () => Promise<Jwk[]>;
  now?: number;
}

const KEY_TTL_MS = 60 * 60 * 1000;
let keyCache: { team: string; keys: Jwk[]; at: number } | null = null;

function b64urlBytes(part: string): Uint8Array<ArrayBuffer> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const b64urlJson = (part: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(part)));

async function teamKeys(config: AccessConfig, refresh = false): Promise<Jwk[]> {
  const now = Date.now();
  if (!refresh && keyCache && keyCache.team === config.teamDomain && now - keyCache.at < KEY_TTL_MS) return keyCache.keys;
  const keys = config.fetchKeys
    ? await config.fetchKeys()
    : ((await (await fetch(`https://${config.teamDomain}/cdn-cgi/access/certs`)).json()) as { keys: Jwk[] }).keys;
  keyCache = { team: config.teamDomain, keys, at: now };
  return keys;
}

/** Test hook: forget cached keys. */
export function resetAccessKeys() {
  keyCache = null;
}

/** Returns the signed-in identity, or null for a missing, forged or expired token. */
export async function verifyAccessJwt(token: string, config: AccessConfig): Promise<AccessIdentity | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string; name?: string };
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let jwk = (await teamKeys(config)).find((k) => k.kid === header.kid);
  // Access rotates keys; a new kid means the cache is stale.
  if (!jwk) jwk = (await teamKeys(config, true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) return null;

  const now = Math.floor((config.now ?? Date.now()) / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.some((aud) => aud && config.audiences.includes(aud))) return null;
  if (payload.iss !== `https://${config.teamDomain}`) return null;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
  // Service tokens carry no email: they are not people and get no access.
  if (typeof payload.email !== 'string' || !payload.email.includes('@')) return null;
  return { email: payload.email.trim().toLowerCase(), name: typeof payload.name === 'string' ? payload.name : undefined };
}
