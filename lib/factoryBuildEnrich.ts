/**
 * Enrichment (stage 4): a VIN decode database is subordinate to the window
 * sticker. Allowed uses only — confirm year/make/model, fill a truly
 * missing trim, and flag disagreements for QA. A sticker's own MSRP/options
 * are never overwritten by a decode, and a decode never manufactures
 * sticker-verified options.
 */
import { decodeVinFromNhtsa, type DecodedVehicle } from "./vinDecoder";
import type { FactoryBuild, FactoryBuildMismatch } from "./factoryBuild";

export type VinDecodeFn = (vin: string) => Promise<DecodedVehicle | null>;

export interface EnrichOptions {
  decode?: VinDecodeFn;
}

function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function fieldsMatch(a: string, b: string): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function findMismatches(build: FactoryBuild, decoded: DecodedVehicle): FactoryBuildMismatch[] {
  const mismatches: FactoryBuildMismatch[] = [];
  if (build.year != null && decoded.year != null && build.year !== decoded.year) {
    mismatches.push({ field: "year", stickerValue: build.year, decodeValue: decoded.year });
  }
  if (build.make && decoded.make && !fieldsMatch(build.make, decoded.make)) {
    mismatches.push({ field: "make", stickerValue: build.make, decodeValue: decoded.make });
  }
  if (build.model && decoded.model && !fieldsMatch(build.model, decoded.model)) {
    mismatches.push({ field: "model", stickerValue: build.model, decodeValue: decoded.model });
  }
  return mismatches;
}

/**
 * Runs the NHTSA decode and reconciles it against `build`. A build with a
 * sticker (factory_verified/parse_failed) keeps every sticker field as-is —
 * a decode can only flag mismatches and fill a genuinely missing trim. A
 * build with no sticker (factory_pending) is upgraded to decode_provisional
 * when NHTSA resolves the VIN, carrying decode-only data with no options.
 */
export async function enrichFactoryBuild(build: FactoryBuild, opts: EnrichOptions = {}): Promise<FactoryBuild> {
  const decode = opts.decode || decodeVinFromNhtsa;
  const decoded = await decode(build.vin).catch(() => null);
  if (!decoded || !decoded.make) return build;

  const mismatches = findMismatches(build, decoded);
  const enrich = { provider: "nhtsa_vpic", matched: mismatches.length === 0, mismatches };

  if (build.status === "factory_pending") {
    return {
      ...build,
      year: build.year ?? decoded.year ?? null,
      make: build.make ?? decoded.make ?? null,
      model: build.model ?? decoded.model ?? null,
      trim: build.trim ?? decoded.trim ?? null,
      provenance: "decode_provisional",
      status: "decode_provisional",
      enrich,
      updatedAt: new Date().toISOString(),
    };
  }

  const trimWasMissing = !build.trim;
  const trim = build.trim || decoded.trim || null;
  return {
    ...build,
    trim,
    provenance: trimWasMissing && trim ? "mixed" : build.provenance,
    enrich,
    updatedAt: new Date().toISOString(),
  };
}
