import test from "node:test";
import assert from "node:assert/strict";
import { isAccessoryOrSubscription, paidCatalogRows } from "../src/paidCatalogFilter.js";
import { buyerOptionCatalog } from "../src/inventoryOptionRows.js";

const row = (label, n, min, max) => ({ canonical_key: label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), label, vehicleCount: n, min_price: min, max_price: max });

// The 2026 Hyundai Tucson SEL list the live endpoint returned on 2026-10-26.
test("the bad Tucson SEL entries are accessories or subscriptions", () => {
  for (const l of ["Carpeted Floor Mats", "Cargo Net", "First Aid Kit", "Cargo Tray", "Cargo Cover", "Front and Rear Mudguards", "SiriusXM", "Wheel Locks", "Rear Bumper Applique", "All Season Fitted Liners", "Roadside Assistance Kit", "SiriusXM 3-Month Trial Subscription", "Bluelink Connected Care"]) {
    assert.equal(isAccessoryOrSubscription(l), true, l);
  }
});

test("paid factory sticker lines are never matched", () => {
  for (const l of ["Power Sunroof", "Convenience Package", "Premium Package", "Roof Rack Cross Rails", "Heated Front Bucket Seats", "Cargo Area Lighting", "Floor Mat Retention Package", "Wheels: 19\" Alloy", "Panoramic Roof", "Tow Package", "Machine Gray Paint"]) {
    assert.equal(isAccessoryOrSubscription(l), false, l);
  }
});

test("paidCatalogRows keeps only priced, non-accessory rows and leaves their order alone", () => {
  const rows = [
    row("Carpeted Floor Mats", 1546, 135, 135),
    row("Power Sunroof", 621, 1200, 1200),
    row("Radio: AM/FM/HD Audio System", 1035, null, null),
    row("SiriusXM", 698, 0, 0),
    row("SiriusXM", 5, 200, 200),
    row("Convenience Package", 453, 1000, 1400),
    row("Zero Item", 90, 0, 0),
  ];
  assert.deepEqual(paidCatalogRows(rows).map((r) => r.label), ["Power Sunroof", "Convenience Package"]);
});

test("through buyerOptionCatalog: price range kept, most common first, dropped rows use no slot", () => {
  const out = buyerOptionCatalog(paidCatalogRows([
    row("Cargo Net", 1283, 50, 50),
    row("Convenience Package", 453, 1000, 1400),
    row("Power Sunroof", 621, 1200, 1200),
  ]));
  assert.deepEqual(out.map((o) => [o.label, o.vehicleCount, o.minPrice, o.maxPrice]), [["Power Sunroof", 621, 1200, 1200], ["Convenience Package", 453, 1000, 1400]]);
});
