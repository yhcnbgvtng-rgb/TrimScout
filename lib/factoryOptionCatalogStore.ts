/**
 * File-backed store for the factory-option catalog, same pattern as
 * lib/factoryBuildStore.ts: local JSON under data/, atomic write, writes
 * serialized through an in-process queue.
 *
 * canonicalizeFactoryBuildOptions() is the pipeline's stage-3 step: it
 * fills in catalogId on any option that doesn't already have one (an
 * explicit `resolveCatalogId` passed to the normalizer wins — this only
 * fills what's still null), growing the catalog as new option names are
 * seen. searchFactoryOptions() is stage-5's "serve" for this catalog,
 * cross-referencing matches back to the VINs that carry them via
 * lib/factoryBuildStore.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { catalogIdFor, searchCatalog, upsertCatalogEntry, type FactoryOptionCatalogData, type FactoryOptionCatalogEntry } from "./factoryOptionCatalog";
import type { FactoryBuild } from "./factoryBuild";
import { listFactoryBuilds } from "./factoryBuildStore";

const DEFAULT_STORE_PATH = path.join(process.cwd(), "data", "factory-option-catalog.json");

function storePath(): string {
  return process.env.FACTORY_OPTION_CATALOG_STORE_PATH || DEFAULT_STORE_PATH;
}

let writeChain: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => T): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function readAll(): FactoryOptionCatalogData {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FactoryOptionCatalogData) : {};
  } catch {
    return {};
  }
}

function writeAll(data: FactoryOptionCatalogData): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** Fills catalogId on every factory_verified option that doesn't already have one. A no-op for a build with no options (pending/provisional/failed). */
export async function canonicalizeFactoryBuildOptions(build: FactoryBuild): Promise<FactoryBuild> {
  if (build.options.length === 0 || build.options.every((o) => o.catalogId)) return build;
  return enqueue(() => {
    let catalog = readAll();
    let changed = false;
    const options = build.options.map((o) => {
      if (o.catalogId) return o;
      const kind = o.kind === "package" ? "package" : "option";
      const result = upsertCatalogEntry(catalog, { code: o.code, rawName: o.rawName, kind, make: build.make });
      catalog = result.catalog;
      changed = true;
      return { ...o, catalogId: result.id };
    });
    if (changed) writeAll(catalog);
    return { ...build, options };
  });
}

export interface FactoryOptionSearchResult extends FactoryOptionCatalogEntry {
  /** VINs (from the local factoryBuild store) whose factory_verified options reference this entry. */
  vins: string[];
}

/**
 * Searches the catalog (atomic-rename writes mean a plain read is always a
 * consistent snapshot, no write-chain needed here) and cross-references
 * matches back to the VINs that actually carry them, so a hit is never
 * just a name with no real car behind it.
 */
export async function searchFactoryOptions(query: string): Promise<FactoryOptionSearchResult[]> {
  const catalog = readAll();
  const matches = searchCatalog(catalog, query);
  if (matches.length === 0) return [];
  const matchIds = new Set(matches.map((m) => m.id));
  const builds = await listFactoryBuilds();
  const vinsByCatalogId = new Map<string, string[]>();
  for (const build of builds) {
    for (const opt of build.options) {
      if (opt.catalogId && matchIds.has(opt.catalogId)) {
        const list = vinsByCatalogId.get(opt.catalogId) || [];
        list.push(build.vin);
        vinsByCatalogId.set(opt.catalogId, list);
      }
    }
  }
  return matches
    .map((entry) => ({ ...entry, vins: vinsByCatalogId.get(entry.id) || [] }))
    .sort((a, b) => b.vins.length - a.vins.length);
}

export { catalogIdFor };

/** Test-only: point the store at a scratch file so tests never touch data/factory-option-catalog.json. */
export function factoryOptionCatalogStorePathForTests(): string {
  return storePath();
}
