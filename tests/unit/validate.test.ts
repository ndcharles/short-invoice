import { describe, expect, it } from 'vitest';
import {
  parseAlias,
  parseEmail,
  parseHexColor,
  parseHostname,
  parseHttpUrl,
  parseImageSource,
  parseMultiline,
  parseNumber,
  parseText,
} from '@/lib/validate';
import { parseDomains, shortUrlFor } from '@/lib/short-url';
import { randomAlias } from '@/lib/links/fields';
import { signUnlock, verifyUnlock } from '../../worker/lib/unlock';

describe('parseHttpUrl', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['http://example.com/a?b=1#c', 'http://example.com/a?b=1#c'],
    ['  https://EXAMPLE.com/Path  ', 'https://example.com/Path'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['localhost:3000', 'https://localhost:3000/'],
  ])('accepts %s', (input, expected) => {
    expect(parseHttpUrl(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,hi',
    'mailto:a@b.co',
    'ftp://example.com',
    'https://user:pass@example.com',
    'https://example.com@evil.com',
    'https://exa mple.com',
    'https://example.com/\nx',
    'https://intranet',
    '',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('rejects %j', (input) => {
    expect(parseHttpUrl(input).ok).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(parseHttpUrl(42).ok).toBe(false);
    expect(parseHttpUrl({ href: 'https://x.y' }).ok).toBe(false);
  });
});

describe('parseAlias', () => {
  it('accepts letters, numbers, dash and underscore', () => {
    expect(parseAlias('Spring_Sale-2026')).toEqual({ ok: true, value: 'Spring_Sale-2026' });
    expect(parseAlias('/with slash prefix')).toEqual({ ok: true, value: 'with-slash-prefix' });
  });
  it.each(['a/b', 'a.b', '<b>', "a'b", '-x', '_x', 'api', 'API', 's', 'invoices', ''])('rejects %j', (alias) => {
    expect(parseAlias(alias).ok).toBe(false);
  });
  it('random aliases are always valid', () => {
    for (let i = 0; i < 200; i++) expect(parseAlias(randomAlias()).ok).toBe(true);
  });
});

describe('parseHostname', () => {
  it('normalises', () => {
    expect(parseHostname('https://Go.Example.COM/')).toEqual({ ok: true, value: 'go.example.com' });
  });
  it.each(['example', 'exa mple.com', 'example.com/path', '-bad.com', 'a..b.com', 'example.com:80', 'ex_ample.com'])(
    'rejects %j',
    (host) => expect(parseHostname(host).ok).toBe(false)
  );
});

describe('text, numbers and misc', () => {
  it('parseText trims, caps and rejects control characters', () => {
    expect(parseText('  hi  ', 'x')).toEqual({ ok: true, value: 'hi' });
    expect(parseText('', 'x')).toEqual({ ok: true, value: null });
    expect(parseText('a\u0007b', 'x').ok).toBe(false);
    expect(parseText('abc', 'x', 2).ok).toBe(false);
    expect(parseText(5, 'x').ok).toBe(false);
  });
  it('parseMultiline keeps newlines', () => {
    expect(parseMultiline('a\r\nb', 'x')).toEqual({ ok: true, value: 'a\nb' });
    expect(parseMultiline('a\u0000b', 'x').ok).toBe(false);
  });
  it('parseNumber bounds', () => {
    expect(parseNumber('1500', 'x', { min: 0 })).toEqual({ ok: true, value: 1500 });
    expect(parseNumber('', 'x', { fallback: 3 })).toEqual({ ok: true, value: 3 });
    expect(parseNumber(-1, 'x', { min: 0 }).ok).toBe(false);
    expect(parseNumber(NaN, 'x').ok).toBe(false);
    expect(parseNumber('1e999', 'x').ok).toBe(false);
  });
  it('parseEmail', () => {
    expect(parseEmail('a@b.co').ok).toBe(true);
    expect(parseEmail('').ok).toBe(true);
    expect(parseEmail('nope').ok).toBe(false);
  });
  it('parseHexColor', () => {
    expect(parseHexColor('#1D4ED8')).toEqual({ ok: true, value: '#1d4ed8' });
    expect(parseHexColor('red').ok).toBe(false);
    expect(parseHexColor('#fff;x:y').ok).toBe(false);
  });
  it('parseImageSource', () => {
    expect(parseImageSource('data:image/png;base64,iVBORw0KGgo=').ok).toBe(true);
    expect(parseImageSource('data:text/html;base64,PHNjcmlwdD4=').ok).toBe(false);
    expect(parseImageSource('javascript:alert(1)').ok).toBe(false);
    expect(parseImageSource('https://example.com/logo.png').ok).toBe(true);
  });
});

describe('short URLs', () => {
  const ctx = { origin: 'https://app.workers.dev', defaultDomain: '4th.link', activeDomains: ['go.example.com'] };

  it('uses the custom domain once it is active', () => {
    expect(shortUrlFor({ domain: 'go.example.com', alias: 'abc' }, ctx)).toEqual({
      url: 'https://go.example.com/abc',
      label: 'go.example.com/abc',
      live: true,
    });
  });

  it('falls back to the app host for the default domain', () => {
    expect(shortUrlFor({ domain: '4th.link', alias: 'abc' }, ctx)).toEqual({
      url: 'https://app.workers.dev/s/abc',
      label: 'app.workers.dev/s/abc',
      live: true,
    });
  });

  it('marks links on pending non-default domains as not live', () => {
    expect(shortUrlFor({ domain: 'pending.example', alias: 'abc' }, ctx).live).toBe(false);
  });

  it('parses the older stored domain shape', () => {
    const list = parseDomains(JSON.stringify([{ id: 'x', name: 'A.example', status: 'Active', added: 'Added today' }, { name: 'a.example' }, null]));
    expect(list).toEqual([{ id: 'x', name: 'a.example', status: 'active', added: 0, verified_at: null }]);
  });
});

describe('unlock cookies', () => {
  it('round-trips and binds to link, hash and expiry', async () => {
    const now = Date.now();
    const cookie = await signUnlock('secret', 'lnk_1', 'hash-a', now);
    expect(await verifyUnlock('secret', 'lnk_1', 'hash-a', cookie, now)).toBe(true);
    expect(await verifyUnlock('other', 'lnk_1', 'hash-a', cookie, now)).toBe(false);
    expect(await verifyUnlock('secret', 'lnk_2', 'hash-a', cookie, now)).toBe(false);
    expect(await verifyUnlock('secret', 'lnk_1', 'hash-b', cookie, now)).toBe(false);
    expect(await verifyUnlock('secret', 'lnk_1', 'hash-a', cookie, now + 13 * 3600_000)).toBe(false);
    const [exp, sig] = cookie.split('.');
    expect(await verifyUnlock('secret', 'lnk_1', 'hash-a', `${Number(exp) + 1}.${sig}`, now)).toBe(false);
  });
});
