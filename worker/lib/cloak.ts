/**
 * The page that shows a destination inside the short link's own address
 * (link cloaking).
 *
 * Short links are served over HTTPS, and browsers refuse to load an http://
 * frame inside an https:// page ("mixed content"), so a cloaked link to an
 * http:// destination showed a blank page. On HTTPS we therefore ask for the
 * https:// version of the destination and tell the browser to upgrade the frame
 * request. A destination that only speaks plain http cannot be framed from an
 * https page at all. Over plain http (local development) nothing is changed.
 */
const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function cloakPage(alias: string, target: string, secure: boolean): { html: string; csp: string } {
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
  <title>${esc(alias)}</title>
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
