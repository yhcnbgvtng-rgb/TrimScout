import "./testdata/blockLiveHttp";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pendingFactoryBuildShell } from "./factoryBuild";
import { upsertFactoryBuild, getFactoryBuild, listFactoryBuilds } from "./factoryBuildStore";

const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "factory-build-store-test-"));
const SCRATCH_PATH = path.join(SCRATCH_DIR, "factory-builds.json");
const ORIGINAL_ENV = process.env.FACTORY_BUILD_STORE_PATH;
process.env.FACTORY_BUILD_STORE_PATH = SCRATCH_PATH;

before(() => {
  process.env.FACTORY_BUILD_STORE_PATH = SCRATCH_PATH;
});
after(() => {
  process.env.FACTORY_BUILD_STORE_PATH = ORIGINAL_ENV;
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

describe("factoryBuildStore", () => {
  it("upserting a VIN and reading it back returns the same record; a second upsert replaces rather than appends", async () => {
    const vin = "5NMJECDE6TH781852";
    await upsertFactoryBuild(pendingFactoryBuildShell(vin, "first"));
    const first = await getFactoryBuild(vin);
    assert.equal(first?.parse.warnings[0], "first");

    await upsertFactoryBuild(pendingFactoryBuildShell(vin, "second"));
    const second = await getFactoryBuild(vin);
    assert.equal(second?.parse.warnings[0], "second");

    const all = await listFactoryBuilds();
    assert.equal(all.filter((b) => b.vin === vin).length, 1, "one upsert per VIN, never a duplicate row");
  });

  it("a VIN never upserted returns null", async () => {
    assert.equal(await getFactoryBuild("1FTFW1ED5PFA12345"), null);
  });
});
