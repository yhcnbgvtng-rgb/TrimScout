import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  HYUNDAI_STICKER_PENDING_COPY,
  clearHyundaiStickerMemoryCache,
  decodeDealerFireBody,
  filterableHyundaiOptions,
  getHyundaiSticker,
  hyundaiDealerFireUrl,
  hyundaiStickerToVehicle,
  parseHyundaiHeadline,
  parseHyundaiStickerText,
} from "./hyundaiSticker";
import type { GenesisSticker } from "./genesisSticker";

const TUCSON = "5NMJECDE6TH781852";
const fixture = fs.readFileSync(path.join(process.cwd(), "lib/testdata/hyundai-stickers", `${TUCSON}.txt`), "utf8");
// A tiny valid-looking PDF body whose text extraction we never run — the fetch tests stub the parse by VIN mismatch / not-found paths.
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const resp = (body: string | Uint8Array, contentType = "application/pdf", status = 200) => ({ bytes: typeof body === "string" ? new Uint8Array(Buffer.from(body, "latin1")) : body, contentType, status });

describe("Hyundai factory sticker — parse (real 2026 Tucson Limited AWD label from DealerFire)", () => {
  const s = parseHyundaiStickerText(TUCSON, fixture);
  it("reads year / model / trim / drivetrain from the headline, colors, prices, sold-to and added features", () => {
    assert.equal(s.status, "released");
    assert.equal(s.make, "Hyundai");
    assert.equal(s.year, 2026);
    assert.equal(s.model, "Tucson");
    assert.equal(s.trim, "Limited");
    assert.equal(s.drivetrain, "AWD");
    assert.equal(s.exteriorColor, "Atlantis Blue");
    assert.equal(s.interiorColor, "Gray/Gray");
    assert.equal(s.basePrice, 41175);
    assert.equal(s.destination, 1650);
    assert.equal(s.msrp, 44110, "Total Price with a space before the colon");
    assert.deepEqual(s.dealerSoldTo, { name: "MOTORWORLD HYUNDAI", address: "150 MOTORWORLD DR.", city: "WILKES-BARRE", state: "PA", zip: "18702", source: "sticker" });
    assert.equal(s.options.length, 8);
    assert.deepEqual(s.options[0], { name: "Cross Rails (dealer Install)".replace("(dealer", "(Dealer"), price: 375, isStandard: false, isPackageChild: false, source: "sticker" });
    assert.ok(s.standardEquipment.includes("Highway Driving Assist"));
    assert.ok(!s.standardEquipment.some((l) => /^AMERICA'S BEST WARRANTY$/i.test(l)));
    assert.equal(s.pdfUrl, hyundaiDealerFireUrl(TUCSON));
  });
  it("a label whose text never mentions the requested VIN is not this car's — never Factory verified", () => {
    assert.equal(parseHyundaiStickerText("5NMJECDE6TH000001", fixture).status, "error");
  });
  it("headline shapes", () => {
    assert.deepEqual(parseHyundaiHeadline("2026 SANTA FE HYBRID CALLIGRAPHY AWD\nVIN: X"), { year: 2026, model: "Santa Fe Hybrid", trim: "Calligraphy", drivetrain: "AWD" });
    assert.deepEqual(parseHyundaiHeadline("2025 IONIQ 5 SEL\n"), { year: 2025, model: "Ioniq 5", trim: "Sel", drivetrain: undefined });
    assert.deepEqual(parseHyundaiHeadline("no headline"), {});
  });
  it("vehicle: Hyundai id, sticker MSRP, sold-to dealer unconfirmed; picker = colors then added features", () => {
    const v = hyundaiStickerToVehicle(s, null, null, null);
    assert.equal(v.id, `hyundai-${TUCSON}`);
    assert.equal(v.make, "Hyundai");
    assert.equal(v.msrp, 44110);
    assert.equal(v.location.dealerName, "MOTORWORLD HYUNDAI");
    assert.equal(v.location.dealerConfirmed, false);
    const names = filterableHyundaiOptions(s).map((o) => o.name);
    assert.equal(names[0], "Exterior color: Atlantis Blue");
    assert.equal(names[1], "Interior color: Gray/Gray");
    assert.ok(names.includes("Cross Rails (Dealer Install)"));
  });
});

describe("Hyundai factory sticker — DealerFire body decoding", () => {
  it("base64 PDF → pdf; base64 JSON miss → not_found; HTML → denied; raw PDF passes through", () => {
    assert.equal(decodeDealerFireBody(new Uint8Array(Buffer.from(b64("%PDF-1.3 fake"), "latin1"))).kind, "pdf");
    assert.equal(decodeDealerFireBody(new Uint8Array(Buffer.from(b64('{\n  "error": "NEW document not found for VIN 5NMJECDE6TH000001",\n  "statusCode": 404\n}'), "latin1"))).kind, "not_found");
    assert.equal(decodeDealerFireBody(new Uint8Array(Buffer.from("<!DOCTYPE html><html>denied</html>", "latin1"))).kind, "denied");
    assert.equal(decodeDealerFireBody(new Uint8Array(Buffer.from("%PDF-1.3 raw", "latin1"))).kind, "pdf");
  });
});

describe("Hyundai factory sticker — fetch order and pending state", () => {
  it("DealerFire miss + OEM wall + non-5NM VIN → sticker pending (unreleased, not an error), nothing cached", async () => {
    clearHyundaiStickerMemoryCache();
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.includes("dealerfire")) return resp(b64('{"error":"NEW document not found for VIN KM8RKES23TU000001","statusCode":404}'));
      return resp("<!DOCTYPE html>403", "text/html", 403);
    };
    const s = await getHyundaiSticker("KM8RKES23TU000001", { fetchImpl });
    assert.equal(s.status, "unreleased");
    assert.equal(s.note, HYUNDAI_STICKER_PENDING_COPY);
    assert.deepEqual(calls.map((u) => new URL(u).host), ["hyundai-sticker.dealerfire.com", "prevapp.hyundaiusa.com"], "strict order: DealerFire, then Hyundai's own endpoint; Genesis not asked for a KM8 VIN");
    // A second call asks DealerFire again — misses are the retry, never a
    // cached "no". The OEM host answered 403, so its circuit is open and it
    // is skipped this time (see spikeHardening.test.ts).
    await getHyundaiSticker("KM8RKES23TU000001", { fetchImpl });
    assert.equal(calls.length, 3);
  });
  it("a 5NM VIN with no Hyundai label falls through to Genesis's sticker host", async () => {
    clearHyundaiStickerMemoryCache();
    const fetchImpl = async (url: string) => (url.includes("dealerfire") ? resp(b64('{"error":"NEW document not found","statusCode":404}')) : resp("<!DOCTYPE html>", "text/html", 403));
    const gv70: GenesisSticker = { vin: "5NMJB3AE1SH123456", status: "released", make: "Genesis", model: "GV70", year: 2026, msrp: 60000, basePrice: 58000, optionsPrice: 0, destination: 2000, options: [], standardEquipment: [], rawText: "", pdfUrl: "https://www.genesis.com/x", fetchedAt: "" };
    const s = await getHyundaiSticker("5NMJB3AE1SH123456", { fetchImpl, genesis: async () => gv70 });
    assert.equal(s.status, "released");
    assert.equal(s.make, "Genesis");
    assert.equal(s.source, "genesis");
  });
});

