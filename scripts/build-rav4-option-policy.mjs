// Builds scrapers/lightsail-crawler/src/optionPolicies/toyota-rav4-2026.json from the configurator export in
// docs/rav4-2026/rav4_2026_options_by_trim.csv. Run: node scripts/build-rav4-option-policy.mjs [--check]
//
// The CSV supplies WHAT is a paid factory option on each trim (name, price, category) and the Accessory list (dealer/port).
// This file supplies the dealer-spelling aliases and the feature lines that roll up to a package (rule 4) — those cannot be
// read off a configurator. --check exits 1 when the committed JSON differs from what this would write (the test runs it).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOptionKey } from "../scrapers/lightsail-crawler/src/inventoryOptionRows.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV = path.join(root, "docs/rav4-2026/rav4_2026_options_by_trim.csv");
const OUT = path.join(root, "scrapers/lightsail-crawler/src/optionPolicies/toyota-rav4-2026.json");

function parseCsv(text) {
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

// Aliases per canonical key (normalizeOptionKey output). Never generic: "premium audio" alone is NOT JBL, "4wd"/"4x4" are NOT AWD.
const ALIASES = {
  "all wheel drive": ["awd", "all wheel drive awd", "electronic on demand awd", "electronic on demand all wheel drive"],
  "convenience package": ["convenience pkg"],
  "weather package": ["weather pkg"],
  "moonroof package": ["moonroof pkg"],
  "panoramic moonroof package": ["panoramic moonroof pkg"],
  "xle driver assist package": ["xle driver assist pkg", "driver assist package", "driver assist pkg"],
  "xse driver assist package": ["xse driver assist pkg", "driver assist package", "driver assist pkg"],
  "jbl premium audio package": ["jbl premium audio", "jbl premium audio system", "jbl premium audio pkg"],
  "20 in wheel package": ["20 inch wheel package", "20 in wheels package", "20 inch wheels package", "20 in wheel pkg"],
  "10 in color head up display hud": ["head up display", "heads up display", "head up display hud", "10 in head up display", "10 in color head up display", "color head up display"],
  "wind chill pearl": [],
  "ruby flare pearl": [],
};
const TWO_TONE = /^(.*) with midnight black metallic roof$/;
const twoToneAliases = (key) => { const m = key.match(TWO_TONE); if (!m) return []; const b = m[1]; return [`${b} w midnight black metallic roof`, `${b} with midnight black roof`, `${b} w midnight black roof`, `${b} with black roof`, `${b} two tone`, `${b} two tone midnight black roof`]; };

// Feature lines (normalized-key regexes, each anchored) that name a package's CONTENTS and nothing else. A hit rolls up to the
// package ONLY on a trim that offers it. Standard-equipment lines (lane departure alert, lane tracing assist, auto-dimming mirror,
// parking sensors, generic "premium audio") are deliberately absent.
const FEATURES = {
  "convenience package": [
    "^(height adjustable )?(hands free )?(power|electric) (liftgate|rear door|tailgate|hatch|back door)( with jam protection)?$",
  ],
  "weather package": [
    "^heated (leather )?steering wheel$",
    "^rain sensing (variable intermittent )?(windshield )?wipers( with (windshield wiper )?de icer( function)?)?$",
    "^(windshield )?wiper de icer( function)?$",
  ],
  "moonroof package": [
    "^(power )?(tilt (and )?slide )?(moonroof|sunroof)( with one touch (open close|operation))?$",
    "^power tilt slide (moonroof|sunroof)( with one touch (open close|operation))?$",
  ],
  "panoramic moonroof package": [
    "^panoramic (glass roof|moonroof|sunroof|roof)( with front (power )?tilt slide (moonroof|sunroof))?$",
    "^digital (rear ?view )?mirror( with homelink( garage door opener)?)?$",
    "^digital rearview mirror w homelink garage door opener$",
  ],
  "xle driver assist package": [
    "^front cross traffic alert( fcta)?$", "^lane change assist( lca)?$", "^traffic jam assist( tja)?$", "^driver (attention )?monitor(ing system)?$",
  ],
  "xse driver assist package": [
    "^(toyota )?advanced park$", "^(toggle( switch)? )?shift by wire shifter$",
  ],
  "jbl premium audio package": ["^jbl\\b.{0,70}$"],
  "20 in wheel package": [
    "^20 (in|inch)( alloy| aluminum)? wheels?( with 235 50r20( all season tires)?)?$",
    "^larger 165 90d18 spare tire wheel combo$", "^165 90d18 spare( tire)?$",
  ],
};

// Dealer/port-installed products that are NOT in the configurator's Accessory list under the same name. Anchored on the product
// words; the Accessory list itself is matched by exact key as well.
const DEALER_ADDON_PATTERNS = [
  "\\bnitrogen\\b", "\\bvin\\s*etch", "\\bappearance (package|pkg|protection)\\b", "\\bpaint (protection|sealant)\\b", "\\bfabric (protection|guard)\\b",
  "\\bundercoat", "\\brust\\s*proof", "\\bwindow tint", "\\bpin\\s*stripe", "\\btow(ing)? hitch\\b", "\\btrailer hitch\\b", "\\bmud\\s*guards?\\b", "\\bsplash guards?\\b",
  "\\bprotection (plus )?(package|pkg)\\b", "\\bwheel locks?\\b", "\\b(floor|carpet|cargo) (mats?|liners?)\\b", "\\ball weather (floor )?(mats?|liners?)\\b",
  "\\bdoor (edge|sill)\\b", "\\bbody side moldings?\\b", "\\billuminat(ed|ion)\\b", "\\broof (rack|cargo basket)\\b", "\\bcross ?bars?\\b", "\\bkey glove\\b",
  "\\bscreen protector\\b", "\\bcargo (net|tote)\\b", "\\bhood graphics\\b", "\\bblackout emblem\\b", "\\bgraphics (package|pkg)\\b", "\\bdealer (installed|added|accessor)",
  "\\bport (installed|accessor)", "\\baccessor(y|ies)\\b", "\\bsplash\\b.*\\bguards?\\b", "\\bgap (insurance|coverage)\\b", "\\bpreferred accessory\\b",
];

const rows = parseCsv(fs.readFileSync(CSV, "utf8"));
const paid = (r) => Number(r.price_usd) > 0;
const trimOrder = [...new Set(rows.map((r) => r.trim))];
const trims = {};
const accessoryKeys = new Set();
for (const t of trimOrder) trims[normalizeOptionKey(t)] = { label: t, options: {} };

for (const r of rows) {
  const tk = normalizeOptionKey(r.trim);
  if (r.category === "Accessory (dealer/port)") { const k = normalizeOptionKey(r.item); if (k) accessoryKeys.add(k); continue; }
  let kind = null;
  if (r.category === "Factory package") kind = "package";
  else if (r.category === "Factory option") kind = "option";
  else if (r.category === "Drivetrain" && paid(r)) kind = "option"; // AWD only where it costs extra; $0 = standard = not an option (rule 2)
  else if (r.category === "Exterior color" && paid(r)) kind = "paint";  // no-cost paint = not an option (rule 2)
  if (!kind) continue; // Base, Interior, standard drivetrain
  const label = r.item.replace(/®/g, "").replace(/\s+/g, " ").trim();
  const key = normalizeOptionKey(label);
  trims[tk].options[key] = {
    label, kind, price: Number(r.price_usd),
    aliases: [...new Set([...(ALIASES[key] || []), ...twoToneAliases(key)].map(normalizeOptionKey))].filter((a) => a && a !== key),
    ...(FEATURES[key] ? { features: FEATURES[key] } : {}),
  };
}

const policy = {
  "toyota|rav4|2026": {
    source: "docs/rav4-2026/rav4_2026_options_by_trim.csv (toyota.com configurator, 2026 RAV4 hybrid)",
    models: ["rav4", "rav4 hybrid"],
    keepBare: ["siri", "google", "unlock", "alexa built in"],
    trims,
    dealerAddons: { keys: [...accessoryKeys].sort(), patterns: DEALER_ADDON_PATTERNS },
  },
};
const text = `${JSON.stringify(policy, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur !== text) { console.error("toyota-rav4-2026.json is out of date: run node scripts/build-rav4-option-policy.mjs"); process.exit(1); }
  console.log("policy JSON is current");
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(root, OUT)}: ${Object.entries(trims).map(([k, v]) => `${v.label}=${Object.keys(v.options).length}`).join(", ")}; ${accessoryKeys.size} accessory keys`);
}
