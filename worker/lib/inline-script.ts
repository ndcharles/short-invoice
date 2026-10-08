/**
 * The pages the Worker writes itself have a strict Content-Security-Policy that allows no scripts. The few small
 * scripts they do need are fixed text, and each is allowed by its hash (`script-src 'sha256-…'`), so nothing else
 * can ever run there. Tests check that every page's hash matches its script.
 */
const hashes = new Map<string, Promise<string>>();

/** The base64 SHA-256 of a script's exact text, as a CSP expects it. Worked out once per script. */
export function scriptHash(script: string): Promise<string> {
  let hash = hashes.get(script);
  if (!hash) {
    hash = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(script))
      .then((digest) => btoa(String.fromCharCode(...new Uint8Array(digest))));
    hashes.set(script, hash);
  }
  return hash;
}
