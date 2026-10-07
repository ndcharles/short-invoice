import { describe, expect, it } from 'vitest';
import { knownDomainNames, parseDomains, shortUrlContext, shortUrlFor } from '@/lib/short-url';
import { DATE_FORMATS, formatDate, fromDateInput, startOfDay, toDateInput } from '@/lib/dates';
import { newId, parseList, serializeList, toggleListValue } from '@/lib/settings-json';
import { hasUtm, pickUtm, withUtm } from '@/lib/links/utm';
import { asBooleanish, asText, normalizeAlias, normalizeDest, parseExpiresAt, randomAlias } from '@/lib/links/fields';
import {
  DEFAULT_UTM_FORMAT, EMPTY_UTM_FIELDS, applyPreset, buildCampaignUrl, campaignLabel, encodedUtmPairs,
  formatOptionsFromSettings, newUtmFields, utmPairs, validateUtmFields, websitePretty, type UtmFields,
} from '@/lib/utm-builder';
import { defaultOg, prettyDest, resolveOg } from '@/lib/og';

describe('short domains', () => {
  it('reads the stored list, tolerating junk and the older shape', () => {
    expect(parseDomains(undefined)).toEqual([]);
    expect(parseDomains('not json')).toEqual([]);
    expect(parseDomains('{"a":1}')).toEqual([]);
    const list = parseDomains(JSON.stringify([null, 5, { name: '  Trim.NG ' }, { name: 'trim.ng' }, { name: '' }, { name: 'go.example.com', id: 'd2', added: 5 }]));
    expect(list.map((d) => d.name)).toEqual(['trim.ng', 'go.example.com']);
    expect(list[0]).toMatchObject({ id: 'dom_trim.ng', status: 'pending', added: 0, verified_at: null });
    expect(list[1].id).toBe('d2');
  });

  it('only a recorded verification makes a domain active', () => {
    const [claimed, verified] = parseDomains(JSON.stringify([{ name: 'a.com', status: 'Active' }, { name: 'b.com', status: 'active', verified_at: 1000 }]));
    expect(claimed.status).toBe('pending');
    expect(verified.status).toBe('active');
  });

  it('lists every domain a link may use, default first', () => {
    const settings = { default_domain: '4th.link', shortener_domains: JSON.stringify([{ name: 'trim.ng' }]) };
    expect(knownDomainNames(settings)).toEqual(['4th.link', 'trim.ng']);
    expect(knownDomainNames({ default_domain: 'TRIM.ng', shortener_domains: settings.shortener_domains })).toEqual(['trim.ng']);
    expect(knownDomainNames(null)).toEqual([]);
  });

  it('builds the URL that actually resolves right now', () => {
    const ctx = shortUrlContext(
      { default_domain: 'Trim.NG', shortener_domains: JSON.stringify([{ name: 'trim.ng', verified_at: 1, status: 'active' }, { name: 'later.example', status: 'pending' }]) },
      'https://app.example.com'
    );
    expect(ctx).toEqual({ origin: 'https://app.example.com', defaultDomain: 'trim.ng', activeDomains: ['trim.ng'] });
    expect(shortUrlFor({ domain: 'trim.ng', alias: 'abc' }, ctx)).toEqual({ url: 'https://trim.ng/abc', label: 'trim.ng/abc', live: true });
    // An unverified domain falls back to the app's own address and says it is not live.
    expect(shortUrlFor({ domain: 'later.example', alias: 'abc' }, ctx)).toEqual({ url: 'https://app.example.com/s/abc', label: 'app.example.com/s/abc', live: false });
    expect(shortUrlContext(null, 'http://localhost:8787').defaultDomain).toBe('4th.link');
    expect(shortUrlFor({ domain: '4th.link', alias: 'x' }, shortUrlContext(null, 'http://localhost:8787')).live).toBe(true);
  });
});

