// Strategy 3b: Facebook Pixel "ViewContent" event fallback.
//
// Some dealer platforms publish NO Vehicle/Product schema.org markup at
// all — only AutoDealer/Organization types for local-SEO — so
// extractSchemaOrgVehicle (Strategy 2) always returns null for them, and
// standalone.js's own last-resort structured-field scan (Strategy 3) only
// recovers VIN/price/year (it deliberately never guesses model from
// freeform page text). Confirmed live 2026-09-23 on Paul Miller Toyota
// and Right Toyota (a SecureOffer/eLEAD-style ASP.NET DMS used by many
// independent dealer groups, URL pattern /viewdetails/<cond>/<vin>/...):
// a production audit found 532 dealers / ~77,000 active vehicles with
// this exact "VIN+price only, everything else null" shape.
//
// The real model/color/transmission/body-style data those pages are
// missing from schema.org is sitting inline in their own Facebook Pixel
// tracking call instead — every VDP on this platform fires
// `fbq('track', 'ViewContent', {content_type: 'vehicle', make, model,
// exterior_color, transmission, body_style, price, ...})` with real,
// specific per-vehicle values (confirmed against real VDP HTML, not
// inferred). This is a genuine third-party analytics call already
// present on the page — not a bot-protection workaround.
//
// Deliberately does NOT read drivetrain/fuel_type — the vehicle record
// this file assembles (and the dealer_inventory DB schema it lands in)
// has no columns for either, and this module's job is filling real gaps
// in existing fields, not inventing new ones.
function cleanString(val) {
  if (typeof val !== 'string') return null;
  const str = val.trim();
  return str === '' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined' ? null : str;
}

// Real JS object-literal syntax (unquoted keys, single-quoted strings),
// not JSON — reconstructed into parseable JSON rather than eval'd, so a
// malformed or unexpected call on some other platform just fails to
// parse (returns null) instead of executing arbitrary page script.
function parseViewContentCall(html) {
  const match = html.match(/fbq\(\s*['"]track['"]\s*,\s*['"]ViewContent['"]\s*,\s*(\{[\s\S]*?\})\s*\)/);
  if (!match) return null;
  try {
    const jsonish = match[1]
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, '$1');
    const obj = JSON.parse(jsonish);
    return obj && obj.content_type === 'vehicle' ? obj : null;
  } catch {
    return null;
  }
}

// Fills only currently-null fields on an already-extracted vehicle record
// — never overwrites a real value a stronger strategy (schema.org, the
// Porsche retailer platform) already found. Returns the same object
// (mutated) for convenience at the call site; a no-op (including on a
// null `vehicle`, e.g. no VIN found by any strategy) just returns it
// unchanged.
export function fillFromFacebookPixelViewContent(vehicle, html) {
  if (!vehicle) return vehicle;
  const fb = parseViewContentCall(html);
  if (!fb) return vehicle;

  if (!vehicle.model) vehicle.model = cleanString(fb.model);
  if (!vehicle.make) vehicle.make = cleanString(fb.make);
  if (!vehicle.exteriorColor) vehicle.exteriorColor = cleanString(fb.exterior_color);
  if (!vehicle.transmission) vehicle.transmission = cleanString(fb.transmission);
  if (!vehicle.bodyStyle) vehicle.bodyStyle = cleanString(fb.body_style);
  return vehicle;
}
