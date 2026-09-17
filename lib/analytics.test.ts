import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { factoryBuildPendingProps, hostOf, isTrackedEvent, trackEvent, vinPrefix } from "./analytics";

describe("analytics — factory_build_pending { make, vinPrefix, dealerHost }", () => {
  it("never carries the full VIN: the prefix stops before the serial", () => {
    assert.equal(vinPrefix("3HDSA2H70TM713712"), "3HDSA2H70TM");
    assert.equal(vinPrefix("short"), null);
    assert.equal(hostOf("https://www.keyacuraofatlanticcity.com/new/Acura/x.htm"), "keyacuraofatlanticcity.com");
    assert.equal(hostOf(null), null);
    assert.equal(hostOf("not a url"), null);
    assert.deepEqual(factoryBuildPendingProps({ vin: "3HDSA2H70TM713712", make: "Acura", dealerUrl: "https://www.keyacuraofatlanticcity.com/new/Acura/x.htm" }), { make: "Acura", vinPrefix: "3HDSA2H70TM", dealerHost: "keyacuraofatlanticcity.com" });
  });
  it("beacons to /api/events/track and logs one greppable line", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), body: String(init?.body) }); return new Response("{}"); }) as typeof fetch;
    const lines: string[] = [];
    const info = console.info;
    console.info = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      trackEvent("factory_build_pending", { make: "Acura", vinPrefix: "3HDSA2H70TM", dealerHost: "keyacuraofatlanticcity.com" }, fetchImpl);
    } finally {
      console.info = info;
    }
    assert.equal(calls[0].url, "/api/events/track");
    assert.deepEqual(JSON.parse(calls[0].body), { name: "factory_build_pending", props: { make: "Acura", vinPrefix: "3HDSA2H70TM", dealerHost: "keyacuraofatlanticcity.com" } });
    assert.match(lines[0], /^\[trimscout:event\] \{"event":"factory_build_pending","make":"Acura"/);
    assert.equal(isTrackedEvent("factory_build_pending"), true);
    assert.equal(isTrackedEvent("drop table"), false);
  });
});