describe('dates', () => {
  const day = Date.UTC(2026, 2, 9, 23, 59); // late evening UTC must stay the 9th
  it('formats each setting, in UTC', () => {
    expect(DATE_FORMATS.map((f) => formatDate(day, f))).toEqual(['9 Mar 2026', 'Mar 9, 2026', '09/03/2026', '2026-03-09']);
    expect(formatDate(day)).toBe('9 Mar 2026');
    expect(formatDate(day, 'something else')).toBe('9 Mar 2026');
  });
  it('shows nothing for missing or broken values', () => {
    for (const bad of [null, undefined, NaN, Infinity]) expect(formatDate(bad as number)).toBe('');
  });
  it('round-trips date inputs and rejects bad ones', () => {
    expect(toDateInput(day)).toBe('2026-03-09');
    expect(fromDateInput('2026-03-09')).toBe(Date.UTC(2026, 2, 9));
    for (const bad of ['', '9/3/2026', '2026-3-9', '2026-13-45', 'abcd-ef-gh', '2026-03-09T10:00']) expect(fromDateInput(bad), bad).toBeNull();
  });
  it('finds the start of a day', () => {
    expect(startOfDay(day)).toBe(Date.UTC(2026, 2, 9));
    expect(startOfDay(Date.UTC(2026, 2, 9))).toBe(Date.UTC(2026, 2, 9));
  });
});

describe('list-shaped settings', () => {
  it('parses safely', () => {
    expect(parseList('["a","b"]')).toEqual(['a', 'b']);
    expect(parseList(undefined, ['x'])).toEqual(['x']);
    expect(parseList('', ['x'])).toEqual(['x']);
    expect(parseList('{"a":1}', ['x'])).toEqual(['x']);
    expect(parseList('oops')).toEqual([]);
  });
  it('serialises, makes ids and toggles values', () => {
    expect(serializeList(['a'])).toBe('["a"]');
    expect(newId('tag')).toMatch(/^tag_[a-z0-9]{1,7}$/);
    expect(newId('tag')).not.toBe(newId('tag'));
    expect(toggleListValue('["a"]', 'b')).toBe('["a","b"]');
    expect(toggleListValue('["a","b"]', 'a')).toBe('["b"]');
    expect(toggleListValue('', 'a')).toBe('["a"]');
  });
});

describe('link UTM parameters', () => {
  it('only counts filled values', () => {
    expect(hasUtm(null)).toBe(false);
    expect(hasUtm({ utm_source: '', utm_medium: null })).toBe(false);
    expect(hasUtm({ utm_term: 'x' })).toBe(true);
  });
  it('appends to the destination without disturbing it', () => {
    expect(withUtm('https://e.com/p?a=1', { utm_source: 'news', utm_medium: 'email' })).toBe('https://e.com/p?a=1&utm_source=news&utm_medium=email');
    expect(withUtm('https://e.com/', { utm_source: 'new' })).toBe('https://e.com/?utm_source=new');
    expect(withUtm('https://e.com/?utm_source=old', { utm_source: 'new' })).toBe('https://e.com/?utm_source=new');
    expect(withUtm('https://e.com/a b', { utm_content: 'x y&z' })).toContain('utm_content=x+y%26z');
  });
  it('leaves the destination alone when there is nothing to add or it cannot be parsed', () => {
    expect(withUtm('https://e.com/', null)).toBe('https://e.com/');
    expect(withUtm('https://e.com/', { utm_source: '' })).toBe('https://e.com/');
    expect(withUtm('not a url', { utm_source: 'x' })).toBe('not a url');
  });
  it('picks only the UTM columns off a row', () => {
    expect(pickUtm({ utm_source: 'a', id: 'zzz' } as never)).toEqual({ utm_source: 'a', utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, utm_referral: null });
  });
});

