/** Coarse user-agent buckets for click analytics. Low cardinality on purpose. */

const BOT_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|vkshare|pinterest|headless|lighthouse|curl|wget|python-requests|go-http-client/i;

/** Link-unfurlers and crawlers would otherwise burn D1 writes and skew counts. */
export function isBot(ua: string): boolean {
  return !ua || BOT_RE.test(ua);
}

/**
 * The services that fetch a shared link to draw its card (title, description, image): WhatsApp, Slack, X,
 * LinkedIn, Facebook and Instagram, Discord, Telegram, Pinterest, Reddit, Mastodon, Bluesky, Skype, and
 * iMessage (which presents itself as Facebook's and X's crawlers).
 *
 * This is much narrower than isBot() on purpose. isBot() only decides what to count; this decides who is given a
 * different page, and anyone wrongly matched would be stuck on it instead of reaching the destination. So it
 * names the crawlers themselves, and the apps' own in-app browsers (Instagram, Facebook "FBAN", the LinkedIn and
 * Twitter apps, Slack desktop, ...) must not match.
 */
const PREVIEW_BOT_RE =
  /facebookexternalhit|Facebot|meta-externalagent|meta-externalfetcher|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|Discordbot|TelegramBot|WhatsApp\/\d|Pinterestbot|Pinterest\/\d|SkypeUriPreview|redditbot|Mastodon\/|Bluesky|Embedly|Iframely|kakaotalk-scrap|vkShare/i;

export function isPreviewBot(ua: string): boolean {
  return !!ua && PREVIEW_BOT_RE.test(ua);
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

/** A plain site name: dot-separated labels of letters, digits and hyphens, or an IPv4 address. */
const SITE_RE = /^(?=.{1,100}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Site the visitor came from: the host of the Referer header only, lower-cased, without "www.". The header is
 * whatever the visitor's browser sends, so anything that is not a plain site name of ordinary length is
 * recorded as "Other" instead of being stored as-is.
 */
export function refererHost(referer: string | null): string {
  if (!referer) return 'Direct';
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'Direct';
  }
  if (!host) return 'Direct';
  return SITE_RE.test(host) ? host : 'Other';
}
