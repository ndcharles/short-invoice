/** Coarse user-agent buckets for click analytics. Low cardinality on purpose. */

const BOT_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|vkshare|pinterest|headless|lighthouse|curl|wget|python-requests|go-http-client/i;

/** Link-unfurlers and crawlers would otherwise burn D1 writes and skew counts. */
export function isBot(ua: string): boolean {
  return !ua || BOT_RE.test(ua);
}

export function deviceOf(ua: string): string {
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  if (/mobile|iphone|android/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

export function browserOf(ua: string): string {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}

export function osOf(ua: string): string {
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

/** Host of the referrer only, so the rollup key space stays small. */
export function refererHost(referer: string | null): string {
  if (!referer) return 'Direct';
  try {
    return new URL(referer).hostname.replace(/^www\./, '') || 'Direct';
  } catch {
    return 'Direct';
  }
}
