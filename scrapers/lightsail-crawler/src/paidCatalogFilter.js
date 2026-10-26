// Paid-only /search factory-options list (flag OPTIONS_PAID_ONLY, applied by deals_api_server.js only when the flag is on).
//
// A catalog row stays only if it has a paid sticker price (the rebuild's min_price/max_price, counted per row where price > 0) AND its label is not
// a dealer/port accessory or a subscription. The price test alone is not enough: accessories and SiriusXM can carry a price on the stored row.
// Runs on the raw facet rows, before buyerOptionCatalog's cap, so dropped rows never use up a slot. Pure: no database, no env.

import { positivePrice } from "./inventoryOptionRows.js";

const words = (label) => String(label ?? "").replace(/&/g, " and ").replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

const ACCESSORY_NOUN = [
  "cargo (?:tray|net|mat|cover|liner|organizer|package|pkg|blocks?)",
  "reversible cargo tray",
  "(?:(?:front|rear|front and rear) )?mud ?guards?",
  "splash guards?",
  "(?:(?:black|alloy) )*(?:lug nuts?|wheel locks?)(?: and (?:black )?wheel locks?)?",
  "(?:first aid|roadside assistance|emergency) kit",
  "(?:illuminated )?door sills?(?: plates?| protectors?)?",
  "door edge (?:guards?|protectors?)",
  "paint protection film",
  "(?:front |rear )?bumper (?:applique|guard|protector|step plate)",
  "(?:front |rear )?license plate (?:frame|bracket)s?",
  "(?:trailer|tow) hitch(?: receiver)?",
  "ball mount kit",
  "(?:bike|ski|kayak) (?:carrier|rack)",
  "(?:roof (?:rack )?)?(?:cross (?:rails?|bars?)|rails?)",
  "(?:chrome |running board )?(?:side|assist) steps?",
  "tonneau cover",
  "(?:quick |fast )?charge cable",
  "(?:severe weather|winter) (?:kit|package)",
  "body side moldings?",
  "blackout emblem overlays?",
  "(?:front |rear )?(?:black )?bowtie emblems?",
  "fog light accent",
  "spare tire lock",
  "(?:spray on )?(?:pickup )?(?:box )?bed ?liners?",
  "liner protection package",
];
const ACCESSORY = new RegExp(`^(?:(?:genuine|dealer|port|installed)\\s+)*(?:${ACCESSORY_NOUN.join("|")})(?:\\s+(?:set|kit|pair|installed))*$`);
// Mats and liners in any spelling, alone or as a package: every word is one of these and at least one is a mat/liner word.
const MAT_WORDS = new Set("all weather season carpet carpeted carpeting floor cargo tray and with w rubber rubberized vinyl color keyed premium fitted black front rear set package pkg mat mats floormat floormats liner liners".split(" "));
const MAT_CORE = /^(?:mats?|floormats?|liners?)$/;
const isMatOrLiner = (w) => { const t = w.split(" "); return t.every((x) => MAT_WORDS.has(x)) && t.some((x) => MAT_CORE.test(x)); };
const SUBSCRIPTION = /\b(?:sirius ?xm|subscriptions?|trials?|blue ?link|connected (?:care|services))\b/;
// Real factory options: checked before the accessory list, so no accessory pattern can ever drop one of these.
const PROTECTED = [
  /^(?:xle grade )?weather package$/,
  /\b(?:convenience|premium|extra value)(?: ii)? package\b/,
  /\btrailering\b/, /\bz71\b/, /\ball star edition\b/, /\bremote start\b/, /\bdifferential\b/,
  /^engine\b/, /^(?:wheels|tires)\b/, /\bleather\b/, /^engine block heater$/,
];

/** True for a label that is never a paid factory sticker option: a dealer/port accessory or a subscription. */
export function isAccessoryOrSubscription(label) {
  const w = words(label);
  if (SUBSCRIPTION.test(w)) return true;
  if (PROTECTED.some((re) => re.test(w))) return false;
  return ACCESSORY.test(w) || isMatOrLiner(w);
}

/** Raw facet rows ({ canonical_key, label, vehicleCount, min_price, max_price }) -> only the paid factory sticker options. */
export function paidCatalogRows(rows) {
  return rows.filter((r) => positivePrice(r.min_price) != null && positivePrice(r.max_price) != null && !isAccessoryOrSubscription(r.label));
}
