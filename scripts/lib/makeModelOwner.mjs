// Model -> make ownership for the SHARED WMIs (one VIN range, several makes: 5N1 Nissan/Infiniti, KMH Hyundai/Genesis, 5XY Kia/Hyundai ...), used only by
// scripts/box/2026-10-28-make-from-vin-fix.mjs. vinWmi.js (the crawler's rule) is deliberately not touched: this is a one-off cleanup of stored rows.
//
// Why it is safe: the candidate makes are INTERSECTED with the makes the VIN's WMI can carry (makesForWmi), and a model only decides when exactly one of those
// makes claims it. So "G80" is Genesis on KMH (Hyundai/Genesis) and means nothing on 5N1 (Nissan/Infiniti); "Rogue" can only ever be Nissan. A model no table entry
// matches (truncated "HIGHLN", "Genesis" on a KMH VIN: the old Hyundai Genesis AND the Genesis brand, a null model) decides nothing and the row stays counted.
import { makesForWmi } from "../../scrapers/lightsail-crawler/src/vinWmi.js";

// Anchored at the start of the normalised model (lower-case, entities and runs of spaces collapsed); whole-word on the right so "k4" never matches "k45".
const OWNERS = [
  ["Hyundai", /^(elantra|sonata|venue|ioniq|tucson|santa fe|santa cruz|palisade|kona|accent|veloster|azera|nexo)\b/],
  ["Genesis", /^(g70|g80|g90|gv60|gv70|gv80)\b/],
  ["Kia", /^(telluride|sorento|sportage|ev6|ev9|soul|seltos|carnival|sedona|niro|k4|k5|forte|rio|stinger|optima|cadenza)\b/],
  ["Toyota", /^(highlander|grand highlander|sienna|sequoia|rav4|bz4x|bz|land cruiser|gr86)\b/],
  ["Lexus", /^(tx)\b/],
  ["Nissan", /^(rogue|pathfinder|murano|armada|xterra|juke|cube|ariya|370z|z|maxima|kicks|versa|sentra|altima|frontier|titan|leaf)\b/],
  ["Infiniti", /^(qx\d+|q\d+l?|g(20|25|35|37)|m(30|35|37|45|56)|ex\d+|fx\d+|jx\d+)\b/],
  ["Subaru", /^(forester|crosstrek|xv crosstrek|outback|ascent|wrx|impreza|brz|legacy|solterra|trailseeker|uncharted)\b/],
  ["Mitsubishi", /^(outlander|eclipse cross|mirage)\b/],
];

export const normModel = (model) => String(model ?? "").toLowerCase().replace(/&sol;/g, "/").replace(/\s+/g, " ").trim();

/** The make that owns this model among the makes the VIN's WMI can carry, or null (unknown WMI, no model, no match, or more than one claimant). */
export function ownerMake(vin, model) {
  const family = makesForWmi(vin);
  const m = normModel(model);
  if (!family || !m) return null;
  const claimants = OWNERS.filter(([make, re]) => family.includes(make) && re.test(m)).map(([make]) => make);
  return claimants.length === 1 ? claimants[0] : null;
}
