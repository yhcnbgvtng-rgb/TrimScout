import test from "node:test";
import assert from "node:assert/strict";
import { isAccessoryOrSubscription, paidCatalogRows } from "../src/paidCatalogFilter.js";
import { buyerOptionCatalog } from "../src/inventoryOptionRows.js";

const row = (label, n, min, max) => ({ canonical_key: label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), label, vehicleCount: n, min_price: min, max_price: max });

// Labels from the 2026-10-26 read-only probe on box2 (docs/probe-2026-10-26): Hyundai Tucson SEL, Toyota RAV4 XLE, Chevrolet Silverado 1500 LT.
const DROPPED = [
  // Hyundai
  "Carpeted Floor Mats", "Cargo Net", "First Aid Kit", "Cargo Tray", "Cargo Cover", "Front and Rear Mudguards", "Mudguards", "MUD GUARDS", "Rear Bumper Applique", "Wheel Locks",
  "All Season Fitted Liners", "Roadside Assistance Kit", "Cargo Organizer", "Tow Hitch", "Cargo Package", "Illuminated Door Sill Plates", "All Weather Floor Mats",
  "Roof Rack Cross Rails", "Cross Rails", "CARGO BLOCKS", "Illuminated Door Sills", "Severe Weather Kit", "Reversible Cargo Tray", "Ball Mount Kit", "Side Steps", "Winter Package",
  "SiriusXM", "3-Months SiriusXM Trial Subscription", "SiriusXM satellite radio", "Bluelink Connected Care",
  // Toyota
  "All Weather Liner Package", "Roof Rack Cross Bars", "Roof Rails", "Tonneau Cover", "Door Edge Guards", "Door Edge Guard", "Mudguard", "Cargo Liner", "Alloy Wheel Locks",
  "Carpet Floor Mats & Carpet Cargo Mat", "Carpet Mat Package", "All Weather Floor Liners and Cargo Liner", "Body Side Moldings", "Body Side Molding", "Blackout Emblem Overlays", "FOG LIGHT ACCENT",
  // Chevrolet
  "All-Weather Floor Liner", "Spray-On Pickup Box Bed Liner", "Bed Liner", "Liner Protection Package", "Chrome Assist Steps", "Front License Plate Bracket", "Spare Tire Lock", "Front Black Bowtie Emblem",
  "All Weather Floor Mats & Cargo Tray", "All Weather Floor Liners & Cargo Tray", "Front & Rear All-Weather Floor Mats", "Rear Bumper Protector", "Wheel Lock",
  "Color-Keyed Carpeting w/Rubberized Vinyl Floormats",
];
const KEPT = [
  // Hyundai
  "Convenience Package", "Convenience + Premium Package", "Tow and Go Package",
  // Toyota
  "Weather Package", "XLE Grade Weather Package", "Plus Extra Value Package", "Power Plus Extra Value Package", "Power Premium Extra Value Package", "Front & Back Clearance Sonar",
  "Radio: Entune Display Audio", "Driver & Front Passenger Heated Seats", "Cold Weather Package", "SPECIAL COLOR", "Height-Adjustable Power Liftgate", "FRAMELESS HOMELINK MIRROR",
  // Chevrolet
  "Trailering Package", "Trailering Equipment", "Heavy-Duty Trailering Package", "Advanced Trailering Package", "CONVENIENCE PACKAGE II", "All-Star Edition", "All Star Edition Plus", "Z71 Off-Road Package",
  "Z71 Off-Road & Protection Package", "Remote Start Package", "Heavy-Duty Rear Locking Differential", "Heavy-Duty Rear Automatic Locking Differential", "Engine: 5.3L EcoTec3 V8",
  "Wheels: 20\" x 9\" Painted Aluminum", "Wheels: 18\" x 8.5\" Bright Silver Painted Aluminum", "Tires: 275/60R20SL AT BW", "Tires: P265/65R18 AT BW", "Leather Package", "Engine Block Heater",
  "Integrated Trailer Brake Controller", "PROTECTION PACKAGE", "Bed Protection Package", "Texas Edition Plus", "LT Plus Package", "Off-Road Suspension Package", "Safety Package", "Rear Vision Camera",
  "Heated Driver & Front Passenger Seats", "110-Volt AC Power Outlet", "Thin Profile LED Fog Lamps", "Skid Plate Package", "Winter Weather Package",
];

test("every accessory and subscription from the probe is dropped", () => {
  for (const l of DROPPED) assert.equal(isAccessoryOrSubscription(l), true, l);
});

test("every paid factory option from the probe is kept", () => {
  for (const l of KEPT) assert.equal(isAccessoryOrSubscription(l), false, l);
});

test("the protected list wins over every accessory pattern", () => {
  for (const l of ["Weather Package", "XLE Grade Weather Package", "Engine Block Heater", "Premium Package", "Convenience Package", "Trailering Package", "Leather Package"]) assert.equal(isAccessoryOrSubscription(l), false, l);
  // a mat/liner package that merely mentions "premium" is still an accessory
  assert.equal(isAccessoryOrSubscription("Premium Carpet Mat Package"), true);
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
