/**
 * The idempotent job: given a VIN, acquire -> normalize -> canonicalize ->
 * enrich -> upsert. Safe to re-run for the same VIN — the brand sticker
 * fetchers cache by VIN already, and upsertFactoryBuild replaces the prior
 * record rather than appending.
 */
import { normalizeGenesisFamilySticker, pendingFactoryBuildShell, type CatalogResolver, type FactoryBuild } from "./factoryBuild";
import { stickerProviderForVin, type StickerProvider } from "./factoryBuildProviders";
import { enrichFactoryBuild, type VinDecodeFn } from "./factoryBuildEnrich";
import { upsertFactoryBuild } from "./factoryBuildStore";
import { bump } from "./opsMetrics";

export interface RunFactoryBuildPipelineOptions {
  /** Runs NHTSA decode enrichment. Default true. */
  enrich?: boolean;
  resolveCatalogId?: CatalogResolver;
  /** Test seam for the enrichment decode call. */
  decode?: VinDecodeFn;
  /** Test seam: overrides the WMI-routed provider lookup. */
  provider?: StickerProvider | null;
}

function bumpOutcome(build: FactoryBuild): void {
  if (build.status === "factory_verified") bump("factory_build_verified");
  else if (build.status === "decode_provisional") bump("factory_build_decode_provisional");
  else if (build.status === "parse_failed") bump("factory_build_parse_failed");
  else bump("factory_build_pending");
  if (build.enrich && !build.enrich.matched) bump("factory_build_enrich_mismatch");
}

export async function runFactoryBuildPipeline(vin: string, opts: RunFactoryBuildPipelineOptions = {}): Promise<FactoryBuild> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) {
    throw new Error("VIN must be exactly 17 characters");
  }

  const provider = opts.provider !== undefined ? opts.provider : stickerProviderForVin(cleanVin);
  let build: FactoryBuild;
  if (!provider) {
    build = pendingFactoryBuildShell(cleanVin, "No factory sticker provider is wired for this VIN's brand yet.");
  } else {
    const result = await provider.fetch(cleanVin);
    build = normalizeGenesisFamilySticker(result.sticker, { providerId: result.providerId, url: result.url }, { resolveCatalogId: opts.resolveCatalogId });
  }

  if (opts.enrich ?? true) {
    build = await enrichFactoryBuild(build, { decode: opts.decode });
  }

  bumpOutcome(build);
  return upsertFactoryBuild(build);
}
