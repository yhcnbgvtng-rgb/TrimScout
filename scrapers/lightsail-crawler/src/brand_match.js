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
import { canonicalNameplate, isUmbrellaMake, resolveUmbrellaMake, normalizeMakeForWrite } from './stellantisMake.js';
import { reconcileMake, makesForWmi } from './vinWmi.js';
import { canonicalMake } from './ingestGuards.js';

export function resolveVehicleBrandMatch(brand, vehicle) {
  const nameplates = brand.nameplates && brand.nameplates.length ? brand.nameplates : [brand.name];
  const rawMake = (vehicle.make || '').toLowerCase();
  const matchedNameplate = nameplates.find((np) => rawMake.includes(np.toLowerCase())) || null;
  const vinMatch = brand.vinPrefixes.some((p) => vehicle.vin.startsWith(p));

  if (!matchedNameplate && !vinMatch) {
    return { isTargetBrand: false, resolvedMake: null };
  }

  // A VIN-prefix-only match (no nameplate found in the raw make label — e.g. it was blank) used to
  // fall back to brand.name, which for Stellantis stored the umbrella "Stellantis" as the make on
  // ~19k rows (confirmed live 2026-10-01). Resolve the real nameplate from the VIN (and model)
  // instead — see stellantisMake.js. brand.name remains only the last resort for a VIN that no
  // table can place; the deals API nulls an unresolvable umbrella make rather than storing it.
  if (matchedNameplate) return { isTargetBrand: true, resolvedMake: canonicalNameplate(matchedNameplate) || matchedNameplate };
  if (isUmbrellaMake(brand.name) && nameplates.length > 1) {
    const resolved = resolveUmbrellaMake({ vin: vehicle.vin, model: vehicle.model }).make;
    if (resolved) return { isTargetBrand: true, resolvedMake: resolved };
  }
  return { isTargetBrand: true, resolvedMake: brand.name };
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
export function resolveKeptMake(brand, vehicle, dealer = null) {
  return resolveKeptMakeDetailed(brand, vehicle, dealer).make;
}

// The make plus where it came from, for the crawl log: 'page' (the page's own label, or the roster brand the VIN agrees with),
// 'vin' (filled or corrected from the VIN's WMI), 'fallback' (see below), or null make when nothing can name the car.
//
// Fallback: a car with NO make on the page whose VIN prefix is not in the WMI table used to be dropped (the first VIN-make patch
// skipped ~every such car). It is now kept under the dealer's roster brand, else this shard's brand — the pre-VIN behaviour, but only
// for the cars the VIN cannot place, and logged as make_source=fallback so the count and the VINs are visible. It is never used when
// the page gave a make, or when the VIN names one: a VIN can prove a make wrong, so the fallback never overrides it. On a multi-brand
// dealer this can still label an unknown-WMI car of another brand with the roster brand (the old bug, now limited to unknown WMIs);
// the logged VINs are the list to add to the WMI table. A WMI shared by several makes only accepts a fallback inside its family.
export function resolveKeptMakeDetailed(brand, vehicle, dealer = null) {
  const { isTargetBrand, resolvedMake } = resolveVehicleBrandMatch(brand, vehicle);
  // Either way the make is then checked against the VIN (vinWmi.js): a page label the VIN contradicts, or a make that only came from
  // the roster brand, is replaced by the VIN's make. A Challenger on a GMC-roster dealer's page used to be stored as "GMC".
  // An off-brand vehicle's raw make may itself be the umbrella (roster `dealer.make`); normalizeMakeForWrite resolves it too.
  const make = isTargetBrand
    ? reconcileMake({ make: resolvedMake, vin: vehicle.vin, model: vehicle.model }).make
    : normalizeMakeForWrite({ make: vehicle.make, vin: vehicle.vin, model: vehicle.model });
  const pageMake = canonicalMake(vehicle.make);
  if (make) return { make, makeSource: pageMake && pageMake === make ? 'page' : 'vin' };

  // Only a car with no page make at all: a page make the VIN contradicted but could not replace stays unresolved (dropped).
  if (!pageMake) {
    const family = makesForWmi(vehicle.vin);
    const fallback = [dealer && dealer.make, brand && brand.name]
      .filter((m) => m && !isUmbrellaMake(m))
      .map((m) => canonicalMake(m))
      .find((m) => m && (!family || family.includes(m)));
    if (fallback) return { make: fallback, makeSource: 'fallback' };
  }
  return { make: null, makeSource: null };
}
