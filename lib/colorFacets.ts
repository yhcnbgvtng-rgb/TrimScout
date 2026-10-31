/**
 * Clean colour filter values. The box stores each dealer's raw colour text, so the Exterior / Interior lists are full of paint codes
 * ("0300 Alpine White", "BK"), junk ("XDRIVE", "2007 Bmw 3 Series 328Xi") and near-duplicates ("Alpine Whi"). The server shows one
 * title-cased value per real colour and remembers which raw values sit behind it, so choosing the clean value still finds every car.
 */
import { isColorCode } from "./colorCode";

const JUNK_WORDS = new Set(["xdrive", "sdrive", "awd", "fwd", "rwd", "4wd", "none", "n/a", "na", "null", "undefined", "unknown", "other", "tbd", "see dealer", "call", "multi", "various"]);
const SMALL = new Set(["and", "of", "the", "with", "w/"]);

function titleCase(s: string): string {
  return s.toLowerCase().split(" ").map((w, i) => {
    if (i > 0 && SMALL.has(w)) return w;
    return w.replace(/(^|[-/(])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  }).join(" ");
}

/** The clean colour name for one raw value, or null when the value is not a usable colour. */
export function cleanColorName(raw: string | null | undefined): string | null {
  let s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  s = s.replace(/\([^)]*\)/g, " ");                       // "(P0WT)" / "Alpine White (300)"
  s = s.replace(/^(?:[0-9A-Za-z]{0,3}[0-9][0-9A-Za-z]{0,5})\s+(?=[A-Za-z])/, ""); // leading code token: "0300 Alpine White", "WA8555 Glacier"
  s = s.replace(/\s+[-–]?\s*(?:[0-9][0-9A-Za-z]{2,5})$/, "");  // trailing code token: "Glacier 8555"
  s = s.replace(/\s+/g, " ").replace(/^[\s\-–,/]+|[\s\-–,/]+$/g, "");
  if (!s || isColorCode(s) || JUNK_WORDS.has(s.toLowerCase())) return null;
  if (/^(19|20)\d{2}\b/.test(s)) return null;               // a vehicle description, not a colour ("2007 Bmw 3 Series 328Xi")
  if (!/[A-Za-z]{3}/.test(s) || /\d/.test(s.replace(/\b(?:ii|iii)\b/gi, ""))) return null; // still carries digits: not a plain name
  if (s.length > 40) return null;
  return titleCase(s);
}

/** Does `short` look like `long` cut off mid-word ("Alpine Whi" / "Alpine White")? Single-word names are never merged this way ("Red" vs "Redline"). */
function isTruncationOf(short: string, long: string): boolean {
  const a = short.split(" "), b = long.split(" ");
  if (a.length < 2 || a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i++) if (a[i] !== b[i]) return false;
  const last = a[a.length - 1], full = b[b.length - 1];
  return last.length >= 3 && last.length < full.length && full.startsWith(last);
}

export interface ColorFacets {
  /** Clean values, alphabetical. */
  values: string[];
  /** Clean value -> every raw value (as stored) that it stands for. */
  rawsByValue: Map<string, string[]>;
}

export function normalizeColorFacets(raws: readonly string[]): ColorFacets {
  const groups = new Map<string, string[]>();
  for (const raw of raws) {
    const clean = cleanColorName(raw);
    if (!clean) continue;
    const list = groups.get(clean);
    if (list) list.push(raw);
    else groups.set(clean, [raw]);
  }
  // Fold truncated names into the full name they were cut from.
  const names = [...groups.keys()];
  for (const short of names) {
    const full = names.find((n) => n !== short && groups.has(n) && isTruncationOf(short.toLowerCase(), n.toLowerCase()));
    if (full && groups.has(short)) { groups.get(full)!.push(...groups.get(short)!); groups.delete(short); }
  }
  return { values: [...groups.keys()].sort((a, b) => a.localeCompare(b)), rawsByValue: groups };
}

/** The raw values a chosen clean value stands for; the value itself when it is not a known clean value (an old link, a raw string). */
export function rawsForColor(facets: ColorFacets | null, chosen: string): string[] {
  const hit = facets?.rawsByValue.get(chosen);
  if (hit && hit.length) return [...new Set(hit)];
  const key = chosen.toLowerCase();
  if (facets) for (const [clean, raws] of facets.rawsByValue) if (clean.toLowerCase() === key) return [...new Set(raws)];
  return [chosen];
}
