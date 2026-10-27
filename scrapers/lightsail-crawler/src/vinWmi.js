// VIN -> make, from the World Manufacturer Identifier (VIN characters 1-3) and, for Stellantis, the line code (characters 1-5).
//
// Why this exists: a car's make used to be `page make || dealer.make || brand.name`. On a multi-franchise lot whose page carries no
// make (or an unusable one) that stored the ROSTER brand: a Dodge Challenger, Subaru Impreza, Lincoln Corsair, Honda Fit and Buick
// Encore were all stored as make="GMC" because they were found on a GMC-roster dealer's site. The VIN is the one signal that is on
// every car and cannot be a dealer's guess, so the make is checked against it.
//
// The rule (reconcileMake) is deliberately one-sided: a VIN can PROVE a stored make wrong, it can never prove a make right.
//   - WMI not in the table (or not a 17-character VIN) -> the stored make is kept exactly as it is (blank stays blank).
//   - stored make is one of the makes that WMI can carry -> kept (Nissan/Infiniti, Hyundai/Genesis, Stellantis nameplates, a
//     Subaru-built Toyota GR86 are all "agrees"; we never second-guess a nameplate inside a family).
//   - stored make is blank or NOT in that family -> the make comes from the VIN: a WMI that names one make gives it, a Stellantis WMI
//     is resolved from the line code / model, a shared WMI gives null (or the vPIC make if the caller decoded one, see `vpicMake`).
// Only WMIs we are sure of are listed. A WMI missing from the table is safe (kept); a WRONG entry would rewrite good rows, so shared or
// unconfirmed ranges (3MW, 4S6, 5XY exceptions ...) are left out rather than guessed.
import { VIN5_NAMEPLATE, VIN3_PURE_NAMEPLATE } from './stellantisVinTable.js';
import { canonicalMake } from './ingestGuards.js';

export const STELLANTIS_NAMEPLATES = ['Jeep', 'Ram', 'Dodge', 'Chrysler', 'FIAT'];

// WMIs that belong to Stellantis (Chrysler / Dodge / Jeep / Ram / Fiat). The WMI does not say which nameplate.
export const STELLANTIS_WMI = new Set([
  '1A4', '1A8', '1B3', '1B4', '1B6', '1B7', '1C3', '1C4', '1C6', '1D3', '1D4', '1D7', '1D8', '1J4', '1J8', '2A4', '2A8',
  '2B3', '2B7', '2C3', '2C4', '2C8', '2D4', '2D8', '3A4', '3A8', '3B7', '3C3', '3C4', '3C6', '3C7', '3D3',
  '3D4', '3D7', 'ZAC', 'ZFA', 'ZFB', 'ZFC', '1P3', '2P3', '1P4',
]);

