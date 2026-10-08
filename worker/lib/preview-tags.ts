import { parseHttpUrl } from '../../src/lib/validate';

/**
 * The tags that make a link look right when it is shared: a title and description for the browser
 * and search, and Open Graph and Twitter tags for the cards that WhatsApp, Slack, X, LinkedIn,
 * Facebook, Discord, Telegram, iMessage and the like draw. Shared by the cloaked-link page and the
 * page link-preview crawlers get for a link with a custom preview.
 */

export const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What the tags say. */
export interface PagePreview {
  title: string;
  description: string;
  /** A web address for the image, or null. Anything that is not an http(s) address is left out. */
  image: string | null;
  site: string | null;
  /** The short link itself, as shared. */
  url: string;
}

/** The <meta> tags for a preview, one per line, indented to sit inside <head>. */
export function previewTags(preview: PagePreview): string {
  const image = preview.image ? parseHttpUrl(preview.image, 'Image') : null;
  const imageUrl = image?.ok ? image.value : null;
  const tags = [
    `<meta name="description" content="${esc(preview.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${esc(preview.url)}">`,
    `<meta property="og:title" content="${esc(preview.title)}">`,
    `<meta property="og:description" content="${esc(preview.description)}">`,
    ...(preview.site ? [`<meta property="og:site_name" content="${esc(preview.site)}">`] : []),
    ...(imageUrl ? [`<meta property="og:image" content="${esc(imageUrl)}">`] : []),
    `<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(preview.title)}">`,
    `<meta name="twitter:description" content="${esc(preview.description)}">`,
    ...(imageUrl ? [`<meta name="twitter:image" content="${esc(imageUrl)}">`] : []),
  ];
  return tags.map((tag) => `  ${tag}`).join('\n');
}
