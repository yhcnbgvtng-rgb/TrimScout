// Reads the fields a Vehicle/Car schema.org JSON-LD block on a Porsche VDP
// actually carries, but that extractSchemaOrgVehicle previously hardcoded
// to null/0 regardless of what the page said. Confirmed live 2026-09-22
// against two real Porsche-network VDPs (jackdaniels.porsche.com — a used
// Cayenne S E-Hybrid and a new Taycan 4S):
//   - "@type" is ["Car","Product"] there, never the bare string "Vehicle"
//     this strategy used to require — so it silently returned null for
//     every Porsche-network dealer's own real markup.
//   - color / vehicleInteriorColor / mileageFromOdometer.value /
//     vehicleTransmission are all real, populated properties this strategy
//     never read.
//   - vehicleEngine has no .name on this platform, only an enum-style
//     .fuelType ("ELECTRIC", "PLUG_IN_HYBRID") — presented as words rather
//     than shipped verbatim.
import { readOdometer } from './ingestSanitize.js';

function cleanString(val) {
  if (!val || val === 'null' || val === 'undefined' || val === 'NULL' || val === 'None') return null;
  const str = val.toString().trim();
  return str === '' || str === 'null' ? null : str;
}

// A schema.org "@type" is a string or an array of strings — true when it
// names something this strategy should treat as a vehicle listing.
export function isVehicleLikeSchemaOrgType(type) {
  const types = Array.isArray(type) ? type : [type];
  return types.includes('Vehicle') || types.includes('Car');
}

// Finds the Vehicle/Car node in a parsed JSON-LD block — which may BE that
// node directly, or may be a schema.org "@graph" wrapper (the standard way
// a page bundles multiple entities — the dealer's own AutoDealer listing,
// breadcrumbs, and the vehicle — into one <script> tag) with the vehicle
// node buried inside it. Confirmed live 2026-09-28: extractSchemaOrgVehicle
// used to check `parsed['@type']` directly and nothing else, so any page
// using @graph (a "Team Velocity/Apollo"-platform VDP, in this case) never
// matched — its top-level object has no @type of its own at all, only
// "@context" and "@graph" — even though a real Vehicle node with a real
// VIN was sitting right there in the array. Silently extraction-failed for
// 163 of 215 candidate URLs at one real dealer (Volkswagen of Hartford),
// hiding a used Porsche Taycan trade-in that was otherwise fully
// discoverable (its VDP URL was already correctly found by
// vdpUrlFilter.js's bare-VIN-segment fix) — the bug was here, one stage
// further downstream than URL discovery.
export function findVehicleLd(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const candidates = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
  return candidates.find((node) => node && isVehicleLikeSchemaOrgType(node['@type']) && node.vehicleIdentificationNumber) || null;
}

// { exteriorColor, interiorColor, mileage, engine, transmission } from a
// parsed Vehicle/Car JSON-LD object. Never guesses — every value here is a
// direct, confirmed-real property read (or a stated absence: mileage/
// engine/transmission null), same honesty bar as the rest of this file.
// mileage is null when the page has no odometer value — never a 0 default;
// whether a stated 0 is kept is decided per condition by resolveMileage().
export function readSchemaOrgVehicleFields(vehicleLd) {
  const mileage = readOdometer(vehicleLd?.mileageFromOdometer?.value);
  const exteriorColor = cleanString(vehicleLd?.color);
  const interiorColor = cleanString(vehicleLd?.vehicleInteriorColor);
  const engine = cleanString(vehicleLd?.vehicleEngine?.name)
    || cleanString(vehicleLd?.vehicleEngine?.fuelType)?.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
    || null;
  const transmission = cleanString(vehicleLd?.vehicleTransmission);
  return { mileage, exteriorColor, interiorColor, engine, transmission };
}