describe('link fields', () => {
  it('asText trims and nulls out empties and non-strings', () => {
    expect(asText('  hi ')).toBe('hi');
    for (const v of ['', '   ', null, undefined, 5, {}, []]) expect(asText(v)).toBeNull();
  });
  it('asBooleanish accepts the shapes forms and JSON produce', () => {
    for (const v of [true, 1, '1', 'true']) expect(asBooleanish(v)).toBe(true);
    for (const v of [false, 0, '0', 'false', '', null, undefined, 'yes']) expect(asBooleanish(v)).toBe(false);
  });
  it('adds https to bare destinations and keeps real schemes', () => {
    expect(normalizeDest(' example.com/a ')).toBe('https://example.com/a');
    expect(normalizeDest('http://example.com')).toBe('http://example.com');
    expect(normalizeDest('https://example.com')).toBe('https://example.com');
  });
  it('cleans aliases', () => {
    expect(normalizeAlias('  //my alias ')).toBe('my-alias');
    expect(normalizeAlias('a  b')).toBe('a-b');
  });
  it('reads expiry dates in every shape the form or API can send', () => {
    expect(parseExpiresAt(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseExpiresAt('1700000000000')).toBe(1_700_000_000_000);
    expect(parseExpiresAt('1700000000')).toBe(1_700_000_000_000);
    expect(parseExpiresAt('2026-03-09T10:00:00Z')).toBe(Date.UTC(2026, 2, 9, 10));
    expect(parseExpiresAt('2026-03-09')).toBe(Date.UTC(2026, 2, 9));
    for (const v of [null, undefined, '', 'tomorrow', NaN, Infinity, {}, true]) expect(parseExpiresAt(v), String(v)).toBeNull();
  });
  it('random aliases are 7 characters with no look-alikes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const alias = randomAlias();
      expect(alias).toMatch(/^[2-9a-km-zA-HJ-NP-Z]{7}$/);
      seen.add(alias);
    }
    expect(seen.size).toBe(500);
  });
});

describe('UTM builder', () => {
  const fields = (over: Partial<UtmFields> = {}): UtmFields => ({
    ...EMPTY_UTM_FIELDS, website: 'example.com', source: 'Newsletter', medium: 'Email', campaign: 'Spring Sale', ...over,
  });

  it('builds the URL with the default options (lower-case, %20)', () => {
    expect(buildCampaignUrl(fields())).toBe('https://example.com?utm_source=newsletter&utm_medium=email&utm_campaign=spring%20sale');
  });
  it('keeps parameters in a fixed order and skips blank ones', () => {
    const pairs = utmPairs(fields({ campaign_id: ' 77 ', term: 'shoes', content: 'hero', comments: 'ignored' }));
    expect(pairs.map((p) => p.key)).toEqual(['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content']);
    expect(pairs[3].value).toBe('77');
    expect(utmPairs(fields({ campaign: '' })).map((p) => p.key)).toEqual(['utm_source', 'utm_medium']);
  });
  it('honours the space, case and encoding options', () => {
    const opts = { ...DEFAULT_UTM_FORMAT, space: '+', lowercase: false };
    expect(buildCampaignUrl(fields(), opts)).toContain('utm_campaign=Spring+Sale');
    expect(buildCampaignUrl(fields({ campaign: 'a,b:c@d/e' }), { ...opts, encoding: 'Lenient' })).toContain('utm_campaign=a,b:c@d/e');
    expect(buildCampaignUrl(fields({ campaign: 'a,b:c' }), opts)).toContain('utm_campaign=a%2Cb%3Ac');
    expect(encodedUtmPairs(fields({ source: 'A B' }), opts)[0]).toEqual({ key: 'utm_source', value: 'A+B' });
  });
  it('joins to an existing query and can strip old utm_ parameters', () => {
    const f = fields({ website: 'https://example.com/p?keep=1&UTM_Source=old' });
    expect(buildCampaignUrl(f)).toBe('https://example.com/p?keep=1&UTM_Source=old&utm_source=newsletter&utm_medium=email&utm_campaign=spring%20sale');
    expect(buildCampaignUrl(f, { ...DEFAULT_UTM_FORMAT, stripExisting: true })).toBe('https://example.com/p?keep=1&utm_source=newsletter&utm_medium=email&utm_campaign=spring%20sale');
    expect(buildCampaignUrl(fields({ website: 'https://example.com/?utm_source=old' }), { ...DEFAULT_UTM_FORMAT, stripExisting: true })).toBe('https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=spring%20sale');
  });
  it('returns the bare site with no parameters, and nothing with no site', () => {
    expect(buildCampaignUrl(fields({ source: '', medium: '', campaign: '' }))).toBe('https://example.com');
    expect(buildCampaignUrl(fields({ website: '   ' }))).toBe('');
  });
  it('validates what the footer needs', () => {
    expect(validateUtmFields(fields())).toBeNull();
    expect(validateUtmFields(fields({ website: ' ' }))).toBe('Website URL is required');
    expect(validateUtmFields(fields({ source: '' }))).toBe('Campaign source is required');
    expect(validateUtmFields(fields({ medium: '' }))).toBe('Campaign medium is required');
    expect(validateUtmFields(fields({ campaign: '' }))).toBe('Provide a campaign name or campaign ID');
    expect(validateUtmFields(fields({ campaign: '', campaign_id: '9' }))).toBeNull();
  });
  it('labels campaigns and shows websites without the scheme', () => {
    expect(websitePretty('https://example.com/a')).toBe('example.com/a');
    expect(websitePretty('HTTP://example.com')).toBe('example.com');
    expect(campaignLabel(fields())).toBe('Spring Sale');
    expect(campaignLabel(fields({ campaign: '', campaign_id: '77' }))).toBe('77');
    expect(campaignLabel(fields({ campaign: '', campaign_id: '' }))).toBe('example.com');
    expect(campaignLabel(fields({ campaign: '', campaign_id: '', website: '' }))).toBe('(no campaign)');
  });
  it('starts a new form from the saved defaults', () => {
    expect(newUtmFields(null)).toEqual(EMPTY_UTM_FIELDS);
    expect(newUtmFields({ utm_default_source: 'google', utm_default_medium: 'cpc', utm_default_folder: 'Ads' })).toMatchObject({ source: 'google', medium: 'cpc', folder: 'Ads' });
    expect(newUtmFields({ utm_default_folder: 'None' }).folder).toBe(EMPTY_UTM_FIELDS.folder);
  });
  it('reads format options from settings', () => {
    expect(formatOptionsFromSettings(null)).toBe(DEFAULT_UTM_FORMAT);
    expect(formatOptionsFromSettings({ utm_encoding: 'Lenient', utm_space: '+', utm_lowercase: 'false', utm_strip_existing: 'true' })).toEqual({ encoding: 'Lenient', space: '+', lowercase: false, stripExisting: true });
  });
  it('a preset only fills what it has', () => {
    const preset = { id: 'p', badge: 'G', color: '#000', name: 'Google', source: ' google ', medium: 'cpc', campaign: '  ', content: '' };
    expect(applyPreset(preset)).toEqual({ source: 'google', medium: 'cpc' });
  });
});

