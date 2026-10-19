import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { env } from "node:process";
import { getLightsailHost, LightsailConfigError } from "./lightsailClient";
import { fullPageSize, hasDumpSecret, LIGHTSAIL_SECRET_HEADER, PUBLIC_MAX_WINDOW, PUBLIC_PAGE_SIZE_MAX, publicVehicleWindow, secretMatches } from "./lightsailAccess";

describe("secret header", () => {
  it("matches only the exact secret", () => {
    assert.equal(secretMatches("s3cret-value", "s3cret-value"), true);
    assert.equal(secretMatches("s3cret-valuX", "s3cret-value"), false);
    assert.equal(secretMatches("short", "s3cret-value"), false);
  });
  it("never matches when the server secret is unset or blank, or the header is missing", () => {
    assert.equal(secretMatches("anything", undefined), false);
    assert.equal(secretMatches("", ""), false);
    assert.equal(secretMatches("  ", "  "), false);
    assert.equal(secretMatches(null, "s3cret-value"), false);
  });
  it("reads the named header", () => {
    assert.equal(hasDumpSecret(new Headers({ [LIGHTSAIL_SECRET_HEADER]: "abc" }), "abc"), true);
    assert.equal(hasDumpSecret(new Headers(), "abc"), false);
    assert.equal(hasDumpSecret(new Headers({ [LIGHTSAIL_SECRET_HEADER]: "abc" }), undefined), false);
  });
});

describe("public page window", () => {
  it("defaults to a small page", () => {
    assert.deepEqual(publicVehicleWindow({}), { ok: true, page: 1, pageSize: 25 });
  });
  it("hard-caps pageSize regardless of what is asked", () => {
    for (const raw of ["200", "1000", "999999", "51"]) {
      const w = publicVehicleWindow({ pageSize: raw });
      assert.ok(w.ok && w.pageSize <= PUBLIC_PAGE_SIZE_MAX, raw);
    }
  });
  it("treats junk as the default", () => {
    assert.deepEqual(publicVehicleWindow({ pageSize: "abc", page: "-4" }), { ok: true, page: 1, pageSize: 25 });
    assert.deepEqual(publicVehicleWindow({ pageSize: "0" }), { ok: true, page: 1, pageSize: 25 });
  });
  it("refuses to page beyond the window, so the table can't be walked out", () => {
    assert.equal(publicVehicleWindow({ pageSize: "50", page: "10" }).ok, true);
    assert.equal(PUBLIC_MAX_WINDOW, 500);
    assert.equal(publicVehicleWindow({ pageSize: "50", page: "11" }).ok, false);
    assert.equal(publicVehicleWindow({ pageSize: "25", page: "21" }).ok, false);
    assert.equal(publicVehicleWindow({ page: "99999" }).ok, false);
  });
});

describe("full-access page size keeps the old behaviour", () => {
  it("defaults to 50 and caps at 200", () => {
    assert.equal(fullPageSize(undefined), 50);
    assert.equal(fullPageSize("120"), 120);
    assert.equal(fullPageSize("5000"), 200);
  });
});

describe("getLightsailHost — environment only, no hardcoded fallback", () => {
  const saved = { ip: env.LIGHTSAIL_IP, host: env.LIGHTSAIL_HOST };
  const restore = () => {
    if (saved.ip === undefined) delete env.LIGHTSAIL_IP; else env.LIGHTSAIL_IP = saved.ip;
    if (saved.host === undefined) delete env.LIGHTSAIL_HOST; else env.LIGHTSAIL_HOST = saved.host;
  };
  it("fails with a clear error when unset or blank", () => {
    delete env.LIGHTSAIL_IP; delete env.LIGHTSAIL_HOST;
    try {
      assert.throws(() => getLightsailHost(), (e: unknown) => e instanceof LightsailConfigError && /LIGHTSAIL_IP/.test((e as Error).message));
      env.LIGHTSAIL_IP = "   ";
      assert.throws(() => getLightsailHost(), LightsailConfigError);
    } finally { restore(); }
  });
  it("reads LIGHTSAIL_IP first, then LIGHTSAIL_HOST", () => {
    try {
      env.LIGHTSAIL_IP = "203.0.113.7"; env.LIGHTSAIL_HOST = "203.0.113.8";
      assert.equal(getLightsailHost(), "203.0.113.7");
      delete env.LIGHTSAIL_IP;
      assert.equal(getLightsailHost(), "203.0.113.8");
    } finally { restore(); }
  });
});
