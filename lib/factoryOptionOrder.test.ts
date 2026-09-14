import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { orderFactoryOptions } from "./factoryOptionOrder";
import { EXTERIOR_COLOR_LABEL, INTERIOR_COLOR_LABEL, exteriorColorMustHaveName, interiorColorMustHaveName } from "./fordSticker";

describe("must-have picker order — exterior color, interior color, then options by price (highest first) then name", () => {
  it("puts the colors first in that order whatever the input order, then price desc, then A–Z", () => {
    const input = [
      { name: "Trailer Tow Package", price: 1495 },
      { name: interiorColorMustHaveName("Black Onyx"), price: null },
      { name: "Sasquatch Package", price: 4995 },
      { name: "Bed Liner", price: 595 },
      { name: exteriorColorMustHaveName("Cactus Gray"), price: null },
      { name: "All-Weather Floor Liners", price: 595 },
      { name: "Wheel Locks", price: 0 },
      { name: "Cargo Net", price: null },
    ];
    assert.deepEqual(orderFactoryOptions(input).map((o) => o.name), [
      exteriorColorMustHaveName("Cactus Gray"),
      interiorColorMustHaveName("Black Onyx"),
      "Sasquatch Package",
      "Trailer Tow Package",
      "All-Weather Floor Liners",
      "Bed Liner",
      "Cargo Net",
      "Wheel Locks",
    ]);
  });
  it("does not mutate the input and is stable for equal price + name", () => {
    const input = [{ name: "B", price: 1 }, { name: "A", price: 1 }];
    const out = orderFactoryOptions(input);
    assert.deepEqual(input.map((o) => o.name), ["B", "A"]);
    assert.deepEqual(out.map((o) => o.name), ["A", "B"]);
  });
  it("the color prefixes match the sticker labels exactly", () => {
    assert.equal(`${EXTERIOR_COLOR_LABEL}:`, "Exterior color:");
    assert.equal(`${INTERIOR_COLOR_LABEL}:`, "Interior color:");
  });
  it("wiring: the wizard's picker renders orderFactoryOptions(options)", () => {
    const w = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
    assert.match(w, /orderFactoryOptions\(options\)\.map\(\(opt\) =>/);
  });
});
