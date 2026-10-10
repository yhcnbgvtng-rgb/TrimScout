import { listDealerships, type Dealership } from "./dealershipsApi";
import { normalizeDealerKey } from "./dealerName";
import { hasContactOnFile, pickDirectoryMatch } from "./dealerContactLookup";

const TTL_MS = 10 * 60 * 1000;

/** Directory rows grouped by normalized dealership name — the same key Step 3's desk lookup matches on. */
export type ContactIndex = Map<string, Dealership[]>;

export function buildContactIndex(dealers: Dealership[]): ContactIndex {
  const out: ContactIndex = new Map();
  for (const d of dealers) {
    const key = normalizeDealerKey(d.dealerName || "");
    if (!key) continue;
    const list = out.get(key);
    if (list) list.push(d);
    else out.set(key, [d]);
  }
  return out;
}

/**
 * true / false when the directory answered; null when it is unknown (no dealer name, or the directory is down).
 * Resolves the dealership exactly as Step 3 does (name + state, shared tie-break) and applies the shared
 * contact-on-file rule, so the Contact column cannot say "Yes" where the quote request would find no one.
 */
export function contactStatus(index: ContactIndex | null, dealer: { dealerName?: string | null; dealerState?: string | null }): boolean | null {
  const key = normalizeDealerKey(dealer.dealerName || "");
  if (!index || !key) return null;
  return hasContactOnFile(pickDirectoryMatch(index.get(key) || [], dealer.dealerState));
}

let cache: { at: number; ids: ContactIndex } | null = null;
let inFlight: Promise<ContactIndex | null> | null = null;

export async function loadContactIndex(now: number = Date.now()): Promise<ContactIndex | null> {
  if (cache && now - cache.at < TTL_MS) return cache.ids;
  if (!inFlight) {
    inFlight = listDealerships()
      .then((rows) => { cache = { at: Date.now(), ids: buildContactIndex(rows) }; return cache.ids; })
      .catch(() => cache?.ids ?? null) // a stale index beats none; no index at all = unknown
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}
