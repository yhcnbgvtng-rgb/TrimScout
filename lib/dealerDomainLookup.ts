/**
 * Who owns the site a pasted listing link points at — answered from the
 * contact directory instead of the page.
 *
 * Every crawled rooftop carries its website in the notes column
 * ("Website: https://www.example.com/ | ..."), and across 11,540 rows those
 * are 11,347 distinct domains with two collisions. So the hostname of a VDP
 * link is, in practice, a unique key onto the dealership — one that keeps
 * working when the page itself is behind Cloudflare and we never get to read
 * its JSON-LD. Pure logic; the caller supplies the directory rows.
 */

import type { DealerPageIdentity } from "./dealerPageIdentity";

export interface DomainIndexableDealership {
  dealerName: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  notes: string | null;
  /** Canonical website (column); the crawl's "Website:" note is the fallback. */
  website?: string | null;
  /** Registrable hosts that also map here (vanity domains, redirect targets). */
  domains?: string[] | null;
}

/** "https://www.loubachrodtbmw.com/new-..." → "loubachrodtbmw.com". Null for a non-URL. */
export function hostnameFromUrl(url: string): string | null {
  const raw = (url || "").trim();
  if (!raw) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return normalizeDomain(host);
  } catch {
    return null;
  }
}

/** Lower-case, no trailing dot, no leading "www." — the shape the index is keyed on. */
export function normalizeDomain(host: string): string | null {
  const clean = (host || "").trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!clean || !clean.includes(".")) return null;
  return clean;
}

/** The "Website: https://…" the crawls left in notes, or null. */
export function websiteFromNotes(notes: string | null | undefined): string | null {
  const m = (notes || "").match(/\bWebsite:\s*(https?:\/\/[^\s|]+)/i);
  return m ? m[1] : null;
}

export function dealershipDomain(row: DomainIndexableDealership): string | null {
  const site = (row.website || "").trim() || websiteFromNotes(row.notes);
  return site ? hostnameFromUrl(site) : null;
}

/** Every host key for a row: the website's, plus domains[]. */
export function dealershipDomains(row: DomainIndexableDealership): string[] {
  const out = new Set<string>();
  const primary = dealershipDomain(row);
  if (primary) out.add(primary);
  for (const d of row.domains || []) {
    const n = hostnameFromUrl(d);
    if (n) out.add(n);
  }
  return Array.from(out);
}

/**
 * Candidate keys for a listing host, most specific first. A dealer that
 * publishes its inventory on "inventory.example.com" is still example.com;
 * the bare registrable domain is tried after the exact host. Stops at two
 * labels so "com" never becomes a key.
 */
export function domainCandidates(host: string): string[] {
  const norm = normalizeDomain(host);
  if (!norm) return [];
  const labels = norm.split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    out.push(labels.slice(i).join("."));
  }
  return out;
}

const INDEX_CACHE = new WeakMap<object, Map<string, DomainIndexableDealership[]>>();

/** One pass over the directory; memoized per array instance so a cached directory is indexed once. */
export function indexDealershipsByDomain<T extends DomainIndexableDealership>(rows: T[]): Map<string, T[]> {
  const hit = INDEX_CACHE.get(rows);
  if (hit) return hit as Map<string, T[]>;
  const index = new Map<string, T[]>();
  for (const row of rows) {
    for (const domain of dealershipDomains(row)) {
      const list = index.get(domain);
      if (list) list.push(row);
      else index.set(domain, [row]);
    }
  }
  INDEX_CACHE.set(rows, index);
  return index;
}

/**
 * The rooftop a listing link belongs to, or null. When a domain is shared
 * (a dealer group's one site for several stores) the row in the requested
 * state wins; with no state to break the tie, a shared domain is treated as
 * unknown rather than guessed — naming the wrong store is worse than naming
 * none.
 */
export function matchDealershipByUrl<T extends DomainIndexableDealership>(
  rows: T[],
  url: string,
  opts: { state?: string | null } = {}
): T | null {
  const host = hostnameFromUrl(url);
  if (!host) return null;
  const index = indexDealershipsByDomain(rows);
  const wanted = (opts.state || "").trim().toUpperCase();
  for (const key of domainCandidates(host)) {
    const matches = index.get(key);
    if (!matches || matches.length === 0) continue;
    if (matches.length === 1) return matches[0];
    if (wanted) {
      const inState = matches.filter((m) => (m.state || "").trim().toUpperCase() === wanted);
      if (inState.length === 1) return inState[0];
    }
    return null;
  }
  return null;
}

/** The directory row in the shape the page-identity layers produce, so downstream code doesn't care which found it. */
export function identityFromDealership(row: DomainIndexableDealership): DealerPageIdentity {
  return {
    name: row.dealerName.trim() || null,
    city: row.city?.trim() || null,
    state: row.state?.trim().toUpperCase() || null,
    zip: row.zipCode?.trim() || null,
    source: "directory_domain",
  };
}
