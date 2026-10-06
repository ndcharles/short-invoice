import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAccessKeys, verifyAccessJwt } from '../../worker/lib/access-jwt';

const TEAM = 'acme.cloudflareaccess.com';
const AUD = 'aud-tag-123';

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');

async function sign(payload: Record<string, unknown>, opts: { key?: CryptoKey; kid?: string; alg?: string } = {}) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? keys.privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(signature)}`;
}

const now = Math.floor(Date.now() / 1000);
const valid = () => ({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, iat: now, email: 'Ada@Acme.com', name: 'Ada' });
const config = () => ({ teamDomain: TEAM, audiences: [AUD], fetchKeys: async () => [jwk] });

beforeAll(async () => {
  const params = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  keys = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  otherKeys = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
});

beforeEach(() => resetAccessKeys());

describe('verifyAccessJwt', () => {
  it('accepts a valid Access token and normalises the email', async () => {
    expect(await verifyAccessJwt(await sign(valid()), config())).toEqual({ email: 'ada@acme.com', name: 'Ada' });
  });

  it('accepts a string audience', async () => {
    expect(await verifyAccessJwt(await sign({ ...valid(), aud: AUD }), config())).not.toBeNull();
  });

  it.each([
    ['a different audience', { aud: ['someone-else'] }],
    ['another team', { iss: 'https://evil.cloudflareaccess.com' }],
    ['an expired token', { exp: now - 5 }],
    ['a token not valid yet', { nbf: now + 3600 }],
    ['a service token (no email)', { email: undefined }],
  ])('rejects %s', async (_label, patch) => {
    expect(await verifyAccessJwt(await sign({ ...valid(), ...patch }), config())).toBeNull();
  });

  it('rejects a token signed with another key', async () => {
    expect(await verifyAccessJwt(await sign(valid(), { key: otherKeys.privateKey }), config())).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await sign(valid());
    const [h, , s] = token.split('.');
    const forged = b64url(new TextEncoder().encode(JSON.stringify({ ...valid(), email: 'boss@acme.com' })));
    expect(await verifyAccessJwt(`${h}.${forged}.${s}`, config())).toBeNull();
  });

  it('rejects other algorithms, unknown key ids and garbage', async () => {
    expect(await verifyAccessJwt(await sign(valid(), { alg: 'none' }), config())).toBeNull();
    expect(await verifyAccessJwt(await sign(valid(), { kid: 'unknown' }), config())).toBeNull();
    expect(await verifyAccessJwt('not-a-jwt', config())).toBeNull();
    expect(await verifyAccessJwt('a.b.c', config())).toBeNull();
  });

  it('refetches keys when Access rotates them', async () => {
    let calls = 0;
    const rotated = { ...jwk, kid: 'k2' };
    const cfg = { ...config(), fetchKeys: async () => (++calls === 1 ? [jwk] : [jwk, rotated]) };
    expect(await verifyAccessJwt(await sign(valid()), cfg)).not.toBeNull();
    expect(await verifyAccessJwt(await sign(valid(), { kid: 'k2' }), cfg)).not.toBeNull();
    expect(calls).toBe(2);
  });
});
