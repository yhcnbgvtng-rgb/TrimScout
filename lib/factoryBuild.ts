/**
 * The common "factory build" record: VIN, trim, MSRP lines and factory
 * options/packages, normalized from a brand's window-sticker (Monroney)
 * parser into one cross-brand shape. A window sticker is ground truth when
 * present; nothing here ever invents sticker options from a VIN decode.
 *
 * This module only normalizes/canonicalizes an already-fetched sticker
 * (stage 2+3 of the pipeline). Acquisition is lib/factoryBuildProviders.ts,
 * decode enrichment is lib/factoryBuildEnrich.ts, persistence is
 * lib/factoryBuildStore.ts, and lib/factoryBuildPipeline.ts wires all four.
 */
import { createHash } from "node:crypto";
import type { GenesisOptionLine, GenesisSticker } from "./genesisSticker";

export type FactoryBuildStatus = "factory_verified" | "factory_pending" | "decode_provisional" | "parse_failed";
export type FactoryBuildProvenance = "sticker" | "decode_provisional" | "mixed";
export type FactoryBuildOptionKind = "option" | "package" | "color" | "interior";

export interface FactoryBuildOption {
  code: string | null;
  rawName: string;
  /** Additive: a match into TrimScout's option catalog, when one is known. Never required. */
  catalogId: string | null;
  msrpDelta: number | null;
  kind: FactoryBuildOptionKind;
}

export interface FactoryBuildStickerSource {
  /** Which provider fetched this (e.g. "hyundai_dealerfire", "genesis_oem"). */
  type: string;
  url: string | null;
  acquiredAt: string;
  contentHash: string | null;
}

export interface FactoryBuildMsrp {
  base: number | null;
  destination: number | null;
  optionsSum: number | null;
  total: number | null;
}

