/**
 * Which dealer desk a pasted vehicle-page link belongs to — decided from the
 * link's hostname and the contacts on file, never from the page. Dealer
 * sites sit behind Cloudflare; the buyer's browser is the only thing that
 * visits them. Pure logic; the route supplies the contact rows.
 *
 * Keys, most to least specific:
 *   1. an exact hostname in a contact's host_aliases
 *   2. the link's registrable domain against a contact's canonical website
 *   3. the registrable domain against host_aliases
 *   4. the registrable domain against the sales contact's email domain, only
 *      for contacts with no website on file
 *
 * One confident hit binds the desk. Zero, or more than one, hands the buyer
 * a picker — a wrong rooftop would get a quote request for a car it never
 * had. The URL's path or slug is never a key; at most it seeds the picker.
 */

import { normalizeDomain } from "./dealerDomainLookup";
import { emailDomainOf, isPublicEmailDomain } from "./quotePackage";

export interface DeskContact {
  id: string;
  dealerName: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  emailOptOut: boolean;
  notes: string | null;
  /** Canonical website. Not a column yet — derived from notes when absent (see contactWebsite). */
  website?: string | null;
  /** Extra hostnames that map to this desk (vanity URLs, Dealer.com hosts). */
  hostAliases?: string[] | null;
}

/** What the buyer is shown for a matched desk. Deliberately no email address. */
export interface DeskMatch {
  deskId: string;
  dealerName: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** A named person with a personal mailbox is on file — the only kind that gets a quote request. */
  knownNamed: boolean;
  emailOptOut: boolean;
}

export type DeskMatchVia = "alias_host" | "website" | "alias_domain" | "email_domain";

export type DeskResolution =
  | { status: "invalid" }
  | { status: "unique"; desk: DeskMatch; via: DeskMatchVia; host: string }
  | { status: "ambiguous"; candidates: DeskMatch[]; host: string }
  | { status: "none"; host: string; suggestedQuery: string | null };

/** Subdomains dealer platforms put in front of inventory pages; none of them identify a different store. */
const INVENTORY_SUBDOMAINS = new Set([
  "www", "www1", "www2", "m", "mobile", "inventory", "shop", "cars", "new", "used", "vehicles", "buy",
  "search", "specials", "deals", "dealer", "site", "web", "store", "express", "digital", "online",
]);

/** Public suffixes with two labels, so "example.co.uk" keys as itself and not as "co.uk". */
const TWO_LABEL_SUFFIXES = new Set(["co.uk", "com.au", "co.nz", "com.mx", "co.za", "com.br", "co.jp"]);

