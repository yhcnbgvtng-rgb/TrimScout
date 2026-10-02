// Per-make allowlist of REAL factory options, and the two places it plugs in: write-time key
// normalization (optionRowsFromOptions) and buyer-catalog gating (buyerOptionCatalog).
//
// Why write time and not just the catalog: /search's optionKeys= filter (inventoryListQuery.js)
// matches dealer_inventory_options.canonical_key exactly. If three dealer spellings of one real
// option ("Sky One-Touch Power Top", "SKY ONE TOUCH POWER TOP", "Sky 1-Touch Pwr Top") were only
// merged in the catalog, a buyer picking the merged entry would match just one spelling's vehicles.
// Mapping every alias to the allowlisted key as rows are written means one key, all the vehicles.
//
// Ships EMPTY. With no allowlist loaded, every function here is a pass-through and behavior is
// exactly what it was before this module existed. Phase B fills it from ground truth: window
// stickers (the sticker pipelines already canonicalize those into lib/factoryOptionCatalog.ts's
// entry shape — see allowlistFromCatalogEntries) and OEM brochures/order guides. Dealer free text
// never adds an entry on its own; it can only be matched TO one.
//
// Shape (JSON-serializable, one object per make, lowercased make name):
//   { "jeep": { "sky one touch power top": { "label": "Sky One-Touch Power Top",
//                                           "aliases": ["sky 1 touch pwr top"] } } }
// Keys and aliases are normalizeOptionKey() output, never raw text.

import fs from "node:fs";
import { normalizeOptionKey } from "./inventoryOptionRows.js";

export const EMPTY_ALLOWLIST = Object.freeze({ makes: new Map() });

/** Raw JSON object -> lookup structure (key and alias -> canonical key, per make). */
export function buildAllowlist(raw) {
  const makes = new Map();
  if (!raw || typeof raw !== "object") return { makes };
  for (const [makeName, options] of Object.entries(raw)) {
    if (!options || typeof options !== "object") continue;
    const entries = new Map();
    const index = new Map();
    for (const [rawKey, entry] of Object.entries(options)) {
      const key = normalizeOptionKey(rawKey);
      if (!key) continue;
      const label = entry && typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : rawKey;
      entries.set(key, { key, label });
      index.set(key, key);
      for (const alias of (entry && Array.isArray(entry.aliases) ? entry.aliases : [])) {
        const a = normalizeOptionKey(alias);
        // First mapping wins: an alias listed under two options is ambiguous, so it keeps
        // whichever claimed it first rather than flipping between them on reload.
        if (a && !index.has(a)) index.set(a, key);
      }
    }
    if (entries.size) makes.set(String(makeName).trim().toLowerCase(), { entries, index });
  }
  return { makes };
}

/**
 * Sticker-pipeline catalog entries (lib/factoryOptionCatalog.ts: { canonicalName, aliases, makes })
 * -> the raw allowlist JSON shape. The bridge from Monroney ground truth to this allowlist.
 */
export function allowlistFromCatalogEntries(entries) {
  const out = {};
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.canonicalName !== "string") continue;
    const key = normalizeOptionKey(e.canonicalName);
    if (!key) continue;
    const aliases = [...new Set((e.aliases || []).map(normalizeOptionKey).filter((a) => a && a !== key))];
    for (const make of e.makes || []) {
      const m = String(make).trim().toLowerCase();
      if (!m) continue;
      out[m] ??= {};
      const prev = out[m][key];
      out[m][key] = { label: prev?.label || e.canonicalName, aliases: [...new Set([...(prev?.aliases || []), ...aliases])] };
    }
  }
  return out;
}

/** Whether this make has any allowlist at all (allowlist mode only gates makes that do). */
export function hasAllowlistFor(allowlist, make) {
  return Boolean(make && allowlist?.makes?.has(String(make).trim().toLowerCase()));
}

/**
 * The allowlisted canonical { key, label } a normalized key resolves to for this make, or null.
 * `null` is honest-empty: not a real factory option we can vouch for, never a guess.
 */
export function resolveAllowlisted(allowlist, make, key) {
  if (!make || !key) return null;
  const m = allowlist?.makes?.get(String(make).trim().toLowerCase());
  if (!m) return null;
  const canonical = m.index.get(key);
  return canonical ? m.entries.get(canonical) : null;
}

/** OPTION_CATALOG_MODE: "heuristic" (default — junk rules + volume floor) or "allowlist". */
export function catalogModeFromEnv(env = process.env) {
  return String(env.OPTION_CATALOG_MODE || "").trim().toLowerCase() === "allowlist" ? "allowlist" : "heuristic";
}

/**
 * Loads OPTION_ALLOWLIST_PATH (a JSON file in the raw shape above). Unset, missing or unreadable
 * -> EMPTY_ALLOWLIST plus the reason, so a bad deploy degrades to today's behavior instead of
 * failing the server at boot.
 */
export function loadAllowlistFromEnv(env = process.env) {
  const path = String(env.OPTION_ALLOWLIST_PATH || "").trim();
  if (!path) return { allowlist: EMPTY_ALLOWLIST, error: null };
  try {
    return { allowlist: buildAllowlist(JSON.parse(fs.readFileSync(path, "utf8"))), error: null };
  } catch (err) {
    return { allowlist: EMPTY_ALLOWLIST, error: `${path}: ${err.message}` };
  }
}