export interface FactoryBuildParse {
  parserId: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

export interface FactoryBuildMismatch {
  field: string;
  stickerValue: unknown;
  decodeValue: unknown;
}

export interface FactoryBuildEnrich {
  provider: string;
  matched: boolean;
  mismatches: FactoryBuildMismatch[];
}

export interface FactoryBuild {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  provenance: FactoryBuildProvenance;
  stickerSource: FactoryBuildStickerSource | null;
  msrp: FactoryBuildMsrp;
  options: FactoryBuildOption[];
  colors: { exterior: string | null; interior: string | null };
  parse: FactoryBuildParse;
  enrich: FactoryBuildEnrich | null;
  status: FactoryBuildStatus;
  updatedAt: string;
}

/** Maps a raw option's code/name to a TrimScout catalog id, or null when unknown. Additive only — never blocks a build. */
export type CatalogResolver = (opt: { code: string | null; rawName: string }) => string | null;
export const noopCatalogResolver: CatalogResolver = () => null;

export interface NormalizeStickerSource {
  /** Provider id, e.g. "hyundai_dealerfire" or "genesis_oem" — see lib/factoryBuildProviders.ts. */
  providerId: string;
  url: string | null;
}

export interface NormalizeOptions {
  resolveCatalogId?: CatalogResolver;
}

function hashRawText(rawText: string): string | null {
  if (!rawText) return null;
  return createHash("sha256").update(rawText).digest("hex");
}

/**
 * A package header is followed by its (unpriced) child lines in the source
 * parsers — the child flag marks membership, not the header itself. Derive
 * "package" vs. standalone "option" from that adjacency so MSRP dedup stays
 * correct (children carry msrpDelta: null, never double-counted).
 */
function classifyOptionKind(options: GenesisOptionLine[], index: number): "option" | "package" {
  const opt = options[index];
  if (opt.isPackageChild) return "option";
  return options[index + 1]?.isPackageChild === true ? "package" : "option";
}

function mapOptions(sticker: GenesisSticker, resolveCatalogId: CatalogResolver): FactoryBuildOption[] {
  return sticker.options.map((o, i) => ({
    code: o.code || null,
    rawName: o.name,
    catalogId: resolveCatalogId({ code: o.code || null, rawName: o.name }),
    msrpDelta: o.price,
    kind: classifyOptionKind(sticker.options, i),
  }));
}

function computeParse(sticker: GenesisSticker, options: FactoryBuildOption[]): FactoryBuildParse {
  const parserId = "genesis_family_v1";
  if (sticker.status === "error") {
    return { parserId, confidence: "low", warnings: [sticker.note || "Sticker text did not match the requested VIN."] };
  }
  if (sticker.status === "unreleased") {
    return { parserId, confidence: "low", warnings: sticker.note ? [sticker.note] : [] };
  }

  const warnings: string[] = [];
  const optionsTotal = options.reduce((sum, o) => sum + (o.msrpDelta || 0), 0);
  let reconciled: boolean | null = null;
  if (sticker.basePrice != null && sticker.destination != null && sticker.msrp != null) {
    const computedTotal = sticker.basePrice + sticker.destination + optionsTotal;
    reconciled = Math.abs(computedTotal - sticker.msrp) < 1;
    if (!reconciled) {
      warnings.push(
        `Base + destination + options ($${computedTotal.toFixed(2)}) does not reconcile with the sticker's printed total ($${sticker.msrp.toFixed(2)}) — a line may be missing from the parse.`
      );
    }
  }
  if (options.length === 0) {
    warnings.push("Sticker parsed successfully but listed no added factory options or packages.");
  }

  return { parserId, confidence: reconciled === false ? "medium" : "high", warnings };
}

/**
 * Normalizes a GenesisSticker-shaped record (Genesis and Hyundai both parse
 * to this shape — same SAP Monroney form family) into the common
 * FactoryBuild schema. "released" -> factory_verified, "unreleased" ->
 * factory_pending, "error" (text didn't match the requested VIN) ->
 * parse_failed. Options/MSRP are only populated for factory_verified —
 * never invent sticker content for a pending or failed fetch.
 */
export function normalizeGenesisFamilySticker(
  sticker: GenesisSticker,
  source: NormalizeStickerSource,
  opts: NormalizeOptions = {}
): FactoryBuild {
  const resolveCatalogId = opts.resolveCatalogId || noopCatalogResolver;
  const status: FactoryBuildStatus =
    sticker.status === "released" ? "factory_verified" : sticker.status === "error" ? "parse_failed" : "factory_pending";
  const options = status === "factory_verified" ? mapOptions(sticker, resolveCatalogId) : [];

  return {
    vin: sticker.vin,
    year: sticker.year ?? null,
    make: sticker.make ?? null,
    model: sticker.model ?? null,
    trim: sticker.trim || null,
    provenance: "sticker",
    stickerSource: {
      type: source.providerId,
      url: source.url,
      acquiredAt: sticker.fetchedAt,
      contentHash: hashRawText(sticker.rawText),
    },
    msrp: {
      base: sticker.basePrice,
      destination: sticker.destination,
      optionsSum: sticker.optionsPrice,
      total: sticker.msrp,
    },
    options,
    colors: { exterior: sticker.exteriorColor ?? null, interior: sticker.interiorColor ?? null },
    parse: computeParse(sticker, options),
    enrich: null,
    status,
    updatedAt: new Date().toISOString(),
  };
}

/** A shell for a VIN whose brand has no wired sticker provider yet — never factory_verified, always eligible for decode enrichment. */
export function pendingFactoryBuildShell(vin: string, note: string): FactoryBuild {
  return {
    vin: vin.trim().toUpperCase(),
    year: null,
    make: null,
    model: null,
    trim: null,
    provenance: "sticker",
    stickerSource: null,
    msrp: { base: null, destination: null, optionsSum: null, total: null },
    options: [],
    colors: { exterior: null, interior: null },
    parse: { parserId: "none", confidence: "low", warnings: [note] },
    enrich: null,
    status: "factory_pending",
    updatedAt: new Date().toISOString(),
  };
}
