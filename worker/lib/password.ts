/**
 * Link passwords, hashed with PBKDF2-SHA256 through WebCrypto.
 *
 * Why not scrypt: the Workers free plan allows 10 ms of CPU per request and
 * scrypt at sane parameters costs several times that. PBKDF2 runs natively in
 * WebCrypto, and the iteration count is kept low enough that a verify fits in
 * the budget. These passwords gate a short link, not an account, so this is
 * an acceptable trade. Stored as `pbkdf2$<iterations>$<salt b64>$<hash b64>`
 * so the cost can be raised later without breaking existing hashes.
 */

// ~3 ms on an M-series laptop; leaves headroom under the 10 ms budget.
const ITERATIONS = 30_000;
const KEY_BITS = 256;

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iter, salt, hash] = stored.split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2' || !Number.isInteger(iterations) || !salt || !hash) return false;

  const expected = fromB64(hash);
  const candidate = await derive(password, fromB64(salt), iterations);
  if (candidate.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate[i] ^ expected[i];
  return diff === 0;
}