describe('link previews (Open Graph)', () => {
  it('shortens destinations for display', () => {
    expect(prettyDest('https://www.docs.example.com/a/b')).toBe('docs.example.com/a/b');
    expect(prettyDest('example.com/')).toBe('example.com');
    expect(prettyDest('')).toBe('');
  });
  it('derives a readable preview from the address', () => {
    expect(defaultOg('https://www.example.com/blog/my-first_post.html', 'x')).toEqual({
      title: 'My First Post', description: 'Shared from example.com/blog/my-first_post.html', image: null, site: 'example.com',
    });
    expect(defaultOg('https://example.com/', 'abc').title).toBe('example.com');
    expect(defaultOg('https://example.com/d/1A2b3C4d5E6f7G8h9I0jK1l', 'abc').title).toBe('example.com'); // looks like an id
    expect(defaultOg('https://example.com/' + 'a'.repeat(50), 'abc').title).toBe('example.com');
    expect(defaultOg('', 'promo')).toMatchObject({ title: 'promo', site: null, description: expect.stringContaining('Add a destination') });
    expect(defaultOg('', '').title).toBe('Untitled link');
  });
  it('prefers custom text, then the destination page, then the derived preview', () => {
    const source = { dest: 'https://example.com/pricing', alias: 'p', remote: { title: ' Pricing | Acme ', description: '', image: 'https://example.com/i.png', siteName: 'Acme' } };
    expect(resolveOg(source)).toEqual({ title: 'Pricing | Acme', description: 'Shared from example.com/pricing', image: 'https://example.com/i.png', site: 'Acme' });
    expect(resolveOg({ ...source, custom_preview: 1, og_title: ' My title ', og_description: '', og_image: null })).toMatchObject({
      title: 'My title', description: 'Shared from example.com/pricing', image: 'https://example.com/i.png', site: 'Acme',
    });
    expect(resolveOg({ ...source, custom_preview: 0, og_title: 'Ignored' }).title).toBe('Pricing | Acme');
    expect(resolveOg({ dest: 'https://example.com/pricing', alias: 'p' }).title).toBe('Pricing');
  });
});
