// A stored trade-in can be partial (older build, script, unfinished draft). Regression: the SAFE MODE test request RFQ 42
// was stored with only year/make/model/mileage/payoffEstimate/photos, and the buyer's trade summary threw
// "Cannot read properties of undefined (reading 'filter')" -> "Application error: a client-side exception".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { coerceTradeIn } from "./coerce";
import { parseTradeFields } from "./validate";
import { TradeSummary } from "../../components/trade/TradeSummary";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import RouteError from "../../app/error";
import { asRfq, asRfqs } from "../rfqApi";

// The exact record stored on the live box for RFQ 42 (662 characters).
const RFQ42 = {
  year: 2019, make: "Toyota", model: "Camry", mileage: 48000, payoffEstimate: 4000,
  photos: ["front", "rear", "driver_side", "passenger_side", "odometer", "interior"].map((slot) => ({ slot, storageKey: `trade/42/safe-mode-${slot}.jpg`, contentType: "image/jpeg" })),
};

describe("coerceTradeIn", () => {
  it("returns null for anything that is not a record", () => {
    for (const v of [null, undefined, "x", 5, [], true]) assert.equal(coerceTradeIn(v), null);
  });

  it("turns RFQ 42's partial record into a complete one with neutral defaults", () => {
    const t = coerceTradeIn(RFQ42)!;
    assert.deepEqual(t.options, []);
    assert.equal(t.conditionBand, "good");
    assert.equal(t.titleStatus, "not_sure");
    assert.equal(t.ownership, "owned");
    assert.equal(t.keys, "1");
    assert.equal(t.historyFlag, "no");
    assert.equal(t.drivetrain, null);
    assert.equal(t.intent, "apply_to_deal");
    assert.equal(t.odometerConfirmed, false);
    assert.equal(t.year, 2019);
    assert.equal(t.mileage, 48000);
    assert.equal(t.photos.length, 6);
    assert.ok(t.photos.every((p) => p.required));
  });

  it("drops unknown enum values, bad photos and duplicate slots without throwing", () => {
    const t = coerceTradeIn({
      conditionBand: "mint", titleStatus: 7, ownership: {}, options: ["awd", "nope", "awd", 5], mileage: "12,000", year: "abc",
      photos: [{ slot: "front", storageKey: "k1" }, { slot: "front", storageKey: "k2" }, { slot: "roof", storageKey: "k3" }, { slot: "rear" }, null, "x"],
    })!;
    assert.equal(t.conditionBand, "good");
    assert.equal(t.titleStatus, "not_sure");
    assert.equal(t.ownership, "owned");
    assert.deepEqual(t.options, ["awd"]);
    assert.equal(t.year, null);
    assert.equal(t.mileage, 0);
    assert.deepEqual(t.photos.map((p) => p.storageKey), ["k1"]);
  });

  it("leaves a complete, validated record unchanged", () => {
    const parsed = parseTradeFields({
      vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", trim: "EX", mileage: 40000, zip: "07030", conditionBand: "fair", titleStatus: "clean",
      ownership: "financed", lenderName: "Test Bank", payoffEstimate: 9000, keys: "2+", historyFlag: "no", drivetrain: "awd", options: ["sunroof", "tow_package"],
      odometerConfirmed: true, intent: "sell_outright", extColor: "Blue", warningLights: { on: true, which: "TPMS" },
    }, new Date("2026-10-13T12:00:00Z"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const full = { ...parsed.fields, photos: [], createdAt: "2026-10-13T12:00:00.000Z", updatedAt: "2026-10-13T12:05:00.000Z" };
    assert.deepEqual(coerceTradeIn(full), { ...full, photosChangedAt: null });
  });

  it("never invents contact details", () => {
    const t = coerceTradeIn({ lenderName: "<script>", historyNotes: "call me", phone: "5551212", email: "a@b.co" })!;
    assert.equal("phone" in t, false);
    assert.equal("email" in t, false);
  });
});

describe("TradeSummary with partial records", () => {
  const signed = RFQ42.photos.map((p) => ({ slot: p.slot as never, label: p.slot, required: true, url: `https://example.test/${p.slot}.jpg` }));

  it("renders RFQ 42's record instead of throwing", () => {
    const html = renderToStaticMarkup(<TradeSummary trade={RFQ42 as never} signed={signed} />);
    assert.match(html, /2019 Toyota Camry/);
    assert.match(html, /48,000 mi/);
    assert.match(html, /data-testid="trade-summary"/);
    assert.match(html, /None listed/);
  });

  it("shows a quiet message for a missing record and tolerates missing photo urls", () => {
    assert.match(renderToStaticMarkup(<TradeSummary trade={null} signed={[]} />), /trade-summary-empty/);
    assert.match(renderToStaticMarkup(<TradeSummary trade={RFQ42 as never} signed={undefined as never} />), /data-testid="trade-summary"/);
  });
});

describe("asRfq / asRfqs", () => {
  it("coerces a partial trade-in on every request read from the box", () => {
    const r = asRfq({ id: "42", tradeIn: RFQ42, invites: [] });
    assert.deepEqual(r.tradeIn!.options, []);
    assert.equal(r.tradeIn!.conditionBand, "good");
  });
  it("passes requests without a trade-in through untouched, and survives junk", () => {
    const plain = { id: "1", tradeIn: null };
    assert.equal(asRfq(plain), plain);
    assert.equal(asRfq(undefined), undefined);
    assert.deepEqual(asRfqs(undefined), []);
    assert.equal(asRfqs([{ id: "a", tradeIn: RFQ42 }])[0].tradeIn!.conditionBand, "good");
  });
});

describe("error boundaries", () => {
  it("catches a render error and shows the fallback (state)", () => {
    assert.deepEqual(ErrorBoundary.getDerivedStateFromError(), { failed: true });
    const b = new ErrorBoundary({ children: <span>ok</span> });
    assert.match(renderToStaticMarkup(b.render() as React.ReactElement), /ok/);
    b.state = { failed: true };
    assert.match(renderToStaticMarkup(b.render() as React.ReactElement), /data-testid="section-error"/);
    const custom = new ErrorBoundary({ children: <span>ok</span>, fallback: <i>custom</i> });
    custom.state = { failed: true };
    assert.match(renderToStaticMarkup(custom.render() as React.ReactElement), /custom/);
  });

  it("resets when the resetKey changes", () => {
    const b = new ErrorBoundary({ children: <span>ok</span>, resetKey: 1 });
    let next: unknown = null;
    b.setState = ((s: unknown) => { next = s; }) as never;
    b.state = { failed: true };
    Object.assign(b, { props: { children: <span>ok</span>, resetKey: 2 } });
    b.componentDidUpdate({ resetKey: 1 });
    assert.deepEqual(next, { failed: false });
  });

  it("the route-level fallback renders a retry and a way home", () => {
    const html = renderToStaticMarkup(<RouteError error={new Error("boom")} reset={() => undefined} />);
    assert.match(html, /data-testid="route-error"/);
    assert.match(html, /Try again/);
    assert.match(html, /href="\/"/);
  });
});
