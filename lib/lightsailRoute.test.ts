import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { env } from "node:process";
import fs from "node:fs";
import { GET } from "../app/api/lightsail/route";
import { LIGHTSAIL_SECRET_HEADER } from "./lightsailAccess";

// The route's data tiers all fail soft to committed fixtures offline, which is
// what we want here: these tests are about who gets what, not about the data.
const realFetch = globalThis.fetch;
const saved = { ip: env.LIGHTSAIL_IP, host: env.LIGHTSAIL_HOST, key: env.LIGHTSAIL_API_KEY, dump: env.LIGHTSAIL_DUMP_SECRET };
let ipCounter = 0;
const req = (qs: string, headers: Record<string, string> = {}) =>
  new Request(`https://www.trimscout.com/api/lightsail${qs}`, { headers: { "x-forwarded-for": `198.51.100.${(ipCounter = (ipCounter % 250) + 1)}`, ...headers } });

beforeEach(() => {
  delete env.LIGHTSAIL_IP; delete env.LIGHTSAIL_HOST; delete env.LIGHTSAIL_API_KEY;
  env.LIGHTSAIL_DUMP_SECRET = "test-dump-secret-value";
  globalThis.fetch = (async () => { throw new Error("no network in tests"); }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [["LIGHTSAIL_IP", saved.ip], ["LIGHTSAIL_HOST", saved.host], ["LIGHTSAIL_API_KEY", saved.key], ["LIGHTSAIL_DUMP_SECRET", saved.dump]] as const) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
});

describe("GET /api/lightsail — the bare dump is no longer public", () => {
  it("refuses the default (summary) action without a secret or admin session", async () => {
    const res = await GET(req(""));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).recentVehicles, undefined);
  });
  it("refuses an explicit summary and any unknown action (which used to fall through to the dump)", async () => {
    assert.equal((await GET(req("?action=summary"))).status, 401);
    assert.equal((await GET(req("?action=whatever"))).status, 401);
    assert.equal((await GET(req("?action="))).status, 401);
  });
  it("refuses a wrong secret", async () => {
    assert.equal((await GET(req("", { [LIGHTSAIL_SECRET_HEADER]: "nope" }))).status, 401);
  });
  it("refuses an empty secret header even when the server secret is unset", async () => {
    delete env.LIGHTSAIL_DUMP_SECRET;
    assert.equal((await GET(req("", { [LIGHTSAIL_SECRET_HEADER]: "" }))).status, 401);
  });
  it("gives the full dump to the secret header, with no box host in it", async () => {
    const res = await GET(req("", { [LIGHTSAIL_SECRET_HEADER]: "test-dump-secret-value" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.recentVehicles));
    assert.equal("serverHost" in body, false);
  });
});

describe("GET /api/lightsail?action=vehicles — the public tier is retired", () => {
  it("answers 410 to public vehicles and facets calls, with no rows", async () => {
    for (const q of ["?action=vehicles", "?action=vehicles&pageSize=5000", "?action=facets"]) {
      const res = await GET(req(q));
      assert.equal(res.status, 410);
      const body = await res.json();
      assert.equal(body.vehicles, undefined);
    }
  });
  it("lets the secret holder use a bigger page, capped at 200", async () => {
    const body = await (await GET(req("?action=vehicles&pageSize=5000", { [LIGHTSAIL_SECRET_HEADER]: "test-dump-secret-value" }))).json();
    assert.ok(body.pagination.pageSize > 50 && body.pagination.pageSize <= 200);
  });
  it("never returns the box host", async () => {
    const text = await (await GET(req("?action=vehicles", { [LIGHTSAIL_SECRET_HEADER]: "test-dump-secret-value" }))).text();
    assert.equal(text.includes("serverHost"), false);
  });
});

describe("no box address is committed in the route or client source", () => {
  it("has no IPv4 literal", () => {
    for (const f of ["app/api/lightsail/route.ts", "lib/lightsailClient.ts"]) {
      assert.doesNotMatch(fs.readFileSync(f, "utf8"), /\b(?:\d{1,3}\.){3}\d{1,3}\b/, f);
    }
  });
  it("does not import the checked-in boxes config as a host fallback", () => {
    assert.doesNotMatch(fs.readFileSync("lib/lightsailClient.ts", "utf8"), /boxes\.json/);
  });
});
