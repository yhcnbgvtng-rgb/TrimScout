import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QUOTE_SEED_KEY, QUOTE_SEED_MAX, QUOTE_SEED_TTL_MS, durableSeedStore, sanitizeQuoteSeed, seedStoreKey, takeQuoteSeed, writeQuoteSeed } from "./quoteSeed";

const V = (n: number) => `1FTFW1E5XPFA${String(10000 + n)}`.slice(0, 17);
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe("quote seed", () => {
  it("keeps VIN + VDP link, uppercases, dedupes by VIN, caps at 3", () => {
    const s = sanitizeQuoteSeed([{ vin: V(1).toLowerCase(), vdpUrl: "https://a.com/x" }, { vin: V(1), vdpUrl: null }, { vin: V(2), vdpUrl: null }, { vin: V(3), vdpUrl: null }, { vin: V(4), vdpUrl: null }]);
    assert.equal(s.length, QUOTE_SEED_MAX);
    assert.equal(s[0].vin, V(1).toUpperCase());
    assert.equal(s[0].vdpUrl, "https://a.com/x");
  });
  it("drops bad VINs and non-http(s) links but keeps the car", () => {
    const s = sanitizeQuoteSeed([{ vin: "short", vdpUrl: "https://a.com" }, { vin: V(5), vdpUrl: "javascript:alert(1)" }, { vin: V(6), vdpUrl: "not a url" }]);
    assert.deepEqual(s.map((v) => v.vdpUrl), [null, null]);
    assert.equal(s.length, 2);
  });
  it("take reads once and clears, so a refresh never re-seeds", () => {
    const store = mem();
    writeQuoteSeed(store, [{ vin: V(7), vdpUrl: "https://a.com/7" }]);
    assert.ok(store.getItem(QUOTE_SEED_KEY));
    assert.equal(takeQuoteSeed(store).length, 1);
    assert.equal(store.getItem(QUOTE_SEED_KEY), null);
    assert.deepEqual(takeQuoteSeed(store), []);
  });
  it("survives garbage", () => {
    const store = mem(); store.setItem(QUOTE_SEED_KEY, "{oops");
    assert.deepEqual(takeQuoteSeed(store), []);
    assert.deepEqual(sanitizeQuoteSeed(42), []);
  });
});

describe("durable quote seed", () => {
  const car = [{ vin: V(8), vdpUrl: "https://a.com/8" }];
  it("a seed older than the TTL is ignored (and still cleared); a fresh one is read", () => {
    const old = mem(); writeQuoteSeed(old, car, 1_000);
    assert.deepEqual(takeQuoteSeed(old, 1_000 + QUOTE_SEED_TTL_MS + 1), []);
    assert.equal(old.getItem(QUOTE_SEED_KEY), null);
    const fresh = mem(); writeQuoteSeed(fresh, car, 1_000);
    assert.equal(takeQuoteSeed(fresh, 1_000 + QUOTE_SEED_TTL_MS).length, 1);
  });
  it("a seed stamped in the future (clock skew or tampering) is ignored", () => {
    const store = mem(); writeQuoteSeed(store, car, 10 * QUOTE_SEED_TTL_MS);
    assert.deepEqual(takeQuoteSeed(store, 0), []);
  });
  it("a bare list written before the timestamp existed is still read", () => {
    const store = mem(); store.setItem(QUOTE_SEED_KEY, JSON.stringify(car));
    assert.equal(takeQuoteSeed(store).length, 1);
  });
  it("writes to both browser stores, so a cleared or blocked sessionStorage no longer loses it", () => {
    const session = mem(), local = mem();
    const both = durableSeedStore({ sessionStorage: session as never, localStorage: local as never });
    writeQuoteSeed(both, car);
    assert.ok(session.getItem(QUOTE_SEED_KEY) && local.getItem(QUOTE_SEED_KEY));
    session.removeItem(QUOTE_SEED_KEY);
    assert.equal(takeQuoteSeed(durableSeedStore({ sessionStorage: session as never, localStorage: local as never })).length, 1, "read from localStorage");
    assert.equal(local.getItem(QUOTE_SEED_KEY), null, "taking clears both");
  });
  it("a store that throws, or is missing, is skipped", () => {
    const local = mem();
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    const both = durableSeedStore({ sessionStorage: boom as never, localStorage: local as never });
    assert.equal(writeQuoteSeed(both, car).length, 1);
    assert.equal(takeQuoteSeed(both).length, 1);
    assert.deepEqual(takeQuoteSeed(durableSeedStore({})), []);
    const getterThrows = { get sessionStorage(): Storage { throw new Error("denied"); }, localStorage: local as never };
    assert.deepEqual(takeQuoteSeed(durableSeedStore(getterThrows)), []);
  });
  it("seedStoreKey: id wins, else name + state, nameless is null", () => {
    assert.equal(seedStoreKey({ dealerId: "9", dealerName: "A", dealerState: "oh" }), "id:9");
    assert.equal(seedStoreKey({ dealerId: null, dealerName: " A Ford ", dealerState: "oh" }), "n:a ford|OH");
    assert.equal(seedStoreKey({ dealerId: "9", dealerName: " ", dealerState: null }), null);
  });

  it("keeps the search row's trim so the wizard can show it instead of the VIN decoder's spelling", () => {
    const [car] = sanitizeQuoteSeed([{ vin: "3GCUKFE80TG438076", vdpUrl: null, trim: " LT Trail Boss " }]);
    assert.equal(car.trim, "LT Trail Boss");
    assert.equal(sanitizeQuoteSeed([{ vin: "3GCUKFE80TG438076", vdpUrl: null }])[0].trim, null);
  });
});
