/**
 * Pages the Worker writes itself (password prompt, link not found, expired) load nothing from
 * anywhere and cannot be framed. Static pages carry their own policy from public/_headers, and the
 * cloaked-link page sets its own. These have no forms, so form-action is 'none'; the password page
 * is the one exception and has its own policy (see routes/redirect.ts).
 */
export const GENERATED_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
