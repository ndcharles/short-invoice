/**
 * UTM campaign URL building, honouring the formatting options configured in
 * Settings → UTM Builder (encoding style, space character, lowercase, strip).
 */

export interface UtmFields {
  website: string;
  source: string;
  medium: string;
  campaign: string;
  campaign_id: string;
  term: string;
  content: string;
  comments: string;
  folder: string;
}

export interface UtmFormatOptions {
  encoding: string;
  space: string;
  lowercase: boolean;
  stripExisting: boolean;
}

export const DEFAULT_UTM_FORMAT: UtmFormatOptions = {
  encoding: 'Standard (RFC 3986)',
  space: '%20',
  lowercase: true,
  stripExisting: false,
};

export const EMPTY_UTM_FIELDS: UtmFields = {
  website: '',
  source: '',
  medium: '',
  campaign: '',
  campaign_id: '',
  term: '',
  content: '',
  comments: '',
  folder: 'Campaigns',
};

export const UTM_PARAM_KEYS = [
  ['source', 'utm_source'],
  ['medium', 'utm_medium'],
  ['campaign', 'utm_campaign'],
  ['campaign_id', 'utm_id'],
  ['term', 'utm_term'],
  ['content', 'utm_content'],
] as const;

export function formatOptionsFromSettings(settings: Record<string, string> | null): UtmFormatOptions {
  if (!settings) return DEFAULT_UTM_FORMAT;
  return {
    encoding: settings.utm_encoding ?? DEFAULT_UTM_FORMAT.encoding,
    space: settings.utm_space ?? DEFAULT_UTM_FORMAT.space,
    lowercase: settings.utm_lowercase === 'true',
    stripExisting: settings.utm_strip_existing === 'true',
  };
}

function encodeValue(value: string, opts: UtmFormatOptions): string {
  const raw = opts.lowercase ? value.toLowerCase() : value;

  if (opts.encoding === 'Lenient') {
    // Keep the characters that tools like GTM accept unencoded.
    const lenient = encodeURIComponent(raw)
      .replace(/%2C/gi, ',')
      .replace(/%3A/gi, ':')
      .replace(/%2B/gi, '+')
      .replace(/%40/gi, '@')
      .replace(/%2F/gi, '/');
    return opts.space === '%20' ? lenient : lenient.replace(/%20/g, opts.space);
  }

  const standard = encodeURIComponent(raw);
  return opts.space === '%20' ? standard : standard.replace(/%20/g, opts.space);
}

export function websitePretty(website: string): string {
  return (website || '').replace(/^https?:\/\//i, '');
}

export function campaignLabel(fields: Pick<UtmFields, 'campaign' | 'campaign_id' | 'website'>): string {
  return fields.campaign?.trim() || fields.campaign_id?.trim() || websitePretty(fields.website) || '(no campaign)';
}

/** The parameters that will be appended, in the design's order. */
export function utmPairs(fields: UtmFields): { key: string; value: string }[] {
  const pairs: { key: string; value: string }[] = [];
  for (const [field, param] of UTM_PARAM_KEYS) {
    const value = (fields[field] ?? '').toString().trim();
    if (value) pairs.push({ key: param, value });
  }
  return pairs;
}

function baseWebsite(website: string, opts: UtmFormatOptions): string {
  let base = website.trim();
  if (!base) return '';
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;

  if (!opts.stripExisting) return base;

  // Drop any utm_* parameters already on the destination before appending ours.
  try {
    const url = new URL(base);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString().replace(/\?$/, '');
  } catch {
    return base;
  }
}

/** Encoded key/value pairs, matching what buildCampaignUrl appends. */
export function encodedUtmPairs(fields: UtmFields, opts: UtmFormatOptions): { key: string; value: string }[] {
  return utmPairs(fields).map((p) => ({ key: p.key, value: encodeValue(p.value, opts) }));
}

export function buildCampaignUrl(fields: UtmFields, opts: UtmFormatOptions = DEFAULT_UTM_FORMAT): string {
  const base = baseWebsite(fields.website, opts);
  if (!base) return '';
  const pairs = utmPairs(fields);
  if (pairs.length === 0) return base;
  const query = pairs.map((p) => `${p.key}=${encodeValue(p.value, opts)}`).join('&');
  return `${base}${base.includes('?') ? '&' : '?'}${query}`;
}

/** Validation used by the create/edit footers. */
export function validateUtmFields(fields: UtmFields): string | null {
  if (!fields.website.trim()) return 'Website URL is required';
  if (!fields.source.trim()) return 'Campaign source is required';
  if (!fields.medium.trim()) return 'Campaign medium is required';
  if (!fields.campaign.trim() && !fields.campaign_id.trim()) {
    return 'Provide a campaign name or campaign ID';
  }
  return null;
}
