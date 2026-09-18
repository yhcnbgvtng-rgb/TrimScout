/**
 * Pure canonicalization logic for factory options (pipeline stage 3):
 * mapping a raw sticker option's name/code to a stable, cross-brand
 * catalog entry so "M Sport Package" on one VIN and "M SPORT PACKAGE" on
 * another resolve to the same searchable thing. Additive only — rawName
 * and code on the FactoryBuildOption are never replaced, only annotated
 * with a catalogId.
 *
 * No I/O here — lib/factoryOptionCatalogStore.ts persists this and wires
 * it into the pipeline.
 */

export interface FactoryOptionCatalogEntry {
  id: string;
  /** The first-seen spelling — display name, not necessarily "canonical" in any deeper sense. */
  canonicalName: string;
  /** Every distinct raw spelling seen for this entry, including canonicalName. */
  aliases: string[];
  /** Every distinct OEM code seen for this entry, across brands (Ford has none; GM's RPO, Genesis/Stellantis's code). */
  codes: string[];
  /** Every make this option has appeared on. */
  makes: string[];
  kind: "option" | "package";
}

export type FactoryOptionCatalogData = Record<string, FactoryOptionCatalogEntry>;

/** Lowercase, strip punctuation, collapse whitespace — the matching/identity key. Never shown to a user. */
export function normalizeOptionKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic from the normalized name, so re-canonicalizing the same option name always lands on the same entry — no duplicate entries from re-running the pipeline. */
export function catalogIdFor(rawName: string): string {
  const key = normalizeOptionKey(rawName).replace(/ /g, "_");
  return `opt_${key || "unnamed"}`;
}

export interface CatalogUpsertInput {
  code: string | null;
  rawName: string;
  kind: "option" | "package";
  make: string | null;
}

/** Adds a new entry or folds a new alias/code/make into an existing one. Never removes anything — a catalog only grows. */
export function upsertCatalogEntry(
  catalog: FactoryOptionCatalogData,
  opt: CatalogUpsertInput
): { catalog: FactoryOptionCatalogData; id: string } {
  const id = catalogIdFor(opt.rawName);
  const existing = catalog[id];
  const entry: FactoryOptionCatalogEntry = existing
    ? {
        ...existing,
        aliases: existing.aliases.includes(opt.rawName) ? existing.aliases : [...existing.aliases, opt.rawName],
        codes: opt.code && !existing.codes.includes(opt.code) ? [...existing.codes, opt.code] : existing.codes,
        makes: opt.make && !existing.makes.includes(opt.make) ? [...existing.makes, opt.make] : existing.makes,
      }
    : {
        id,
        canonicalName: opt.rawName,
        aliases: [opt.rawName],
        codes: opt.code ? [opt.code] : [],
        makes: opt.make ? [opt.make] : [],
        kind: opt.kind,
      };
  return { catalog: { ...catalog, [id]: entry }, id };
}

/** Substring match against every alias, or an exact (case-insensitive) code match. Cheap and predictable — this catalog is small (one entry per distinct factory option ever seen), not a search-engine-scale index. */
export function searchCatalog(catalog: FactoryOptionCatalogData, query: string): FactoryOptionCatalogEntry[] {
  const q = normalizeOptionKey(query);
  const rawQuery = query.trim().toLowerCase();
  if (!q && !rawQuery) return [];
  return Object.values(catalog).filter(
    (e) =>
      (q && (normalizeOptionKey(e.canonicalName).includes(q) || e.aliases.some((a) => normalizeOptionKey(a).includes(q)))) ||
      (rawQuery && e.codes.some((c) => c.toLowerCase() === rawQuery))
  );
}
