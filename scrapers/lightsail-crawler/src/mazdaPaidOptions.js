// Mazda rules for the paid-only option rows (OPTIONS_PAID_ONLY on). Pure: no database, no env.
//
// 1. Dealer-installed accessories are not factory options. A row is dropped when the feed flags it kind:"dealer" (paid factory paint is exempt: paint is never
//    dealer-installed) or when its name is a known Mazda accessory (cargo tray / net / mat / cover / package, lug nuts and wheel locks, splash guards, sill plates...).
//    "Weather Package" is treated as a port-installed accessory bundle, so it is dropped unless the feed says kind:"factory" explicitly (see docs/OPTIONS_PAID_ONLY_CATALOG_NOTE.md).
// 2. One paint colour, one row: "X Paint", "X Paint Charge", "X Metallic" and "X Premium Paint Charge" are one option, "X Paint", with one price.
// 3. Model names come without the make: "Mazda CX-5" -> "CX-5".

import { modelPoliciesFor } from "./factoryOptionAllowlist.js";

const MAKE = /^mazda$/i;
export const isMazdaMake = (make) => MAKE.test(String(make ?? "").trim());

/** "Mazda CX-5" -> "CX-5". Any other make, and a model that is only "Mazda", comes back trimmed and otherwise unchanged. */
export function normalizeModelForWrite({ make, model } = {}) {
  const m = String(model ?? "").replace(/\s+/g, " ").trim();
  if (!isMazdaMake(make)) return m;
  const stripped = m.replace(/^mazda\s+(?=\S)/i, "");
  return stripped;
}

const words = (label) => String(label ?? "").replace(/&/g, " and ").replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

const ACCESSORY_NOUN = [
  "cargo (?:tray|net|mat|cover|package|pkg|liner|organizer|hooks?|area protector)",
  "carpet cargo mat",
  "(?:black )?lug nuts?(?: and (?:black )?wheel locks?)?",
  "(?:black )?wheel locks?",
  "splash guards?",
  "mud (?:guards?|flaps?)",
  "(?:illuminated )?door sill plates?",
  "(?:illuminated )?door sills?",
  "door edge (?:guards?|protectors?|film)",
  "door handle (?:protection )?film",
  "paint protection film",
  "(?:rear )?bumper (?:guard|protector|step plate|applique)",
  "(?:all weather|carpet|premium carpet) (?:floor )?(?:mats?|liners?)",
  "floor (?:mats?|liners?)",
  "license plate (?:frame|bracket)s?",
  "(?:trailer|tow) hitch(?: receiver)?",
  "(?:roof|cross) (?:rack|bars?)",
  "(?:bike|ski|kayak) (?:carrier|attachment|rack)",
  "first aid kit",
  "(?:car )?cover",
];
const ACCESSORY = new RegExp(`^(?:(?:mazda|genuine|dealer|port|installed)\\s+)*(?:${ACCESSORY_NOUN.join("|")})(?:\\s+(?:set|kit|pair|installed))*$`);
const WEATHER_PACKAGE = /^(?:(?:mazda|genuine)\s+)?weather (?:package|pkg)$/;

/** True for a dealer/port accessory by name (not by the feed's flag). "Weather Package" is covered by dropRow, which looks at kind. */
export const isMazdaAccessoryName = (label) => ACCESSORY.test(words(label));

const PAINT_TAIL = new Set(["paint", "charge", "metallic", "premium"]);
const PAINT_MARK = new Set(["paint", "charge", "metallic"]);

/** "Machine Gray Metallic Paint Charge" -> { key: "machine gray", label: "Machine Gray Paint" }; null when the line is not a colour charge. */
export function mazdaPaint(label) {
  const w = words(label).split(" ").filter(Boolean);
  const orig = String(label ?? "").replace(/&/g, " and ").replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).filter(Boolean);
  if (!w.length || w.length !== orig.length) return null;
  let end = w.length, marked = false;
  while (end > 0 && PAINT_TAIL.has(w[end - 1])) { if (PAINT_MARK.has(w[end - 1])) marked = true; end--; }
  if (!marked || end === 0) return null;
  const base = w.slice(0, end);
  const title = orig.slice(0, end).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(" ");
  return { key: base.join(" "), label: `${title} Paint` };
}

/**
 * Whether a Mazda option line is left out of the paid-only rows. `kind` is the feed's own flag ("dealer" / "factory" / absent).
 */
export function dropMazdaRow(label, kind) {
  const k = String(kind ?? "").trim().toLowerCase();
  const name = words(label);
  if (WEATHER_PACKAGE.test(name)) return k !== "factory";
  if (ACCESSORY.test(name)) return true;
  if (k === "dealer") return mazdaPaint(label) == null;
  return false;
}

/**
 * A Mazda car's option lines ready for the generic row builder (optionRowsFromOptions): accessories removed, every colour spelling renamed to
 * "X Paint" so the builder's one-row-per-key rule merges them and keeps the highest price. Lines it cannot judge (a joined list, no name) are kept.
 * Pure; returns a new array and leaves the entries it keeps untouched.
 */
export function prepareMazdaOptions(options) {
  if (!Array.isArray(options)) return options;
  const out = [];
  for (const o of options) {
    const name = o && typeof o.name === "string" ? o.name.trim() : "";
    if (!name || /[;|\n]/.test(name)) { out.push(o); continue; }
    if (dropMazdaRow(name, o.kind)) continue;
    const paint = mazdaPaint(name);
    out.push(paint ? { ...o, name: paint.label } : o);
  }
  return out;
}

/**
 * The sync's per-vehicle step: a Mazda vehicle's model loses the make prefix; with OPTIONS_PAID_ONLY on, a Mazda car no model policy covers also gets
 * prepareMazdaOptions (a policy-covered car already has its accessories and paint handled by the policy). Mutates and returns `v`; other makes untouched.
 */
export function prepareMazdaVehicle(v, { make, allowlist, paidOnly }) {
  if (!isMazdaMake(make)) return v;
  v.model = normalizeModelForWrite({ make, model: v.model });
  if (paidOnly && Array.isArray(v.options) && !modelPoliciesFor(allowlist, { make, model: v.model, year: v.year }).length) v.options = prepareMazdaOptions(v.options);
  return v;
}
