import { afterEach, describe, expect, it, vi } from 'vitest';
import { framingAllowed } from '../../worker/lib/framing';
import { checkCloakable, knownSite } from '../../worker/lib/cloak-check';

const ANCESTOR = new URL('https://trim.ng');
const FRAME = new URL('https://dest.example/page');

/** Headers as a site would send them; a name given twice is sent as two headers. */
const headers = (...pairs: [string, string][]) => {
  const out = new Headers();
  for (const [name, value] of pairs) out.append(name, value);
  return out;
};
const csp = (value: string) => headers(['content-security-policy', value]);
const xfo = (value: string) => headers(['x-frame-options', value]);
const allowed = (h: Headers, ancestor = ANCESTOR, frame = FRAME) => framingAllowed(h, ancestor, frame).allowed;

describe('X-Frame-Options', () => {
  it('a page that sends nothing can be framed', () => {
    expect(framingAllowed(new Headers(), ANCESTOR, FRAME)).toEqual({ allowed: true, by: null });
  });

  it('DENY and SAMEORIGIN keep a page out of a frame on another site, in any letter case', () => {
    for (const value of ['DENY', 'deny', 'SAMEORIGIN', 'sameorigin', ' Deny ']) {
      expect(framingAllowed(xfo(value), ANCESTOR, FRAME), value).toEqual({ allowed: false, by: 'x-frame-options' });
    }
  });

  it('SAMEORIGIN allows a frame on the page\'s own site', () => {
    expect(allowed(xfo('SAMEORIGIN'), new URL('https://dest.example'), FRAME)).toBe(true);
    expect(allowed(xfo('SAMEORIGIN'), new URL('https://other.dest.example'), FRAME)).toBe(false);
    expect(allowed(xfo('DENY'), new URL('https://dest.example'), FRAME)).toBe(false);
  });

  it('ALLOW-FROM and unknown values are ignored, as browsers ignore them', () => {
    expect(allowed(xfo('ALLOW-FROM https://trim.ng'))).toBe(true);
    expect(allowed(xfo('bogus'))).toBe(true);
    expect(allowed(xfo(''))).toBe(true);
  });

  it('conflicting or repeated values still keep the page out', () => {
    expect(allowed(xfo('DENY, SAMEORIGIN'))).toBe(false);
    expect(allowed(headers(['x-frame-options', 'SAMEORIGIN'], ['x-frame-options', 'DENY']))).toBe(false);
    expect(allowed(xfo('SAMEORIGIN, SAMEORIGIN'))).toBe(false);
  });
});