// [makes this WMI can carry (first = primary), WMIs]. A WMI listed under two entries carries the union.
const FAMILIES = [
  [['Ford'], '1FA 1FB 1FC 1FD 1F6 1F9 1FM 1FT 2FM 2FT 3FA 3FM 3FT 1ZV 2FA 3FD MAJ'],
  [['Plymouth'], '1P3 1P4 2P3'], // Plymouth shared these Chrysler-group WMIs until 2001 (the Stellantis set adds its nameplates below)
  [['Lincoln'], '5LM 2LM 3LN 5L1 1LN 1L1'],
  [['Mercury'], '1ME 2ME 3ME'],
  [['Pontiac'], '1G2'],
  [['Saturn'], '1G8'],
  [['Chevrolet'], '1G1 1GA 1GB 1GC 1GN 2CN 2G1 2GC 2GN 3G1 3GB 3GC 3GN KL1 KL7 KL8'],
  [['GMC'], '1GD 1GK 1GT 2GK 2GT 3GK 3GT'],
  [['Cadillac'], '1G6 1GY 2G6 3GY'],
  [['Buick'], '1G4 2G4 5GA KL4 LRB W04'],
  [['Toyota'], '4T1 4T3 4T4 5TD 5TE 5TF 5YF 3TM 3TY JTD JTE JTM JT2 JT3 2T1 2T3 1NX 7MU 7SV'],
  [['Lexus'], 'JTH JTJ JT8 2T2 58A'],
  [['Toyota', 'Lexus'], '5TD'], // Indiana builds the Highlander and the Lexus TX
  [['Toyota', 'Subaru'], 'JTM'], // Toyota-built Subaru EVs: Solterra, Trailseeker, Uncharted
  [['Subaru', 'Toyota', 'Scion'], 'JF1 JF2'], // the Subaru-built BRZ / Toyota GR86 / Scion FR-S share this range
  [['Subaru'], '4S3 4S4'],
  [['Honda'], '1HG 2HG 3HG 2HK 2HJ 3CZ 5FN 5FP 5J6 19X 7FA JHM SHH'],
  [['Acura'], '19U 19V JH4 5FR 5J8 2HN'],
  [['Hyundai'], 'KM8 KMH 5NP 5NT'],
  [['Hyundai', 'Genesis'], '5NM KMH'], // Alabama builds both; KMH also covers the Genesis G80 / G90 sedans
  [['Genesis'], 'KMT KMU KMG'],
  [['Kia'], 'KND KNA 3KP 5XX'],
  [['Kia', 'Hyundai'], '5XY 3KP KND'], // 5XY Georgia; 3KP Mexico (Rio / Accent twin); KND (Sedona / Entourage twin)
  [['Nissan'], 'KNM'], // Renault Samsung Busan, builds the Nissan Rogue (NOT a Kia range)
  [['Nissan'], '1N4 1N6 3N1 3N6 3N8 5BZ'], // Nissan-only sedans/trucks/Mexico builds
  [['Nissan', 'Infiniti'], '5N1 5N3 JN1 JN8'], // shared Nissan/Infiniti ranges
  [['Infiniti'], 'JNK JNR 3PC'],
  [['Mazda'], 'JM1 JM3 JM7 1YV 3MD 3MV 3MZ 7MM'],
  [['Mitsubishi'], 'JA3 JA4 JA7 4A3 4A4 ML3'],
  [['Mitsubishi', 'Nissan'], 'JA4'], // the Mitsubishi-built Nissan Rogue Plug-In Hybrid
  [['Volkswagen'], '1VW 3VW 3VV WVW WVG WV1 WV2 1V2'],
  [['Audi'], 'WAU WA1 WUA TRU'],
  [['Porsche'], 'WP0 WP1'],
  [['BMW'], 'WBA WBS WBX WBY 5UX 5YM 5UM 4US'],
  [['Mini'], 'WMW WMZ'],
  [['Mercedes-Benz'], 'W1K W1N W1Y WDB WDC WDD 4JG 55S'],
  [['Volvo'], 'YV1 YV4 7JD 7JR'],
  [['Polestar'], 'YSM LPS'],
  [['Tesla'], '5YJ 7G2 7SA LRW XP7'],
  [['Rivian'], '7FC'],
  [['Lucid'], '50E'],
  [['Jaguar'], 'SAJ'],
  [['Land Rover'], 'SAL'],
  [['Maserati'], 'ZAM'],
  [['Alfa Romeo'], 'ZAR'],
  [['Ferrari'], 'ZFF'],
  [['McLaren'], 'SBM'],
  [['Aston Martin'], 'SCF'],
  [['Bentley'], 'SCB'],
  [['Rolls-Royce'], 'SCA'],
  [['Lotus'], 'SCC'],
  [['Lamborghini'], 'ZHW'],
];

const MAKES_BY_WMI = new Map();
const add = (wmi, makes) => {
  const have = MAKES_BY_WMI.get(wmi) || [];
  MAKES_BY_WMI.set(wmi, [...have, ...makes.filter((m) => !have.includes(m))]);
};
for (const [makes, list] of FAMILIES) for (const wmi of list.split(' ')) add(wmi, makes);
for (const wmi of STELLANTIS_WMI) add(wmi, STELLANTIS_NAMEPLATES);

const VIN5 = new Map();
for (const [nameplate, list] of Object.entries(VIN5_NAMEPLATE)) for (const p of list.split(' ')) VIN5.set(p, nameplate);

