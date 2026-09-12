/**
 * Finding a rooftop in the contact directory from something other than a
 * clean name: a window sticker's sold-to block, or whatever the buyer types
 * when asked "which dealership?". Pure logic; the caller supplies the rows.
 *
 * Exact-key matching lives in dealerContactLookup.ts. This is the looser
 * layer beneath it, for names that arrive abbreviated ("Howell GMC" for
 * "Howell, INC."), reordered, or with a city stuck on the end.
 */

import { normalizeDealerKey } from "./dealerName";

export interface SearchableDealership {
  dealerName: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

/** Words that appear in nearly every dealer name and so say nothing about which one. */
const NOISE_TOKENS = new Set([
  "of", "the", "and", "inc", "llc", "co", "ltd", "auto", "autos", "automotive", "motors", "motor", "dealer",
  "dealership", "group", "sales", "cars", "car", "center", "centre",
  // brand words: "Howell GMC" must match "Howell, INC." (a GMC store) without
  // every other GMC store scoring the same.
  "ford", "lincoln", "chevrolet", "chevy", "chev", "gmc", "cdjr", "cjdr", "cjd", "cjdrf", "mb", "buick", "cadillac", "chrysler", "dodge", "jeep", "ram",
  "toyota", "lexus", "honda", "acura", "bmw", "mercedes", "benz", "mercedes-benz", "porsche", "genesis",
  "hyundai", "kia", "nissan", "infiniti", "subaru", "mazda", "volkswagen", "vw", "audi", "volvo",
]);

export function dealerNameTokens(name: string): string[] {
  return normalizeDealerKey(name || "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
}

export interface DealerSearchHit<T> {
  row: T;
  /** 0–1: how much of what was typed the row's name accounts for. */
  score: number;
}

/**
 * Best directory rows for a typed dealer name. Exact normalized-key matches
 * rank first; then rows sharing distinctive words with the query, with a
 * bonus for being in the expected state or city. Returns nothing rather
 * than a wild guess when no distinctive word matches at all.
 */
export function searchDirectoryDealerships<T extends SearchableDealership>(
  rows: T[],
  query: string,
  opts: { state?: string | null; city?: string | null; limit?: number } = {}
): DealerSearchHit<T>[] {
  const q = (query || "").trim();
  if (!q) return [];
  const limit = opts.limit ?? 6;
  const wantedState = (opts.state || "").trim().toUpperCase();
  const wantedCity = normalizeDealerKey(opts.city || "");
  const key = normalizeDealerKey(q);
  const tokens = dealerNameTokens(q);
  // The buyer may type the city after the name ("Howell GMC Summit MS").
  const cityTokens = new Set(rows.flatMap((r) => (r.city ? dealerNameTokens(r.city) : [])));

  const hits: DealerSearchHit<T>[] = [];
  for (const row of rows) {
    const rowKey = normalizeDealerKey(row.dealerName || "");
    if (!rowKey) continue;
    const rowState = (row.state || "").trim().toUpperCase();
    const rowCity = normalizeDealerKey(row.city || "");
    let score = 0;
    if (rowKey === key) {
      score = 1;
    } else if (tokens.length > 0) {
      const rowTokens = new Set(dealerNameTokens(row.dealerName));
      const distinctive = tokens.filter((t) => !cityTokens.has(t) || rowTokens.has(t));
      if (distinctive.length === 0) continue;
      const matched = distinctive.filter((t) => rowTokens.has(t)).length;
      if (matched === 0) continue;
      score = (matched / distinctive.length) * 0.8;
      // A typed city that matches the row's city is as good as another word.
      if (rowCity && tokens.some((t) => dealerNameTokens(rowCity).includes(t))) score += 0.1;
    } else {
      continue;
    }
    if (wantedState && rowState === wantedState) score += 0.08;
    else if (wantedState && rowState && rowState !== wantedState) score -= 0.15;
    if (wantedCity && rowCity === wantedCity) score += 0.08;
    hits.push({ row, score: Math.max(0, Math.min(1, score)) });
  }
  hits.sort((a, b) => b.score - a.score || a.row.dealerName.localeCompare(b.row.dealerName));
  return hits.filter((h) => h.score >= 0.3).slice(0, limit);
}

export interface StickerSoldTo {
  name?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/**
 * The directory row for a window sticker's sold-to dealer, or null. Exact
 * name+state first; failing that, the single search hit that is clearly
 * ahead of the rest and in the sticker's state. A sticker names the store
 * the factory shipped to, so the bar is high — the wrong rooftop here
 * would get a quote request for a car it never had.
 */
export function crossReferenceStickerDealer<T extends SearchableDealership>(
  rows: T[],
  soldTo: StickerSoldTo | null | undefined
): T | null {
  const name = (soldTo?.name || "").trim();
  if (!name) return null;
  const wantedState = (soldTo?.state || "").trim().toUpperCase();
  const inState = (row: T) => !wantedState || (row.state || "").trim().toUpperCase() === wantedState;

  // Exact name, but unlike the contact lookup, a state on the sticker is a
  // requirement here, not a tie-breaker: "Howell" in TX is not Howell in MS.
  const key = normalizeDealerKey(name);
  const exact = rows.filter((r) => normalizeDealerKey(r.dealerName || "") === key && inState(r));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const city = normalizeDealerKey(soldTo?.city || "");
    const sameCity = exact.filter((r) => city && normalizeDealerKey(r.city || "") === city);
    return sameCity.length === 1 ? sameCity[0] : null;
  }

  const hits = searchDirectoryDealerships(rows, name, { state: soldTo?.state, city: soldTo?.city, limit: 3 });
  if (hits.length === 0) return null;
  const [best, next] = hits;
  if (!inState(best.row) || best.score < 0.7) return null;
  if (next && next.score >= best.score - 0.1) return null;
  return best.row;
}