describe('Content-Security-Policy: frame-ancestors', () => {
  it("'none' and 'self' keep other sites out", () => {
    expect(framingAllowed(csp("frame-ancestors 'none'"), ANCESTOR, FRAME)).toEqual({ allowed: false, by: 'frame-ancestors' });
    expect(allowed(csp("frame-ancestors 'self'"))).toBe(false);
    expect(allowed(csp("frame-ancestors 'self'"), new URL('https://dest.example'))).toBe(true);
  });

  it('* lets any site in; an empty list lets nobody in', () => {
    expect(allowed(csp('frame-ancestors *'))).toBe(true);
    expect(allowed(csp('frame-ancestors'))).toBe(false);
    expect(allowed(csp('frame-ancestors   '))).toBe(false);
  });

  it('matches hosts, wildcard subdomains, schemes and ports the way browsers do', () => {
    const cases: [string, boolean][] = [
      ['https://trim.ng', true],
      ['trim.ng', true],
      ['TRIM.NG', true],
      ['https://trim.ng:443', true],
      ['https://trim.ng:*', true],
      ['trim.ng:8080', false],
      ['http://trim.ng', true], // http: also covers https
      ['https://other.example', false],
      ['https://*.ng', true],
      ['*.ng', true],
      ['*.trim.ng', false], // a wildcard needs a subdomain; the bare domain is not one
      ['https://sub.trim.ng', false],
      ['https:', true],
      ['http:', true],
      ['ftp:', false],
      ['chrome-extension://abcdefghijklmnop', false],
      ['https://trim.ng/any/path', false], // a path is not allowed in frame-ancestors: the source is invalid and ignored
      ['nottrim.ng', false],
      ['trim.ng.evil.example', false],
    ];
    for (const [source, expected] of cases) expect(allowed(csp(`frame-ancestors ${source}`)), source).toBe(expected);
  });

  it('a source without a scheme follows the framed page\'s own scheme', () => {
    expect(allowed(csp('frame-ancestors trim.ng'), ANCESTOR, new URL('http://dest.example/'))).toBe(true); // the https upgrade
    expect(allowed(csp('frame-ancestors trim.ng'), new URL('http://trim.ng'), new URL('https://dest.example/'))).toBe(false);
  });

  it('a port is only the usual one unless the source says otherwise', () => {
    const local = new URL('http://localhost:8080');
    const frame = new URL('http://dest.example/');
    expect(allowed(csp('frame-ancestors localhost'), local, frame)).toBe(false);
    expect(allowed(csp('frame-ancestors localhost:8080'), local, frame)).toBe(true);
    expect(allowed(csp('frame-ancestors localhost:*'), local, frame)).toBe(true);
    expect(allowed(csp('frame-ancestors http://localhost:8080'), local, frame)).toBe(true);
    expect(allowed(csp('frame-ancestors https://localhost:8080'), local, frame)).toBe(false);
  });

  it('any one matching source is enough', () => {
    expect(allowed(csp("frame-ancestors 'self' https://other.example https://trim.ng"))).toBe(true);
    expect(allowed(csp("frame-ancestors 'self' https://other.example"))).toBe(false);
  });

  it('an invalid source is skipped, and the valid ones next to it still count', () => {
    expect(allowed(csp('frame-ancestors https://trim.ng/some/path https://trim.ng'))).toBe(true);
    expect(allowed(csp('frame-ancestors https://trim.ng/some/path'))).toBe(false);
  });

  it("'none' next to other sources is ignored, and nonces and hashes match nothing", () => {
    expect(allowed(csp("frame-ancestors 'none' https://trim.ng"))).toBe(true);
    expect(allowed(csp("frame-ancestors 'nonce-abc' 'sha256-xyz'"))).toBe(false);
  });

  it('finds the directive among others, in any letter case, and the first one wins', () => {
    expect(allowed(csp("default-src 'self'; Frame-Ancestors 'none'; script-src 'self'"))).toBe(false);
    expect(allowed(csp("default-src 'none'; img-src *"))).toBe(true); // no frame-ancestors: no rule
    expect(allowed(csp("frame-ancestors 'none'; frame-ancestors *"))).toBe(false);
  });

  it('every policy has to be satisfied (several headers, or several policies in one header)', () => {
    expect(allowed(headers(['content-security-policy', 'frame-ancestors *'], ['content-security-policy', "frame-ancestors 'none'"]))).toBe(false);
    expect(allowed(csp("frame-ancestors *, frame-ancestors 'none'"))).toBe(false);
    expect(allowed(csp('frame-ancestors *, frame-ancestors https://trim.ng'))).toBe(true);
    expect(allowed(csp("default-src 'self', frame-ancestors https://trim.ng"))).toBe(true);
  });

  it('a report-only policy never blocks', () => {
    expect(allowed(headers(['content-security-policy-report-only', "frame-ancestors 'none'"]))).toBe(true);
  });
});

describe('both headers together', () => {
  it('frame-ancestors wins and X-Frame-Options is ignored', () => {
    expect(framingAllowed(headers(['x-frame-options', 'DENY'], ['content-security-policy', 'frame-ancestors *']), ANCESTOR, FRAME)).toEqual({
      allowed: true,
      by: 'frame-ancestors',
    });
    expect(allowed(headers(['x-frame-options', 'SAMEORIGIN'], ['content-security-policy', 'frame-ancestors https://trim.ng']))).toBe(true);
    expect(allowed(headers(['x-frame-options', 'SAMEORIGIN'], ['content-security-policy', "frame-ancestors 'none'"]))).toBe(false);
  });

  it('a policy without frame-ancestors leaves X-Frame-Options in charge', () => {
    expect(allowed(headers(['x-frame-options', 'DENY'], ['content-security-policy', "default-src 'self'"]))).toBe(false);
  });
});

