// Shared by the per-model option-policy generators (scripts/build-*-option-policy.mjs).
import { normalizeOptionKey } from "../../scrapers/lightsail-crawler/src/inventoryOptionRows.js";
export { normalizeOptionKey };

export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// Dealer/port-installed products that are NOT in the configurator's Accessory list under the same name. WHOLE PRODUCT NAMES ONLY:
// each phrase must be the entire line (price / parenthetical decoration already stripped) apart from a few harmless words around it
// ("Toyota", "set", "package"...). A product word buried in a longer sentence ("Does not include optional accessories of $799
// Lifetime Oil", "Protection Package - Chrome Body Side feature…") never matches. The Accessory list itself is matched by exact key.
export const PRODUCT_PHRASES = [
  "perma\\s*plate(?:\\s+(?:paint|fabric|interior|protection|sealant|plan|program))*",
  "(?:lifetime\\s+)?oil(?:\\s+change)?\\s+(?:package|pkg|plan|program)", "lifetime\\s+oil(?:\\s+change)?(?:\\s+(?:package|pkg|plan|program))?",
  "nitrogen(?:\\s+(?:filled|fill|inflated|inflation|tires?|tyres?))*",
  "vin\\s*etch(?:ing)?(?:\\s+(?:protection|theft deterrent))?",
  "protection\\s+(?:plus\\s+)?(?:package|pkg)(?:\\s+(?:black\\s+)?chrome(?:\\s+body\\s+side)?)?", "appearance\\s+(?:package|pkg|protection)", "paint\\s+(?:protection|sealant)", "fabric\\s+(?:protection|guard)", "undercoat(?:ing)?", "rust\\s*proof(?:ing)?",
  "window\\s+tint(?:ing)?", "pin\\s*stripe[sd]?(?:ing)?", "wheel\\s+locks?", "gap\\s+(?:insurance|coverage)",
  "mud\\s*guards?", "splash\\s+guards?", "(?:(?:floor|carpet|cargo)\\s+)+mats?(?:\\s*/\\s*(?:(?:floor|carpet|cargo)\\s+)*mats?)?", "(?:floor|cargo)\\s+liners?", "all\\s+weather\\s+(?:floor\\s+)?(?:mats?|liners?)(?:\\s+(?:and|&)\\s+cargo\\s+(?:tray|liner|mat))?",
  "door\\s+(?:edge|sill)\\s+(?:guards?|protectors?)", "body\\s+side\\s+mold(?:ing|ings)", "roof\\s+(?:rack|cross\\s*bars?)", "(?:low\\s+profile\\s+)?cross\\s*bars?", "key\\s+glove",
  "multimedia\\s+(?:glass\\s+)?screen\\s+protector", "cargo\\s+(?:net|tote)", "hood\\s+graphics", "blackout\\s+emblem\\s+overlays?", "tow(?:ing)?\\s+hitch(?:\\s+receiver)?", "trailer\\s+hitch",
];
export const AROUND = "(?:toyota|tms|genuine|dealer|port|installed)";
export const DEALER_ADDON_PATTERNS = PRODUCT_PHRASES.map((p) => `^(?:${AROUND}\\s+)*(?:${p})(?:\\s+(?:set|kit|package|pkg|pair|installed|tms|toyota))*$`);
// Lines that are disclaimers about price / what is included, not options or products: dropped outright, before anything else is tried.
export const DISCLAIMER_PATTERNS = ["^(?:does not|doesn t|do not|don t) include\\b", "^(?:prices?|msrp) excludes?\\b", "^excludes?\\b", "^not including\\b", "^plus\\b"];

