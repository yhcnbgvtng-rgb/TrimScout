import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_MUST_CONFIRM_DRAFT, MUST_CONFIRM_COPY, buildMustConfirmList, parseMustConfirmAcks, parseMustConfirmList, parseTags, validateMustConfirmAcks } from "./mustConfirm";

describe("used must-confirm checklist — buyer asks, dealer confirms or says why not", () => {
  it("builds labelled items from the Step 1 draft; blank asks are left out", () => {
    const items = buildMustConfirmList({ cleanTitle: true, maxMiles: "40,000", drivetrain: "AWD", cpoWarranty: true, tags: ["Panoramic roof", "Tow package"] });
    assert.deepEqual(items.map((i) => [i.id, i.label]), [
      ["clean_title", "Clean title"], ["miles_under", "Under 40,000 miles"], ["drivetrain", "AWD"], ["cpo_warranty", "CPO / remaining factory warranty"], ["tag_1", "Panoramic roof"], ["tag_2", "Tow package"],
    ]);
    assert.deepEqual(buildMustConfirmList({ ...EMPTY_MUST_CONFIRM_DRAFT, cleanTitle: false }), []);
    assert.deepEqual(buildMustConfirmList({ ...EMPTY_MUST_CONFIRM_DRAFT, maxMiles: "abc" }).map((i) => i.id), ["clean_title"]);
  });
  it("tags: split on commas/semicolons/newlines, trimmed, deduped, capped", () => {
    assert.deepEqual(parseTags("panoramic roof, tow package; heated seats,,  Panoramic Roof "), ["panoramic roof", "tow package", "heated seats"]);
    assert.equal(parseTags(Array.from({ length: 12 }, (_, i) => `tag ${i}`).join(",")).length, 8);
  });
  it("round-trips through storage without trusting it", () => {
    const items = buildMustConfirmList({ ...EMPTY_MUST_CONFIRM_DRAFT, maxMiles: "50000", tags: ["Tow package"] });
    assert.deepEqual(parseMustConfirmList(JSON.parse(JSON.stringify(items))), items);
    assert.deepEqual(parseMustConfirmList([{ id: "x y", key: "tag", label: "bad id" }, { id: "ok", key: "nope", label: "bad key" }, "junk"]), []);
  });
  it("dealer acks: every item confirmed, or cannot-confirm with a note; missing ones are named", () => {
    const items = buildMustConfirmList({ cleanTitle: true, maxMiles: "40000", drivetrain: "", cpoWarranty: false, tags: ["Tow package"] });
    assert.deepEqual(validateMustConfirmAcks(items, []), [
      'Confirm "Clean title", or mark that you can\'t and say why.',
      'Confirm "Under 40,000 miles", or mark that you can\'t and say why.',
      'Confirm "Tow package", or mark that you can\'t and say why.',
    ]);
    const acks = parseMustConfirmAcks([{ id: "clean_title", status: "confirmed" }, { id: "miles_under", status: "cannot_confirm", note: "" }, { id: "tag_1", status: "cannot_confirm", note: "No hitch on this one" }, { id: "ghost", status: "confirmed" }], items);
    assert.equal(acks.length, 3, "unknown ids dropped");
    assert.deepEqual(validateMustConfirmAcks(items, acks), ['"Under 40,000 miles" — a short note is needed when you can\'t confirm it.']);
    assert.deepEqual(validateMustConfirmAcks(items, [...acks.filter((a) => a.id !== "miles_under"), { id: "miles_under", status: "cannot_confirm", note: "Shows 41,200" }]), []);
  });
  it("copy", () => {
    assert.equal(MUST_CONFIRM_COPY, "Ask the dealer to confirm — not a factory option match.");
  });
});

import fs from "node:fs";
import path from "node:path";

describe("wiring — used shows the must-confirm checklist, new keeps factory must-haves", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("Step 1: checklist editor only when used; factory must-have picker still gated on a released sticker", () => {
    const w = read("components/BiddingWizard.tsx");
    assert.match(w, /\{isUsed && selectedVehicle \? \(\s*<div[^>]*data-testid="must-confirm-editor"/);
    assert.match(w, /\{MUST_CONFIRM_COPY\}/);
    assert.match(w, /fordStickerStatus === "released" && fordFilterableOptions\.length > 0 && \(/);
    assert.match(w, /mustConfirm: buildMustConfirmList\(mustConfirm\)/);
  });
  it("the checklist rides on the request, shows on the deal page and the dealer's page", () => {
    assert.match(read("lib/quotePackage.ts"), /mustConfirm\?: Array<\{ id: string; key: string; label: string/);
    assert.match(read("lib/rfqTracker.ts"), /mustConfirm: parseMustConfirmList\(p\.mustConfirm\)/);
    assert.match(read("app/rfq/[id]/page.tsx"), /data-testid="used-ask-sheet"[\s\S]*?<MustConfirmList items=\{v\.mustConfirm\}/);
    assert.match(read("app/api/quote-invite/context/route.ts"), /mustConfirm: usedCar\?\.mustConfirm \|\| \[\]/);
    assert.match(read("app/quote-request/received/page.tsx"), /data-testid="dealer-must-confirm"[\s\S]*?<MustConfirmList items=\{ctx\.mustConfirm\} compact \/>/);
  });
});