describe('real sites, as seen on the day they were checked', () => {
  it('are told apart the way Chrome treated them', () => {
    const real: [string, Headers, boolean][] = [
      [
        'claude.ai',
        csp("frame-ancestors 'self' chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn chrome-extension://dngcpimnedloihjnnfngkgjoidhnaolf; frame-src https://x.frame.claudeusercontent.com"),
        false,
      ],
      ['google.com', xfo('SAMEORIGIN'), false],
      ['github.com', headers(['x-frame-options', 'deny'], ['content-security-policy', "default-src 'none'; frame-ancestors 'none'"]), false],
      ['x.com', headers(['x-frame-options', 'SAMEORIGIN'], ['content-security-policy', "frame-ancestors 'self' https://x.com https://x.com:443 https://twitter.com https://twitter.com:443"]), false],
      ['linkedin.com', headers(['x-frame-options', 'sameorigin'], ['content-security-policy', "frame-ancestors 'self' *.www.linkedin.com:*"]), false],
      ['vercel.com', headers(['x-frame-options', 'DENY'], ['content-security-policy', "frame-ancestors 'self' https://vercel.com https://*.contentful.com https://*.vercel.sh https://*.vercel.com"]), false],
      ['meet.google.com', xfo('DENY'), false],
      ['example.com', new Headers(), true],
      ['github pages', headers(['content-security-policy', "default-src 'none'; style-src 'unsafe-inline'"]), true],
    ];
    for (const [site, h, expected] of real) expect(allowed(h), site).toBe(expected);
  });
});

describe('knownSite', () => {
  it('covers the site and its subdomains, and nothing that merely looks similar', () => {
    for (const host of ['zoom.us', 'us02web.zoom.us', 'ZOOM.US', 'zoom.us.', 'claude.ai', 'www.claude.ai', 'us.zoomgov.com']) {
      expect(knownSite(host)?.status, host).toBe('blocked');
    }
    for (const host of ['notzoom.us', 'zoom.us.evil.example', 'zoom.com', 'claude.com', 'example.com']) expect(knownSite(host), host).toBeNull();
  });

  it('says what is wrong in plain words, naming the site', () => {
    const zoom = knownSite('us02web.zoom.us');
    expect(zoom).toMatchObject({ status: 'blocked', reason: 'known-site', host: 'us02web.zoom.us' });
    expect(zoom?.status === 'blocked' && zoom.message).toMatch(/Zoom/);
    const claude = knownSite('www.claude.ai');
    expect(claude).toMatchObject({ host: 'claude.ai' });
    expect(claude?.status === 'blocked' && claude.message).toBe("claude.ai doesn't allow other sites to show its pages, so visitors would see a blank page.");
  });
});

