/**
 * Where a dealer hostname ends up after its redirects — `freedomfordnj.com`
 * → `freedomfordusa.com`. This requests the site's ORIGIN only ("/"), never
 * a vehicle page, and only reads Location headers: it's DNS/edge-level
 * canonicalization, not scraping. Hop-capped, timed out, SSRF-guarded.
 *
 * Server-only (DNS lookup for the guard).
 */

import dns from "node:dns/promises";
import net from "node:net";
import { normalizeDealerHost, registrableDomain } from "./deskResolve";

const MAX_HOPS = 5;
const TIMEOUT_MS = 4000;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.") || v6.startsWith("::ffff:10.");
}

async function assertPublicHost(host: string): Promise<void> {
  if (!host || host === "localhost" || host.endsWith(".local") || net.isIP(host)) throw new Error("not a public hostname");
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new Error("resolves to a private address");
}

export interface HostRedirectResult {
  /** Registrable domain the origin finally lands on, or null if it never redirected / couldn't be followed. */
  finalRegistrable: string | null;
  /** Every registrable domain seen along the way, first to last, deduplicated. */
  chain: string[];
}

/**
 * Follow the origin's redirects and report the registrable domains seen.
 * `fetchImpl` is injectable for tests; production uses global fetch with
 * HEAD and manual redirects so nothing but headers is ever read.
 */
export async function resolveHostRedirect(host: string, fetchImpl: typeof fetch = fetch): Promise<HostRedirectResult> {
  const start = registrableDomain(host);
  if (!start) return { finalRegistrable: null, chain: [] };
  const exact = (host || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // A dealer's old apex often has no TLS at all — only www. (or plain http)
  // still answers, with the redirect to the new site. Try the host as given,
  // then www., then http://, and take the first that responds.
  const starts = Array.from(
    new Set([`https://${exact}/`, `https://www.${start}/`, `https://${start}/`, `http://${exact}/`, `http://${start}/`])
  );
  for (const first of starts) {
    const r = await followFrom(first, start, fetchImpl);
    if (r) return r;
  }
  return { finalRegistrable: null, chain: [start] };
}

/** One redirect walk from a concrete origin; null when the origin itself didn't answer. */
async function followFrom(first: string, start: string, fetchImpl: typeof fetch): Promise<HostRedirectResult | null> {
  const chain: string[] = [start];
  let url = first;
  let answered = false;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let location: string | null = null;
    try {
      const target = new URL(url);
      await assertPublicHost(target.hostname);
      const res = await fetchImpl(target.toString(), {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36" },
      });
      answered = true;
      if (res.status < 300 || res.status >= 400) break;
      location = res.headers.get("location");
    } catch {
      break;
    }
    if (!location) break;
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      break;
    }
    if (!/^https?:$/.test(next.protocol)) break;
    const reg = registrableDomain(next.hostname);
    if (!reg) break;
    if (!chain.includes(reg)) chain.push(reg);
    url = next.toString();
  }
  if (!answered) return null;
  const last = chain[chain.length - 1];
  return { finalRegistrable: last !== start ? last : null, chain };
}
