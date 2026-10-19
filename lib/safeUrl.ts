/**
 * SSRF guard for any server-side request to a caller-supplied URL.
 *
 * A URL is only requested if: the scheme is http/https; it carries no
 * user:pass; the port is the scheme default (80/443) — so it can't probe
 * internal ports on a public name; the host isn't an IP literal or an
 * internal-looking name; and EVERY address its name resolves to is public.
 * safeFetch re-applies all of that on each redirect hop (redirects are
 * followed manually, never by fetch), so a public URL can't bounce to
 * 169.254.169.254 or localhost.
 *
 * Residual risk (documented, not hidden): the name is resolved once here and
 * again by fetch, so a DNS-rebinding host could answer differently the
 * second time. Callers that must close that fully need a pinned-IP dispatcher;
 * today's callers only send HEAD/GET to read headers or a bounded body.
 *
 * Server-only (node:dns).
 */
import dns from "node:dns/promises";
import net from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message = "That URL isn't allowed.") {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
}
const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3], // 224/3 = multicast + reserved + broadcast
];

/** True for any loopback/private/link-local/CGNAT/multicast/reserved/unspecified address (v4 or v6). */
export function isPrivateOrReservedIp(ip: string): boolean {
  const addr = ip.trim().replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(addr)) {
    const n = v4ToInt(addr);
    return V4_BLOCKS.some(([base, bits]) => {
      const size = 2 ** (32 - bits);
      return Math.floor(n / size) === Math.floor(v4ToInt(base) / size);
    });
  }
  if (net.isIPv6(addr)) {
    const lower = addr.toLowerCase();
    // IPv4-mapped / -compatible, dotted ("::ffff:10.0.0.1") or hex ("::ffff:a00:1").
    const dotted = lower.match(/^(?:0{0,4}:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateOrReservedIp(dotted[1]);
    const groups = expandV6(lower);
    if (!groups) return true; // unparseable → refuse
    const allButLastTwoZero = groups.slice(0, 5).every((g) => g === 0);
    if (allButLastTwoZero && (groups[5] === 0xffff || groups[5] === 0)) {
      // ::, ::1 and ::ffff:a.b.c.d / ::a.b.c.d in hex form
      const v4 = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
      return groups[5] === 0 && groups[6] === 0 && groups[7] <= 1 ? true : isPrivateOrReservedIp(v4);
    }
    const first = groups[0];
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (first === 0x64 && groups[1] === 0xff9b) return true; // 64:ff9b::/96 NAT64 (can reach v4 internals)
    if (first === 0x2001 && groups[1] === 0x0db8) return true; // documentation
    if (first === 0x2002) return true; // 6to4 (embeds a v4)
    return false;
  }
  return true; // not an IP at all → treat as unsafe for this check
}

function expandV6(ip: string): number[] | null {
  let s = ip;
  const dot = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dot) {
    const [a, b, c, d] = dot[1].split(".").map(Number);
    s = s.slice(0, -dot[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return all.length === 8 && all.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? all : null;
}

export type LookupFn = (host: string) => Promise<{ address: string }[]>;
const systemLookup: LookupFn = (host) => dns.lookup(host, { all: true });
let defaultLookup: LookupFn = systemLookup;
/** Test hook: swap the resolver so unit tests never touch real DNS. Pass null to restore. */
export function setDefaultLookupForTests(fn: LookupFn | null): void {
  defaultLookup = fn || systemLookup;
}

export interface SafeUrlOptions {
  /** If set, the hostname must equal or be a subdomain of one of these (e.g. "ford.com"). */
  allowedHosts?: string[];
  lookup?: LookupFn;
}

export function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((a) => {
    const d = a.toLowerCase().replace(/^\./, "");
    return h === d || h.endsWith(`.${d}`);
  });
}

/** Throws UnsafeUrlError unless `raw` is a public http(s) URL. Returns the parsed URL. */
export async function assertPublicHttpUrl(raw: string | URL, opts: SafeUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = raw instanceof URL ? raw : new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http and https URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError();
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== defaultPort) throw new UnsafeUrlError();

  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    throw new UnsafeUrlError();
  }
  if (opts.allowedHosts && !hostAllowed(host, opts.allowedHosts)) throw new UnsafeUrlError("That host isn't on the allowed list.");
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) throw new UnsafeUrlError();
    return url;
  }
  let addrs: { address: string }[];
  try {
    addrs = await (opts.lookup || defaultLookup)(host);
  } catch {
    throw new UnsafeUrlError("Could not resolve that host.");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateOrReservedIp(a.address))) throw new UnsafeUrlError();
  return url;
}

export interface SafeFetchOptions extends SafeUrlOptions {
  maxHops?: number;
  fetchImpl?: typeof fetch;
}

/** fetch() that validates the URL and every redirect hop. Redirects are followed here, not by fetch. */
export async function safeFetch(raw: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
  const doFetch = opts.fetchImpl || fetch;
  const maxHops = opts.maxHops ?? 5;
  let current = raw;
  let method = init.method || "GET";
  let body = init.body;
  for (let hop = 0; hop <= maxHops; hop++) {
    const url = await assertPublicHttpUrl(current, opts);
    const res = await doFetch(url.toString(), { ...init, method, body, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    current = new URL(location, url).toString();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
  }
  throw new UnsafeUrlError("Too many redirects.");
}
