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

// { exteriorColor, interiorColor, mileage, engine, transmission } from a
// parsed Vehicle/Car JSON-LD object. Never guesses — every value here is a
// direct, confirmed-real property read (or a stated absence: mileage 0,
// engine/transmission null), same honesty bar as the rest of this file.
export function readSchemaOrgVehicleFields(vehicleLd) {
  const mileage = Number.isFinite(vehicleLd?.mileageFromOdometer?.value) ? Math.round(vehicleLd.mileageFromOdometer.value) : 0;
  const exteriorColor = cleanString(vehicleLd?.color);
  const interiorColor = cleanString(vehicleLd?.vehicleInteriorColor);
  const engine = cleanString(vehicleLd?.vehicleEngine?.name)
    || cleanString(vehicleLd?.vehicleEngine?.fuelType)?.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
    || null;
  const transmission = cleanString(vehicleLd?.vehicleTransmission);
  return { mileage, exteriorColor, interiorColor, engine, transmission };
}
