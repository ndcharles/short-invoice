/**
 * The page that shows a destination inside the short link's own address
 * (link cloaking).
 *
 * Framing: short links are served over HTTPS, and browsers refuse to load an
 * http:// frame inside an https:// page ("mixed content"), so a cloaked link to
 * an http:// destination showed a blank page. On HTTPS we therefore ask for the
 * https:// version of the destination and tell the browser to upgrade the frame
 * request. A destination that only speaks plain http cannot be framed from an
 * https page at all. Over plain http (local development) nothing is changed.
 *
 * Describing: the page itself is only a frame, so it has to say what is inside
 * it. Its title (the browser tab) and its description and image (what social
 * apps show when the link is shared) come from the destination, unless the
 * owner wrote their own. See routes/redirect.ts for how they are worked out.
 */
import { parseHttpUrl } from '../../src/lib/validate';

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What the cloak page says about the destination it shows. */
export interface CloakPreview {
  title: string;
  description: string;
  /** A web address for the image, or null. Anything that is not an http(s) address is left out. */
  image: string | null;
  site: string | null;
  /** The short link itself, as shared. */
  url: string;
}

function previewTags(preview: CloakPreview): string {
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

export function cloakPage(alias: string, target: string, secure: boolean, preview?: CloakPreview): { html: string; csp: string } {
  let src = target;
  if (secure) {
    try {
      const url = new URL(target);
      if (url.protocol === 'http:') {
        url.protocol = 'https:';
        src = url.toString();
      }
    } catch {
      /* the caller already validated the address; keep it as given */
    }
  }
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(preview?.title.trim() || alias)}</title>${preview ? `\n${previewTags(preview)}` : ''}
  <style>
    body, html { margin:0; padding:0; height:100%; overflow:hidden; }
    iframe { border:none; width:100%; height:100%; }
  </style>
</head>
<body>
  <iframe src="${esc(src)}" referrerpolicy="no-referrer"></iframe>
</body>
</html>`;
  // This page only shows the destination in a frame; it loads nothing else and cannot be framed itself.
  const csp = secure
    ? "default-src 'none'; style-src 'unsafe-inline'; frame-src https:; frame-ancestors 'none'; upgrade-insecure-requests"
    : "default-src 'none'; style-src 'unsafe-inline'; frame-src http: https:; frame-ancestors 'none'";
  return { html, csp };
}
