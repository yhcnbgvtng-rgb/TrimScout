/**
 * File-backed store for factoryBuild records, keyed by VIN. Same
 * persistence style as lib/dealEngagementStore.ts: local JSON under data/,
 * atomic write (tmp file + rename), writes serialized through an
 * in-process queue so concurrent upserts never interleave.
 *
 * Local-only for now — unlike dealEngagementStore, there's no Lightsail box
 * endpoint for this yet, so multiple Vercel instances don't share a copy.
 * Wire a remote push/pull the same way dealEngagementStore does if/when
 * factoryBuild needs to survive across instances.
 */
import fs from "node:fs";
import path from "node:path";
import type { FactoryBuild } from "./factoryBuild";

export type FactoryBuildStoreData = Record<string, FactoryBuild>;

const DEFAULT_STORE_PATH = path.join(process.cwd(), "data", "factory-builds.json");

function storePath(): string {
  return process.env.FACTORY_BUILD_STORE_PATH || DEFAULT_STORE_PATH;
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

function readAll(): FactoryBuildStoreData {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FactoryBuildStoreData) : {};
  } catch {
    return {};
  }
}

function writeAll(data: FactoryBuildStoreData): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export async function upsertFactoryBuild(build: FactoryBuild): Promise<FactoryBuild> {
  return enqueue(() => {
    const store = readAll();
    store[build.vin] = build;
    writeAll(store);
    return build;
  });
}

export async function getFactoryBuild(vin: string): Promise<FactoryBuild | null> {
  return enqueue(() => readAll()[vin.trim().toUpperCase()] || null);
}

export async function listFactoryBuilds(): Promise<FactoryBuild[]> {
  return enqueue(() => Object.values(readAll()));
}

/** Test-only: point the store at a scratch file so tests never touch data/factory-builds.json. */
export function factoryBuildStorePathForTests(): string {
  return storePath();
}
