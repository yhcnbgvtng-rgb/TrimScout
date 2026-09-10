/**
 * Importing a vehicle with no paid decode and no window sticker.
 *
 * The makes served by lib/listingFeedBuild.ts get their factory build from
 * MarketCheck, which sits behind the paid-decode kill switch. That used to mean
 * pasting a BMW (or any of the other 14) produced nothing but a "factory-option
 * lookup is temporarily unavailable" error. Everything below is free and
 * already on hand at that point:
 *
 *   - the VIN, read from the pasted page
 *   - year/make/model/trim/engine, from NHTSA's public vPIC decoder
 *   - the dealership, from the page's own JSON-LD or og:site_name
 *   - the advertised price, scraped from the same page
 *
 * That is enough to put the car in the offer package and name the dealer on
 * step 2. What's missing is the factory option list — so must-haves simply
 * aren't offered for these makes, rather than the import failing.
 */

import type { Vehicle } from "./types";
import type { DecodedVehicle } from "./vinDecoder";
import type { DealerPageIdentity } from "./dealerPageIdentity";

export interface FreeVinImportInput {
  vin: string;
  decoded: DecodedVehicle | null;
  dealer: DealerPageIdentity | null | undefined;
  listingPrice: number | null;
  listingUrl: string | null;
  /** Display label for the make, used when NHTSA gives nothing usable. */
  fallbackMake: string;
}

function titleCaseMake(raw: string): string {
  // NHTSA returns makes fully upper-cased ("BMW", "MERCEDES-BENZ", "VOLVO").
  // Acronyms should stay as-is; ordinary words read better in title case.
  if (raw.length <= 3) return raw.toUpperCase();
  return raw
    .toLowerCase()
    .split(/([\s-])/)
    .map((part) => (/[\s-]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

function engineLabel(decoded: DecodedVehicle | null): string {
  if (!decoded) return "";
  // NHTSA is inconsistent here: displacementL comes back as "3.0" on some VINs
  // and "3.0L" on others, so parse the number out rather than trusting the
  // whole string to be numeric — Number("3.0L") is NaN, which shipped a
  // literal "NaNL 6-cyl" to the buyer before this.
  const displacement = parseFloat((decoded.displacementL || "").replace(/[^\d.]/g, ""));
  const cylinders = (decoded.engineCylinders || "").trim();
  const litres = Number.isFinite(displacement) && displacement > 0 ? `${displacement.toFixed(1)}L` : "";
  const cyl = cylinders ? `${cylinders}-cyl` : "";
  return [litres, cyl].filter(Boolean).join(" ");
}

/**
 * Builds the Vehicle a paste can produce without spending anything. Options and
 * packages are deliberately empty — we have no factory build, and inventing one
 * from a dealer's ad copy is exactly what this product promises not to do.
 */
export function freeVinImportVehicle(input: FreeVinImportInput): Vehicle {
  const { vin, decoded, dealer, listingPrice, listingUrl, fallbackMake } = input;
  const make = decoded?.make ? titleCaseMake(decoded.make) : fallbackMake;
  const model = (decoded?.model || "").trim();

  return {
    id: `free-${vin}`,
    vin,
    year: decoded?.year && decoded.year > 1980 ? decoded.year : 0,
    make,
    // Left empty when NHTSA can't name the model — every display joins
    // year/make/model/trim and drops the blanks, so this reads "2024 BMW"
    // rather than the nonsense "2024 BMW BMW" a make-as-model fallback gives.
    model,
    trim: (decoded?.trim || "").trim(),
    bodyType: (decoded?.bodyClass || "").trim(),
    engine: engineLabel(decoded),
    drivetrain: (decoded?.driveType || "").trim(),
    transmission: (decoded?.transmission || "").trim(),
    exteriorColor: "",
    interiorColor: "",
    // No sticker means no MSRP we can stand behind. The advertised price is
    // the dealer's own number and is labelled as such downstream.
    msrp: 0,
    dealerPrice: listingPrice && listingPrice > 0 ? listingPrice : 0,
    daysOnLot: 0,
    status: "on_lot",
    condition: "new",
    location: {
      dealerName: dealer?.name || "",
      city: dealer?.city || "",
      state: dealer?.state || "",
      zip: dealer?.zip || undefined,
      distanceMiles: 0,
      // The listing page itself named this dealer, which is the strongest
      // confirmation available short of a live inventory lookup — stronger
      // than a window sticker's factory ship-to dealer.
      dealerConfirmed: Boolean(dealer?.name),
    },
    packages: [],
    options: [],
    imageUrl: "",
    mileage: 0,
    dealerUrl: listingUrl || undefined,
  };
}

/**
 * NHTSA error codes that mean the VIN itself is wrong, not merely incomplete.
 *
 *   1 — check digit (9th position) does not calculate properly
 *   3 — VIN corrected, error in one position
 *   4 — VIN corrected, error in two positions
 *  11 — incorrect model year
 *
 * vPIC decodes structurally regardless, so a mistyped or invented VIN still
 * comes back with a confident-looking year, make and model. Presenting that as
 * the buyer's car is exactly the kind of unchecked "match" this product exists
 * to avoid — a wrong year here becomes a quote request for a car nobody has.
 * Codes it does not list (notably 14, "unable to provide information for some
 * characters") mean partial data about a valid VIN, which is fine.
 */
const VIN_INTEGRITY_ERROR_CODES = new Set([1, 3, 4, 11]);

/** True when NHTSA flagged the VIN itself as invalid or auto-corrected. */
export function hasVinIntegrityError(decoded: DecodedVehicle | null): boolean {
  const text = decoded?.errorText;
  if (!text) return false;
  // ErrorText is a "code - description" list joined by semicolons, e.g.
  // "1 - Check Digit (9th position) does not calculate properly; 14 - ...".
  return text
    .split(";")
    .map((part) => parseInt(part.trim(), 10))
    .some((code) => Number.isFinite(code) && VIN_INTEGRITY_ERROR_CODES.has(code));
}

/**
 * True when the decode produced enough to show the buyer a real car. Model is
 * not required — NHTSA withholds it for some VINs, and "2024 BMW" plus the
 * dealership and the listing link is still a usable thing to send. A VIN that
 * fails its own check digit is refused outright, however confident the rest of
 * the decode looks.
 */
export function isUsableFreeImport(vehicle: Vehicle, decoded?: DecodedVehicle | null): boolean {
  if (hasVinIntegrityError(decoded ?? null)) return false;
  return vehicle.vin.length === 17 && vehicle.year > 0 && Boolean(vehicle.make.trim());
}