// Model -> nameplate for Stellantis rows whose VIN prefix isn't in the learned table (a new platform year).
// Full-word patterns only; ambiguous bare numerics (300, 500) are left to the VIN.
const MODEL_RULES = [
  [/\b(wrangler|gladiator|cherokee|compass|renegade|wagoneer|patriot|liberty|commander)\b/i, 'Jeep'],
  [/\b(ram|promaster|dakota|rampage)\b/i, 'Ram'],
  [/\b(charger|challenger|durango|journey|caravan|hornet|avenger|nitro|viper|magnum|stratus|neon)\b/i, 'Dodge'],
  [/\b(pacifica|voyager|town (&|and) country|sebring|pt cruiser|aspen)\b/i, 'Chrysler'],
];

/** First three characters of a well-formed 17-character VIN, upper-cased; null for anything else (short, I/O/Q, junk). */
export function wmiOf(vin) {
  const v = String(vin ?? '').trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(v) ? v.slice(0, 3) : null;
}

/** Every make this VIN's WMI can carry (primary first), or null when the VIN is malformed or its WMI is not in the table. */
export function makesForWmi(vin) {
  const wmi = wmiOf(vin);
  return wmi ? MAKES_BY_WMI.get(wmi) ?? null : null;
}

/** The make a VIN names on its own: a single-make WMI, or a Stellantis VIN resolved by line code. Null when ambiguous or unknown. */
export function makeFromVin(vin, { model } = {}) {
  const makes = makesForWmi(vin);
  if (!makes) return null;
  if (makes.length === 1) return makes[0];
  if (STELLANTIS_WMI.has(wmiOf(vin))) return resolveUmbrellaMake({ vin, model }).make;
  return null;
}

// Resolve the real make for a Stellantis-umbrella vehicle (make = "Stellantis"). Returns { make, via } or { make: null, via: null }.
// A foreign VIN (a Ford trade-in on a Stellantis lot) resolves to its own manufacturer's primary make.
export function resolveUmbrellaMake({ vin, model } = {}) {
  const v = String(vin || '').trim().toUpperCase();
  const wmi = v.slice(0, 3);
  if (v.length >= 5 && VIN5.has(v.slice(0, 5))) return { make: VIN5.get(v.slice(0, 5)), via: 'vin5' };
  const foreign = wmi && !STELLANTIS_WMI.has(wmi) && MAKES_BY_WMI.has(wmi);
  if (foreign) return { make: MAKES_BY_WMI.get(wmi)[0], via: 'other-wmi' };
  if (model && (!wmi || STELLANTIS_WMI.has(wmi))) {
    const m = String(model).trim();
    for (const [re, np] of MODEL_RULES) if (re.test(m)) return { make: np, via: 'model' };
  }
  if (VIN3_PURE_NAMEPLATE[wmi]) return { make: VIN3_PURE_NAMEPLATE[wmi], via: 'vin3' };
  return { make: null, via: null };
}

/**
 * Check a make against its VIN. Pass the make already canonicalised (canonicalNameplate / canonicalMake).
 * Returns { make, via, from }:
 *   via 'kept'                the make stands (agrees with the WMI, or the WMI says nothing)
 *   via 'wmi-fill'            blank make, filled from the VIN
 *   via 'wmi-conflict'        stored make contradicted the VIN, replaced by the VIN's make (`from` = the old make)
 *   via 'vpic-fill' / 'vpic-conflict'  same, but the WMI is shared and the caller's vPIC decode picked the make (`vpicMake`)
 *   via 'unresolved'          blank make and the VIN cannot name one -> null
 *   via 'conflict-unresolved' stored make contradicted the VIN but the VIN cannot name one (shared WMI, no vPIC) -> null
 */
export function reconcileMake({ make, vin, model, vpicMake } = {}) {
  const stored = canonicalMake(make);
  const family = makesForWmi(vin);
  if (!family) return { make: stored, via: 'kept', from: stored };
  if (stored && family.includes(stored)) return { make: stored, via: 'kept', from: stored };
  const named = makeFromVin(vin, { model });
  if (named) return { make: named, via: stored ? 'wmi-conflict' : 'wmi-fill', from: stored };
  const decoded = canonicalMake(vpicMake);
  if (decoded && family.includes(decoded)) return { make: decoded, via: stored ? 'vpic-conflict' : 'vpic-fill', from: stored };
  return { make: null, via: stored ? 'conflict-unresolved' : 'unresolved', from: stored };
}
