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
 *
 * Locking: the server checks a link's expiry each time the page is requested, but a page that is already open
 * is never asked again, so a cloaked link would stay usable on screen long after it expired. A cloaked link that
 * is going to expire therefore locks itself: a small script reloads the page at the moment it expires, and the
 * server then answers with the expired notice. (A plain redirect link cannot do this: its visitors are on the
 * destination's own site by then.)
 */
import { esc, previewTags, type PagePreview } from './preview-tags';

/** What the cloak page says about the destination it shows. */
export type CloakPreview = PagePreview;

/**
 * Reloads the page when the link's time is up. Fixed text, allowed by its hash in the page's policy.
 * - `data-expires-in` is how long is left by the server's own clock when the page was sent, so a wrong clock on
 *   the visitor's device cannot make it early or late. The reload is a moment after the real expiry.
 * - Long waits are taken an hour at a time (a timer cannot be set much beyond 24 days), and the time is checked
 *   again whenever the tab comes back to the foreground or is restored from the back/forward cache, because phones
 *   and sleeping laptops pause timers.
 * - location.replace goes to the same address with a plain GET and leaves no extra history entry. A reload could
 *   re-send the password form this page may have been the answer to.
 */
export const CLOAK_LOCK_SCRIPT =
  '(function(){var left=Number(document.body.getAttribute("data-expires-in"));if(!(left>0))return;var deadline=Date.now()+left,timer;function check(){var remaining=deadline-Date.now();if(remaining<=0){location.replace(location.href);return}clearTimeout(timer);timer=setTimeout(check,Math.min(remaining+50,3600000))}document.addEventListener("visibilitychange",function(){if(!document.hidden)check()});window.addEventListener("pageshow",check);check()})()';

/** For a link that is going to expire: how long is left, and the hash that lets the page's policy allow CLOAK_LOCK_SCRIPT. */
export interface CloakLock {
  expiresInMs: number;
  scriptHash: string;
}

export function cloakPage(alias: string, target: string, secure: boolean, preview?: CloakPreview, lock?: CloakLock): { html: string; csp: string } {
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
<body${lock ? ` data-expires-in="${Math.max(1, Math.round(lock.expiresInMs))}"` : ''}>
  <iframe src="${esc(src)}" referrerpolicy="no-referrer"></iframe>${lock ? `\n  <script>${CLOAK_LOCK_SCRIPT}</script>` : ''}
</body>
</html>`;
  // This page only shows the destination in a frame; it loads nothing else and cannot be framed itself.
  const scripts = lock ? ` script-src 'sha256-${lock.scriptHash}';` : '';
  const csp = secure
    ? `default-src 'none'; style-src 'unsafe-inline';${scripts} frame-src https:; frame-ancestors 'none'; upgrade-insecure-requests`
    : `default-src 'none'; style-src 'unsafe-inline';${scripts} frame-src http: https:; frame-ancestors 'none'`;
  return { html, csp };
}