describe('checkCloakable', () => {
  afterEach(() => vi.unstubAllGlobals());

  interface Reply {
    status?: number;
    headers?: Record<string, string>;
  }
  /** Replaces fetch: answers by address, and records every address that was asked for. */
  function site(replies: Record<string, Reply | Error>) {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        asked.push(input);
        const reply = replies[input];
        if (!reply) throw new Error(`unexpected request to ${input}`);
        if (reply instanceof Error) throw reply;
        return new Response('<html></html>', { status: reply.status ?? 200, headers: reply.headers });
      })
    );
    return asked;
  }
  const check = (dest: string, host = 'trim.ng', fetch = true) => checkCloakable(dest, host, { fetch });

  it('a page that sends no frame rule can be cloaked', async () => {
    site({ 'https://example.com/a': {} });
    expect(await check('https://example.com/a')).toEqual({ status: 'ok' });
  });

  it('says it cannot be cloaked, and which header said so', async () => {
    site({
      'https://www.google.com/': { headers: { 'x-frame-options': 'SAMEORIGIN' } },
      'https://github.com/x': { headers: { 'content-security-policy': "frame-ancestors 'none'" } },
    });
    expect(await check('https://www.google.com/')).toMatchObject({ status: 'blocked', reason: 'frame-options', host: 'google.com' });
    expect(await check('https://github.com/x')).toMatchObject({
      status: 'blocked',
      reason: 'frame-ancestors',
      host: 'github.com',
      message: "github.com doesn't allow other sites to show its pages, so visitors would see a blank page.",
    });
  });

  it('tests the short link\'s own address against the site\'s list of allowed sites', async () => {
    site({ 'https://dest.example/': { headers: { 'content-security-policy': 'frame-ancestors https://trim.ng' } } });
    expect(await check('https://dest.example/', 'trim.ng')).toEqual({ status: 'ok' });
    expect(await check('https://dest.example/', 'go.other.example')).toMatchObject({ status: 'blocked', reason: 'frame-ancestors' });
  });

  it('asks for the https version of an http address, as the cloak page does', async () => {
    const asked = site({ 'https://example.com/a': {} });
    expect(await check('http://example.com/a')).toEqual({ status: 'ok' });
    expect(asked).toEqual(['https://example.com/a']);
  });

  it('judges the page a visitor would land on, after redirects', async () => {
    site({
      'https://short.example/x': { status: 302, headers: { location: 'https://dest.example/final' } },
      'https://dest.example/final': { headers: { 'x-frame-options': 'DENY' } },
      'https://short.example/to-zoom': { status: 301, headers: { location: 'https://us02web.zoom.us/j/1' } },
      'https://us02web.zoom.us/j/1': {},
    });
    expect(await check('https://short.example/x')).toMatchObject({ status: 'blocked', reason: 'frame-options' });
    expect(await check('https://short.example/to-zoom')).toMatchObject({ status: 'blocked', reason: 'known-site' });
  });

  it('knows the listed sites without asking them anything', async () => {
    const asked = site({});
    expect(await check('https://zoom.us/j/123456789?pwd=abc')).toMatchObject({ status: 'blocked', reason: 'known-site', host: 'zoom.us' });
    expect(await check('https://claude.ai/artifact/AbCdEfGhIjKlMnOpQrStUv')).toMatchObject({ status: 'blocked', reason: 'known-site' });
    expect(asked).toEqual([]);
  });

  it('does not ask anyone when looking is switched off, but still knows the listed sites', async () => {
    const asked = site({});
    expect(await check('https://example.com/a', 'trim.ng', false)).toEqual({ status: 'unknown', why: 'not-checked' });
    expect(await check('https://zoom.us/j/1', 'trim.ng', false)).toMatchObject({ status: 'blocked' });
    expect(asked).toEqual([]);
  });

  it('never looks at private addresses or addresses it cannot read', async () => {
    const asked = site({});
    for (const dest of ['http://127.0.0.1/', 'http://localhost/', 'https://192.168.1.5/x', 'https://169.254.169.254/latest', 'not a url']) {
      expect(await check(dest), dest).toEqual({ status: 'unknown', why: 'not-checked' });
    }
    expect(await checkCloakable('https://example.com/', 'not a host!', { fetch: true })).toEqual({ status: 'unknown', why: 'not-checked' });
    expect(asked).toEqual([]);
  });

  it('does not follow a redirect into a private address', async () => {
    site({ 'https://short.example/x': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } } });
    expect(await check('https://short.example/x')).toEqual({ status: 'unknown', why: 'not-checked' });
  });

  it('a bot challenge or a refusal says nothing about the page, so it is "could not tell", never "cannot"', async () => {
    site({
      'https://paystack.example/': { status: 403, headers: { 'cf-mitigated': 'challenge', 'x-frame-options': 'SAMEORIGIN' } },
      'https://refuses.example/': { status: 403, headers: { 'x-frame-options': 'DENY' } },
      'https://limits.example/': { status: 429, headers: { 'x-frame-options': 'DENY' } },
      'https://login.example/': { status: 401, headers: { 'x-frame-options': 'DENY' } },
    });
    for (const dest of ['https://paystack.example/', 'https://refuses.example/', 'https://limits.example/', 'https://login.example/']) {
      expect(await check(dest), dest).toEqual({ status: 'unknown', why: 'turned-away' });
    }
  });

  it('a missing page, a broken site or a connection failure is "could not tell"', async () => {
    site({
      'https://gone.example/': { status: 404, headers: { 'x-frame-options': 'DENY' } },
      'https://broken.example/': { status: 503 },
      'https://down.example/': new TypeError('fetch failed'),
      'https://slow.example/': Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    });
    for (const dest of ['https://gone.example/', 'https://broken.example/', 'https://down.example/', 'https://slow.example/']) {
      expect(await check(dest), dest).toEqual({ status: 'unknown', why: 'unreachable' });
    }
  });

  it('only reads the headers: the page itself is not downloaded', async () => {
    let cancelled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const body = new ReadableStream({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
          },
          cancel() {
            cancelled = true;
          },
        });
        return new Response(body, { status: 200, headers: { 'x-frame-options': 'DENY' } });
      })
    );
    expect(await check('https://example.com/big')).toMatchObject({ status: 'blocked' });
    expect(cancelled).toBe(true);
  });
});
