// Pure matching logic for the factory-option match flow. Deliberately has
// zero knowledge of any specific OptionsProvider — it only ever sees plain
// option-code arrays — so it can't accidentally leak vendor-specific
// behavior into what's supposed to be an honest, defensible match signal.
import type { FactoryOptionRef, MatchableVehicle } from "./optionsProvider";

export interface OptionCatalogEntry {
  code: string;
  name: string;
}

/** Every distinct option across the given inventory, for the picker checklists. De-duped by code, first name wins. */
export function buildOptionCatalog(vehicles: MatchableVehicle[]): OptionCatalogEntry[] {
  const seen = new Map<string, string>();
  for (const mv of vehicles) {
    for (const opt of mv.options) {
      if (!seen.has(opt.code)) seen.set(opt.code, opt.name);
    }
  }
  return Array.from(seen.entries())
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface VehicleMatchResult {
  vehicle: MatchableVehicle["vehicle"];
  mustHavesHit: FactoryOptionRef[];
  mustHavesMissed: FactoryOptionRef[];
  niceToHavesHit: FactoryOptionRef[];
  /** True only when every requested must-have is confirmed present — never implied by partial overlap. */
  isFullMatch: boolean;
}

/**
 * Matches one vehicle's confirmed options against the buyer's must-have and
 * nice-to-have code selections. Returns which must-haves are actually
 * confirmed present vs. missing so the UI never has to imply a match it
 * can't point to a specific code for.
 */
export function matchVehicle(
  mv: MatchableVehicle,
  mustHaveCodes: string[],
  niceToHaveCodes: string[],
  // Optional inventory-wide catalog, used only to show a real plain-English
  // name for a missed must-have (this vehicle doesn't have it, but some
  // other one in the inventory does, so its name is still known). Falls
  // back to the bare code when absent — never fabricates a name.
  catalog?: OptionCatalogEntry[]
): VehicleMatchResult {
  const byCode = new Map(mv.options.map((o) => [o.code, o]));
  const catalogNames = new Map((catalog || []).map((c) => [c.code, c.name]));
  const mustHavesHit: FactoryOptionRef[] = [];
  const mustHavesMissed: FactoryOptionRef[] = [];
  for (const code of mustHaveCodes) {
    const opt = byCode.get(code);
    if (opt) mustHavesHit.push(opt);
    else mustHavesMissed.push({ code, name: catalogNames.get(code) || code });
  }
  const niceToHavesHit = niceToHaveCodes
    .map((code) => byCode.get(code))
    .filter((o): o is FactoryOptionRef => Boolean(o));

  return {
    vehicle: mv.vehicle,
    mustHavesHit,
    mustHavesMissed,
    niceToHavesHit,
    isFullMatch: mustHaveCodes.length > 0 && mustHavesMissed.length === 0,
  };
}

/** Ranks full matches first, then by how many must-haves are hit, then by nice-to-haves hit. Ties keep input order (stable sort). */
export function rankMatches(results: VehicleMatchResult[]): VehicleMatchResult[] {
  return [...results].sort((a, b) => {
    if (a.isFullMatch !== b.isFullMatch) return a.isFullMatch ? -1 : 1;
    if (a.mustHavesHit.length !== b.mustHavesHit.length) return b.mustHavesHit.length - a.mustHavesHit.length;
    return b.niceToHavesHit.length - a.niceToHavesHit.length;
  });
}
