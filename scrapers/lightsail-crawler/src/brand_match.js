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

// Confirmed live 2026-09-27: a used 2023 Porsche Taycan GTS trade-in listed
// on Volkswagen of Hartford's own site (61 used vehicles across 12 makes —
// Audi, Maserati, Mazda, Nissan, Porsche, RAM, etc. — vs. 39 VW ones we
// actually stored) was invisible everywhere in the app, because no crawl
// run is ever scoped to "Porsche dealer that happens to also be a
// single-franchise VW store" — that vehicle is only ever seen by the VW
// crawl run, and isTargetBrand used to mean "discard it". That's the right
// call for resolveVehicleBrandMatch itself (it exists to answer "does this
// match what THIS crawl run is targeting", and Stellantis needs that exact
// yes/no); the fix belongs at the call site instead — keep an off-brand
// vehicle too, tagged with its own real make, rather than the umbrella
// crawl's target brand. A vehicle with no usable make label at all (raw
// make blank, no VIN-prefix match either) still can't be identified and is
// still dropped; this only recovers the case where the vehicle plainly says
// what it is.
export function resolveKeptMake(brand, vehicle) {
  const { isTargetBrand, resolvedMake } = resolveVehicleBrandMatch(brand, vehicle);
  if (isTargetBrand) return resolvedMake;
  const rawMake = (vehicle.make || '').trim();
  return rawMake || null;
}
