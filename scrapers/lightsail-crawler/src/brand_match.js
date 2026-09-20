// Multi-brand isolation check: some dealers (especially multi-franchise
// groups) surface other brands they also sell in the same sitemap/pages —
// standalone.js only keeps vehicles that actually match the brand this run
// is targeting. Extracted out of standalone.js's inline extraction loop so
// it's unit-testable on its own (that loop is otherwise all top-level,
// side-effecting module code).
//
// Most brand configs (brands.js) are single-nameplate: `brand.name` IS the
// real make ("Ford", "Chevrolet", ...), so a match just collapses every raw
// label variant a source site used ("FORD TRUCK", "FORD MEDIUM TRUCK") to
// that one canonical name — see the collapse comment below.
//
// Stellantis is different on purpose (see nj_policy.js's NJ_BRANDS_IN_
// EXPANSION comment): Chrysler/Dodge/Jeep/Ram/Fiat share the same physical
// rooftops, so one crawl config covers all of them rather than re-visiting
// the same ~2,300 sites four times. But a Jeep Wrangler is not a
// "Stellantis" to anyone using the app — collapsing every one of those
// vehicles' `make` to the umbrella crawl-scope name would erase the real
// nameplate. `brand.nameplates` (an array of the real makes this config
// covers) lets a multi-nameplate brand keep each vehicle's own real make
// while still crawling under one shared brand config. Single-nameplate
// brands never set `nameplates`, so they fall back to `[brand.name]` and
// behave exactly as before this existed.
export function resolveVehicleBrandMatch(brand, vehicle) {
  const nameplates = brand.nameplates && brand.nameplates.length ? brand.nameplates : [brand.name];
  const rawMake = (vehicle.make || '').toLowerCase();
  const matchedNameplate = nameplates.find((np) => rawMake.includes(np.toLowerCase())) || null;
  const vinMatch = brand.vinPrefixes.some((p) => vehicle.vin.startsWith(p));

  if (!matchedNameplate && !vinMatch) {
    return { isTargetBrand: false, resolvedMake: null };
  }

  // A VIN-prefix-only match (no nameplate found in the raw make label —
  // e.g. it was blank) has no real nameplate to preserve; fall back to
  // brand.name rather than guessing which of several nameplates it is.
  return { isTargetBrand: true, resolvedMake: matchedNameplate || brand.name };
}