describe("wiring — brand gate, route, and the no-sticker-warning rule", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("the Hyundai route reads DealerFire first, never a dealer page; a pending sticker imports on the free decode with stickerPending", () => {
    const r = read("app/api/hyundai-sticker/route.ts");
    assert.match(r, /getHyundaiSticker\(vin\)/);
    assert.match(r, /stickerPending: true/);
    assert.match(r, /buildConfidence = "verified_factory"/);
    assert.doesNotMatch(r, /listingFeed|MarketCheck|createListingFeedStickerHandlers/i, "no listing-feed dependency for the factory PDF");
    const lib = read("lib/hyundaiSticker.ts");
    assert.match(lib, /hyundai-sticker\.dealerfire\.com\/new/);
    assert.match(lib, /prevapp\.hyundaiusa\.com\/DealerExternalService\.svc\/Monroney\/pdf\/GetMonroneyLabelPDF/);
    assert.doesNotMatch(lib, /cheerio|innerHTML|dealer page|vdp/i);
  });
  it("router: Hyundai VINs (KM8/KMH/5NM/5NP) go to /api/hyundai-sticker, Hyundai listed before Genesis for the shared 5NM prefix", () => {
    const p = read("lib/pasteImport.ts");
    assert.match(p, /"stellantis",[\s\S]*?"hyundai",\s*"genesis",/);
  });
});
