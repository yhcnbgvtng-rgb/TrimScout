import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QUOTE_SEED_KEY, QUOTE_SEED_MAX, sanitizeQuoteSeed, takeQuoteSeed, writeQuoteSeed } from "./quoteSeed";

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
