import { listDealerships, type Dealership } from "./dealershipsApi";
import { contactStateOf, dealerIdFrom, isReachableState, dealerMatchKey, pickDirectoryMatch, type ContactState } from "./dealerContactLookup";

const TTL_MS = 10 * 60 * 1000;

/** Directory rows grouped by normalized dealership name — the same key Step 3's desk lookup matches on. */
export type ContactIndex = Map<string, Dealership[]>;

export function buildContactIndex(dealers: Dealership[]): ContactIndex {
  const out: ContactIndex = new Map();
  for (const d of dealers) {
    const key = dealerMatchKey(d.dealerName || "");
    if (!key) continue;
    const list = out.get(key);
    if (list) list.push(d);
    else out.set(key, [d]);
  }
  return out;
}

const idMaps = new WeakMap<ContactIndex, Map<string, Dealership>>();

/** Directory rows by id, built once per index. */
function rowsById(index: ContactIndex): Map<string, Dealership> {
  let m = idMaps.get(index);
  if (!m) {
    m = new Map();
    for (const rows of index.values()) for (const r of rows) m.set(String(r.id), r);
    idMaps.set(index, m);
  }
  return m;
}

/**
 * The shared contact state ("named" | "email_only" | "unverified" | "none") for one car's dealer, or null when it is unknown (no dealer name, or
 * the directory is down). Resolves the dealership exactly as Step 3 does (dealer id first; else name + state, shared tie-break), so the
 * Contact column, the contact filter and the quote request cannot disagree. "unverified" is the buyer-facing "Unverified email".
 */
export function contactStateFor(index: ContactIndex | null, dealer: { dealerName?: string | null; dealerState?: string | null; dealerId?: string | number | null }): ContactState | null {
  // The car's own dealer_id names its directory row; name + state is only for a car with no id (or one the directory doesn't carry).
  const id = dealerIdFrom(dealer.dealerId);
  const byId = index && id ? rowsById(index).get(id) : undefined;
  if (byId) return contactStateOf(byId);
  const key = dealerMatchKey(dealer.dealerName || "");
  if (!index || !key) return null;
  return contactStateOf(pickDirectoryMatch(index.get(key) || [], dealer.dealerState));
}

/** true / false when the directory answered; null when it is unknown. "On file" means a reachable email, named or not (see hasContactOnFile). */
export function contactStatus(index: ContactIndex | null, dealer: { dealerName?: string | null; dealerState?: string | null; dealerId?: string | number | null }): boolean | null {
  const state = contactStateFor(index, dealer);
  return state == null ? null : isReachableState(state);
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
