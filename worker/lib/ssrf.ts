/**
 * Guards for fetching a web address on someone's behalf (link previews).
 * A public-looking address must not lead to the local network or the cloud
 * metadata service, directly or through a redirect.
 */

const ALLOWED_PORTS = new Set(['', '80', '443']);

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function blockedIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** True for hosts that must never be fetched. `hostname` is as parsed by URL (IPv6 may have brackets). */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;

  if (host.includes(':')) {
    // IPv6. Only plain global-unicast addresses (2000::/3) are fetched; that excludes loopback,
    // unspecified, IPv4-mapped (::ffff:), unique-local (fc00::/7) and link-local (fe80::/10).
    return !/^[23]/.test(host) || host.startsWith('2002:') /* 6to4 can embed private IPv4 */ || host.startsWith('64:ff9b:');
  }

  const octets = ipv4Octets(host);
  if (octets) return blockedIpv4(octets);

  // Names: nothing without a dot (intranet names) and nothing that is only meaningful locally.
  if (!host.includes('.')) return true;
  return /(^|\.)(localhost|local|internal|lan|home|corp|intranet|home\.arpa)$/.test(host);
}

/** Validates a URL for fetching: http(s), no credentials, a public host, a normal port. */
export function checkFetchUrl(url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Unsupported protocol';
  if (url.username || url.password) return 'Credentials in the address are not allowed';
  if (!ALLOWED_PORTS.has(url.port)) return 'Host not allowed';
  if (isBlockedHost(url.hostname)) return 'Host not allowed';
  return null;
}

/** Reads at most `max` bytes of a response body, then stops downloading. */
export async function readLimited(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return text.slice(0, max);
}
