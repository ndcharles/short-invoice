import type { Env } from '../env';

/**
 * Secrets kept in the database (the SMTP password) are encrypted with a key
 * derived from the AUTH_PEPPER secret, which lives only in the Worker. A copy
 * of the database alone therefore does not reveal them. Without AUTH_PEPPER
 * (local development) they are stored as typed.
 *
 * Format: `enc1:<iv base64>:<ciphertext base64>` (AES-256-GCM).
 */

const PREFIX = 'enc1:';
const encoder = new TextEncoder();

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

async function keyFor(env: Env): Promise<CryptoKey | null> {
  if (!env.AUTH_PEPPER) return null;
  const material = await crypto.subtle.importKey('raw', encoder.encode(env.AUTH_PEPPER), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('short-invoice'), info: encoder.encode('smtp-password-v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export const isEncrypted = (value: string) => value.startsWith(PREFIX);

export async function encryptSecret(env: Env, plain: string): Promise<string> {
  const key = await keyFor(env);
  if (!key || !plain) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain)));
  return `${PREFIX}${toB64(iv)}:${toB64(cipher)}`;
}

/** Returns the plain text, or '' when it cannot be decrypted (changed AUTH_PEPPER, damaged value). */
export async function decryptSecret(env: Env, stored: string): Promise<string> {
  if (!stored || !isEncrypted(stored)) return stored;
  const key = await keyFor(env);
  if (!key) return '';
  try {
    const [iv, cipher] = stored.slice(PREFIX.length).split(':');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(cipher));
    return new TextDecoder().decode(plain);
  } catch {
    return '';
  }
}