export function registrableDomain(host: string): string | null {
  const norm = normalizeDomain(host);
  if (!norm) return null;
  const labels = norm.split(".");
  if (labels.length <= 2) return norm;
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export interface NormalizedHost {
  /** Full hostname, lower-cased, no "www." or inventory-style prefix. */
  host: string;
  /** The registrable domain — the primary matching key. */
  registrable: string;
}

/** "https://inventory.Example.com/new/x" → { host: "example.com", registrable: "example.com" }. Null for a non-URL. */
export function normalizeDealerHost(url: string): NormalizedHost | null {
  const raw = (url || "").trim();
  if (!raw) return null;
  let hostname: string;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    hostname = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  const registrable = registrableDomain(hostname);
  if (!registrable) return null;
  const labels = (normalizeDomain(hostname) || "").split(".");
  // Peel inventory-style prefixes, but never below the registrable domain.
  while (labels.length > registrable.split(".").length && INVENTORY_SUBDOMAINS.has(labels[0])) labels.shift();
  return { host: labels.join("."), registrable };
}

export function websiteFromContactNotes(notes: string | null | undefined): string | null {
  const m = (notes || "").match(/\bWebsite:\s*(https?:\/\/[^\s|]+)/i);
  return m ? m[1] : null;
}

/** The canonical website — the column when present, else what the crawl left in notes. */
export function contactWebsite(contact: DeskContact): string | null {
  return (contact.website || "").trim() || websiteFromContactNotes(contact.notes);
}

interface DeskIndex {
  byAliasHost: Map<string, DeskContact[]>;
  byWebsiteDomain: Map<string, DeskContact[]>;
  byAliasDomain: Map<string, DeskContact[]>;
  byEmailDomain: Map<string, DeskContact[]>;
}

const INDEX_CACHE = new WeakMap<object, DeskIndex>();

function push(map: Map<string, DeskContact[]>, key: string | null, row: DeskContact) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

export function indexDeskContacts(contacts: DeskContact[]): DeskIndex {
  const hit = INDEX_CACHE.get(contacts);
  if (hit) return hit;
  const index: DeskIndex = {
    byAliasHost: new Map(),
    byWebsiteDomain: new Map(),
    byAliasDomain: new Map(),
    byEmailDomain: new Map(),
  };
  for (const row of contacts) {
    const site = contactWebsite(row);
    const siteHost = site ? normalizeDealerHost(site) : null;
    push(index.byWebsiteDomain, siteHost?.registrable ?? null, row);
    for (const alias of row.hostAliases || []) {
      const a = normalizeDealerHost(alias);
      if (!a) continue;
      push(index.byAliasHost, a.host, row);
      push(index.byAliasDomain, a.registrable, row);
    }
    if (!site) {
      const domain = emailDomainOf(row.contactEmail);
      if (domain && !isPublicEmailDomain(domain)) push(index.byEmailDomain, registrableDomain(domain), row);
    }
  }
  INDEX_CACHE.set(contacts, index);
  return index;
}

export function deskMatchFromContact(row: DeskContact, knownNamed: boolean): DeskMatch {
  return {
    deskId: row.id,
    dealerName: (row.dealerName || "").trim(),
    city: row.city?.trim() || null,
    state: row.state?.trim().toUpperCase() || null,
    zip: row.zipCode?.trim() || null,
    knownNamed,
    emailOptOut: Boolean(row.emailOptOut),
  };
}

/** A hint for the picker's search box, from the site name only — never used to bind. */
export function suggestedQueryFromHost(registrable: string): string | null {
  const label = registrable.split(".")[0] || "";
  return label.length >= 4 ? label : null;
}

function dedupe(rows: DeskContact[]): DeskContact[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/**
 * Resolve a pasted link to a desk. `knownNamedOf` says whether a contact row
 * carries a real person at a personal mailbox (see quotePackage's
 * deskFromDealership); this module doesn't judge emails itself.
 */
export function resolveDeskFromVdpUrl(
  url: string,
  contacts: DeskContact[],
  knownNamedOf: (row: DeskContact) => boolean = () => false
): DeskResolution {
  const norm = normalizeDealerHost(url);
  if (!norm) return { status: "invalid" };
  const index = indexDeskContacts(contacts);
  const tiers: Array<[DeskMatchVia, DeskContact[] | undefined]> = [
    ["alias_host", index.byAliasHost.get(norm.host)],
    ["website", index.byWebsiteDomain.get(norm.registrable)],
    ["alias_domain", index.byAliasDomain.get(norm.registrable)],
    ["email_domain", index.byEmailDomain.get(norm.registrable)],
  ];
  for (const [via, rows] of tiers) {
    if (!rows || rows.length === 0) continue;
    const unique = dedupe(rows);
    if (unique.length === 1) {
      return { status: "unique", via, host: norm.host, desk: deskMatchFromContact(unique[0], knownNamedOf(unique[0])) };
    }
    return {
      status: "ambiguous",
      host: norm.host,
      candidates: unique.map((r) => deskMatchFromContact(r, knownNamedOf(r))),
    };
  }
  return { status: "none", host: norm.host, suggestedQuery: suggestedQueryFromHost(norm.registrable) };
}
