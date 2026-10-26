// Paid-only /search factory-options list (flag OPTIONS_PAID_ONLY, applied by deals_api_server.js only when the flag is on).
//
// A catalog row stays only if it has a paid sticker price (the rebuild's min_price/max_price, counted per row where price > 0) AND its label is not
// a dealer/port accessory or a subscription. The price test alone is not enough: accessories and SiriusXM can carry a price on the stored row.
// Runs on the raw facet rows, before buyerOptionCatalog's cap, so dropped rows never use up a slot. Pure: no database, no env.

import { positivePrice } from "./inventoryOptionRows.js";

const words = (label) => String(label ?? "").replace(/&/g, " and ").replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

const ACCESSORY_NOUN = [
  "cargo (?:tray|net|mat|cover|liner|organizer|package|pkg)",
  "(?:carpeted?|all weather|rubber|premium carpet)?\\s*floor (?:mats?|liners?)",
  "(?:all season )?fitted liners?",
  "(?:(?:front|rear|front and rear) )?mud ?guards?",
  "splash guards?",
  "(?:black )?(?:lug nuts?|wheel locks?)(?: and (?:black )?wheel locks?)?",
  "(?:first aid|roadside assistance|emergency) kit",
  "(?:illuminated )?door sill (?:plates?|protectors?)",
  "door edge (?:guards?|protectors?)",
  "paint protection film",
  "(?:rear )?bumper (?:applique|guard|protector|step plate)",
  "license plate (?:frame|bracket)s?",
  "(?:trailer|tow) hitch(?: receiver)?",
  "(?:bike|ski|kayak) (?:carrier|rack)",
];
const ACCESSORY = new RegExp(`^(?:(?:genuine|dealer|port|installed)\\s+)*(?:${ACCESSORY_NOUN.join("|")})(?:\\s+(?:set|kit|pair|installed))*$`);
const SUBSCRIPTION = /\b(?:sirius ?xm|subscriptions?|trials?|blue ?link|connected (?:care|services))\b/;

/** True for a label that is never a paid factory sticker option: a dealer/port accessory or a subscription. */
export function isAccessoryOrSubscription(label) {
  const w = words(label);
  return ACCESSORY.test(w) || SUBSCRIPTION.test(w);
}

/** Raw facet rows ({ canonical_key, label, vehicleCount, min_price, max_price }) -> only the paid factory sticker options. */
export function paidCatalogRows(rows) {
  return rows.filter((r) => positivePrice(r.min_price) != null && positivePrice(r.max_price) != null && !isAccessoryOrSubscription(r.label));
}
