/**
 * SSRF guard for endpoints that open a socket to a caller-supplied host (#267).
 *
 * The Azure Function's network vantage is not the caller's: an outbound connect
 * to 10.x / 169.254.169.254 / 127.0.0.1 is an internal-service reachability and
 * port-probe primitive. Callers get a public-internet-only view instead.
 *
 * Like `shared/validate.ts`, the caller owns the response shape — the guard only
 * hands back an error message string. It diverges from that module's plain
 * `null`-on-success because the success case carries a value: the vetted address
 * the caller must dial (see `validatePublicHost`).
 */
import { lookup } from 'node:dns/promises';

/** Message returned when any resolved address falls in a blocked range. */
export const BLOCKED_HOST_MESSAGE = 'Refusing to connect to a private or link-local address';

/** Dotted-quad → 4 octets; null when the string is not an IPv4 literal. */
function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isBlockedIPv4([a, b, c, d]: number[]): boolean {
  if (a === 0) return true;                            // 0.0.0.0/8 — "this network"
  if (a === 10) return true;                           // 10.0.0.0/8 — private
  if (a === 127) return true;                          // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16 — link-local, incl. the 169.254.169.254 cloud metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12 — private
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16 — private
  if (a === 100 && b >= 64 && b <= 127) return true;   // 100.64.0.0/10 — CGNAT
  // 168.63.129.16/32 — Azure WireServer, the host-communication endpoint every
  // Azure VM/App Service can reach (DNS, DHCP, guest-agent plugin endpoints).
  // Publicly-routable-looking unicast, so no range rule above catches it, and it
  // is the standard second SSRF target after 169.254.169.254 on Azure — which is
  // exactly where this app runs.
  if (a === 168 && b === 63 && c === 129 && d === 16) return true;
  return false;
}

/** Expands an IPv6 literal to its 8 hextets; null when unparseable. */
function parseIPv6(ip: string): number[] | null {
  let text = ip.split('%')[0].toLowerCase(); // drop any zone id (fe80::1%eth0)
  if (!text.includes(':')) return null;

  // An embedded IPv4 tail (::ffff:a.b.c.d) is rewritten to two hextets so one
  // expansion path covers both notations.
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;

  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const hextets: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    hextets.push(parseInt(group, 16));
  }
  return hextets;
}

function isBlockedIPv6(h: number[]): boolean {
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses are
  // judged by the IPv4 rules — which also catches ::1 and :: via 0.0.0.0/8.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    return isBlockedIPv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true;  // fc00::/7 — unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true;  // fe80::/10 — link local
  return false;
}

/**
 * True when `ip` is a literal address we refuse to connect to. Unparseable
 * input is blocked too — this gate fails closed.
 */
export function isBlockedAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isBlockedIPv6(v6);
  return true;
}

/**
 * Verdict of `validatePublicHost` — one of the two branches, never both:
 * `{ error }` is a caller-facing message, `{ address }` is the vetted IP to dial.
 */
export type PublicHostVerdict = { error: string } | { address: string };

/**
 * Resolves `host` and returns `{ error }` when ANY resolved address is blocked —
 * one bad A/AAAA record is enough, so a multi-record or rebinding answer can't
 * slip a private address past. A literal IP takes the same path because
 * `dns.lookup` returns literals verbatim.
 *
 * On success the verdict carries the address that was actually checked, and the
 * caller MUST dial that instead of the hostname. Dialling by name would let the
 * socket's own resolution run a second lookup, and a low-TTL record answering
 * public here and private there walks straight through this guard (DNS
 * rebinding). Passing a literal skips DNS in `net`/`tls` entirely, so the
 * address that was vetted is the address that gets connected.
 */
export async function validatePublicHost(host: string): Promise<PublicHostVerdict> {
  const trimmed = host.trim();
  if (!trimmed) return { error: 'host is required' };

  let addresses: { address: string }[];
  try {
    addresses = await lookup(trimmed, { all: true });
  } catch {
    return { error: `Could not resolve host ${trimmed}` };
  }
  if (addresses.length === 0) return { error: `Could not resolve host ${trimmed}` };
  if (addresses.some((a) => isBlockedAddress(a.address))) return { error: BLOCKED_HOST_MESSAGE };
  return { address: addresses[0].address };
}
