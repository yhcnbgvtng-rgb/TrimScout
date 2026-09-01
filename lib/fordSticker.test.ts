import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  confirmFordMustHavesFromSticker,
  DEMO_SUBJECT_VIN,
  defaultMustHaveLines,
  engineFamilyFromVin,
  exteriorColorMustHaveName,
  extractVin,
  extractVinFromDealerPage,
  extractAdvertisedListingPrice,
  factoryOptionBreakout,
  factoryOptionCode,
  filterableFactoryOptions,
  isFordOrLincolnVin,
  isKeypadIntent,
  isKeypadLine,
  isPlausibleVin,
  isStandardKeylessLine,
  looksLikeFordOrLincolnPaste,
  parseFordStickerText,
  shouldExcludeByEnginePrefix,
  stickerHasMustHave,
  vinCheckDigitValid,
} from "./fordSticker";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "ford-stickers");

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

const SUBJECT = DEMO_SUBJECT_VIN;
const SHORKEY = "1FMWK8JC7TGB81309";
const BATTLEFIELD = "1FMWK8JC1TGB69561";
const MALL_OF_GEORGIA = "1FMWK8JC7TGA20216";
const UNRELEASED = "1FMWK8JC2TGB72467";
const DECOY_23 = "1FMUK8JH8TGB25138";
const BRONCO = "3FMCR9BN8TRE94740";
const AWS_INSTANCE_ID = "0CF3D43CA21F9C687";
const ROUTE23_BRONCO_URL =
  "https://www.23ford.com/new/Ford/2026-Ford-Bronco-Sport-63303543ac181bfc6c479fade5d937fb.htm";

describe("VIN extract / Ford identity", () => {
  it("extracts a raw 17-char VIN", () => {
    assert.equal(extractVin(SUBJECT), SUBJECT);
    assert.equal(extractVin(`  ${SUBJECT.toLowerCase()}  `), SUBJECT);
  });

  it("extracts a VIN from a dealer VDP URL", () => {
    const url =
      "https://www.jimshorkey.com/new-Pittsburgh-2026-Ford-Explorer-Tremor+Ultimate+Package-1FMWK8JC7TGB81309";
    assert.equal(extractVin(url), SHORKEY);
  });

  it("extracts a VIN from the Ford Direct query string", () => {
    assert.equal(
      extractVin(`https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=${SUBJECT}`),
      SUBJECT
    );
  });

  it("recognizes Ford/Lincoln VINs only", () => {
    assert.equal(isFordOrLincolnVin(SUBJECT), true);
    assert.equal(isFordOrLincolnVin(DECOY_23), true);
    assert.equal(isFordOrLincolnVin("WBA33AY08RF892110"), false);
  });

  it("maps 1FMWK to 3.0 and 1FMU to 2.3 and excludes the decoy from a 3.0 hunt", () => {
    assert.equal(engineFamilyFromVin(SUBJECT), "3.0");
    assert.equal(engineFamilyFromVin(DECOY_23), "2.3");
    assert.equal(shouldExcludeByEnginePrefix(SUBJECT, DECOY_23), true);
    assert.equal(shouldExcludeByEnginePrefix(SUBJECT, SHORKEY), false);
  });

  it("does not treat a 23ford hash URL as a VIN", () => {
    assert.equal(extractVin(ROUTE23_BRONCO_URL), null);
    assert.equal(looksLikeFordOrLincolnPaste(ROUTE23_BRONCO_URL), true);
  });

  it("prefers the real VIN over an AWS instance id that appears first in the HTML", () => {
    const html = `<!-- i-0cf3d43ca21f9c687-us-east-1-bot1 -->
      <meta property="og:description" content="2026 Ford Bronco Sport Big Bend VIN ${BRONCO}" />
      <script type="application/ld+json">{"@type":"Vehicle","vehicleIdentificationNumber":"${BRONCO}"}</script>
      <dt>VIN</dt><dd>${BRONCO}</dd>
      Engine3VIN${BRONCO}`;
    assert.equal(isFordOrLincolnVin(AWS_INSTANCE_ID), false);
    assert.equal(isPlausibleVin(AWS_INSTANCE_ID), false);
    assert.equal(extractVin(html), BRONCO);
    assert.equal(extractVin(`<!-- i-${AWS_INSTANCE_ID.toLowerCase()}-us-east-1-bot1 --> later ${BRONCO}`), BRONCO);
  });

  it("extracts a concatenated Engine3VIN token", () => {
    assert.equal(extractVin(`Engine3VIN${BRONCO}`), BRONCO);
  });

  it("validates VIN check digits and Ford WMIs", () => {
    assert.equal(vinCheckDigitValid(SUBJECT), true);
    assert.equal(vinCheckDigitValid(BRONCO), true);
    assert.equal(vinCheckDigitValid(AWS_INSTANCE_ID), false);
    assert.equal(isFordOrLincolnVin(BRONCO), true);
  });

  it("treats a dealer 403 as a blocked scrape, not a VIN", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("Access Denied", { status: 403 })) as typeof fetch;
    try {
      const page = await extractVinFromDealerPage(ROUTE23_BRONCO_URL);
      assert.equal(page.vin, null);
      assert.equal(page.blocked, true);
      assert.equal(page.httpStatus, 403);
      assert.equal(page.listingPrice ?? null, null);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("reads the Bronco VIN from dealer HTML even when an AWS instance id is first", async () => {
    const html = `<!-- i-0cf3d43ca21f9c687-us-east-1-bot1 -->
      <script type="application/ld+json">{"vehicleIdentificationNumber":"${BRONCO}"}</script>`;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(html, { status: 200 })) as typeof fetch;
    try {
      const page = await extractVinFromDealerPage(ROUTE23_BRONCO_URL);
      assert.equal(page.blocked, false);
      assert.equal(page.vin, BRONCO);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("keyless glossary rules", () => {
  it("does not treat KEYLESS ENTRY W/PUSH START as a keypad filter", () => {
    assert.equal(isStandardKeylessLine("KEYLESS ENTRY W/PUSH START"), true);
    assert.equal(isKeypadLine("KEYLESS ENTRY W/PUSH START"), false);
    assert.equal(isKeypadIntent("KEYLESS ENTRY W/PUSH START"), false);
  });

  it("maps user 'keyless entry' to the $455 pillar keypad", () => {
    assert.equal(isKeypadIntent("keyless entry"), true);
    assert.equal(isKeypadLine("KEYLESS ENTRY KEYPAD"), true);
  });
});

describe("Ford sticker parse — subject 1FMWK8JCXTGB47204", () => {
  const sticker = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));

  it("is a released 2026 Explorer Tremor 3.0 with Ultimate + keypad", () => {
    assert.equal(sticker.status, "released");
    assert.equal(sticker.year, 2026);
    assert.notEqual(sticker.year, 7204);
    assert.equal(sticker.model, "Explorer");
    assert.equal(sticker.trim, "Tremor");
    assert.match(sticker.engine || "", /3\.0L/i);
    assert.equal(stickerHasMustHave(sticker, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(sticker, "Keyless Entry Keypad"), true);
    assert.deepEqual(defaultMustHaveLines(sticker), []);
  });

  it("parses sticker MSRP $64,705 and sold-to Butler NJ", () => {
    assert.equal(sticker.msrp, 64705);
    assert.match(sticker.dealerSoldTo?.name || "", /Route 23/i);
    assert.equal(sticker.dealerSoldTo?.city, "Butler");
    assert.equal(sticker.dealerSoldTo?.state, "NJ");
    assert.equal(sticker.dealerSoldTo?.zip, "07405");
  });

  it("does not treat standard keyless fob as a must-have", () => {
    const check = confirmFordMustHavesFromSticker(sticker, ["Keyless Entry Keypad"]);
    assert.equal(check.pass, true);
    assert.equal(stickerHasMustHave(sticker, "KEYLESS ENTRY W/PUSH START"), true);
    // keypad intent must still be the optional $455 line, which this car has
    assert.equal(stickerHasMustHave(sticker, "keyless entry"), true);
  });
});

describe("Ford sticker parse — true positives / false positive / unreleased", () => {
  it("Jim Shorkey has Ultimate + keypad", () => {
    const s = parseFordStickerText(SHORKEY, loadFixture(SHORKEY));
    assert.equal(s.status, "released");
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), true);
    assert.equal(confirmFordMustHavesFromSticker(s, ["Ultimate Package", "Keyless Entry Keypad"]).pass, true);
  });

  it("Battlefield Ford has Ultimate + keypad", () => {
    const s = parseFordStickerText(BATTLEFIELD, loadFixture(BATTLEFIELD));
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), true);
  });

  it("Mall of Georgia has Ultimate but MUST drop for missing keypad", () => {
    const s = parseFordStickerText(MALL_OF_GEORGIA, loadFixture(MALL_OF_GEORGIA));
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), false);
    const check = confirmFordMustHavesFromSticker(s, ["Ultimate Package", "Keyless Entry Keypad"]);
    assert.equal(check.pass, false);
    assert.ok(check.missing.includes("Keyless Entry Keypad"));
  });

  it("unreleased placeholder is never a match", () => {
    const s = parseFordStickerText(UNRELEASED, loadFixture(UNRELEASED));
    assert.equal(s.status, "unreleased");
    assert.equal(confirmFordMustHavesFromSticker(s, ["Ultimate Package"]).pass, false);
  });

  it("2.3 decoy has keypad but no Ultimate and is prefix-excluded", () => {
    const s = parseFordStickerText(DECOY_23, loadFixture(DECOY_23));
    assert.match(s.engine || "", /2\.3L/i);
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), false);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), true);
    assert.equal(shouldExcludeByEnginePrefix(SUBJECT, DECOY_23), true);
  });
});

describe("Ford sticker parse — 2026 Bronco Sport Big Bend 3FMCR9BN8TRE94740", () => {
  it("reads Bronco Sport Big Bend 4X4 from the sticker, not Explorer", () => {
    const s = parseFordStickerText(BRONCO, loadFixture(BRONCO));
    assert.equal(s.status, "released");
    assert.equal(s.year, 2026);
    assert.equal(s.model, "Bronco Sport");
    assert.equal(s.trim, "Big Bend");
    assert.equal((s.drivetrain || "").toUpperCase(), "4X4");
    assert.match(s.exteriorColor || "", /Oxford White/i);
    assert.equal(s.msrp, 36220);
    assert.match(s.engine || "", /1\.5L/i);
    assert.notEqual(s.model, "Explorer");
  });

  it("lists Oxford White as a selectable must-have, off by default", () => {
    const s = parseFordStickerText(BRONCO, loadFixture(BRONCO));
    const names = filterableFactoryOptions(s).map((o) => o.name);
    const colorLine = exteriorColorMustHaveName(s.exteriorColor || "");
    assert.ok(names.includes(colorLine), `expected ${colorLine} in ${names.join(" | ")}`);
    assert.ok(!names.some((n) => /KEYLESS ENTRY W\/?PUSH START/i.test(n) || /KEYLESS ENTRY W PUSH START/i.test(n)));
    assert.deepEqual(defaultMustHaveLines(s), []);
    assert.equal(stickerHasMustHave(s, colorLine), true);
    const shorkey = parseFordStickerText(SHORKEY, loadFixture(SHORKEY));
    assert.equal(stickerHasMustHave(shorkey, colorLine), false);
  });
});

describe("factory option codes and breakout", () => {
  it("reads a printed equipment-group code and does not invent codes", () => {
    assert.equal(factoryOptionCode("EQUIPMENT GROUP 800A"), "800A");
    assert.equal(factoryOptionCode("67C ULTIMATE PACKAGE"), "67C");
    assert.equal(factoryOptionCode("Ultimate Package"), null);
    assert.equal(factoryOptionCode("Exterior color: Oxford White"), null);
  });

  it("lists every optional-equipment line from the Shorkey sticker, including children", () => {
    const s = parseFordStickerText(SHORKEY, loadFixture(SHORKEY));
    const lines = factoryOptionBreakout(s);
    const descriptions = lines.map((o) => o.description);
    assert.ok(lines.length > 8, `expected a full build list, got ${descriptions.join(" | ")}`);
    assert.ok(descriptions.includes("Ultimate Package"));
    assert.ok(descriptions.includes("Keyless Entry Keypad"));
    assert.ok(descriptions.some((d) => /BLUECRUISE/i.test(d)));
    assert.ok(descriptions.some((d) => /MOONROOF/i.test(d)));
    assert.ok(lines.some((o) => o.isPackageChild));
    assert.equal(lines.find((o) => /EQUIPMENT GROUP/i.test(o.description))?.code, "800A");
    assert.ok(!descriptions.some((d) => /KEYLESS ENTRY W/i.test(d) && /PUSH START/i.test(d)));
    assert.ok(!JSON.stringify(lines).includes("Fuel Economy"));
  });
});

describe("must-have checkboxes start unchecked", () => {
  it("Explorer does not default Ultimate, keypad, or color", () => {
    const s = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    assert.deepEqual(defaultMustHaveLines(s), []);
    const names = filterableFactoryOptions(s).map((o) => o.name);
    assert.ok(names.includes("Ultimate Package"));
    assert.ok(names.includes("Keyless Entry Keypad"));
    assert.ok(names.some((n) => /^Exterior color:/i.test(n)));
    assert.ok(!defaultMustHaveLines(s).some((n) => /exterior color/i.test(n)));
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), true);
  });
});

describe("fixture confirmFordMustHavesFromSticker (no live HTTP)", () => {
  it("subject VIN fixture has Ultimate + keypad", () => {
    const check = confirmFordMustHavesFromSticker(
      parseFordStickerText(SUBJECT, loadFixture(SUBJECT)),
      ["Ultimate Package", "Keyless Entry Keypad"]
    );
    assert.equal(check.status, "released");
    assert.equal(check.pass, true);
  });

  it("Mall of Georgia fixture fails keypad", () => {
    const check = confirmFordMustHavesFromSticker(
      parseFordStickerText(MALL_OF_GEORGIA, loadFixture(MALL_OF_GEORGIA)),
      ["Ultimate Package", "Keyless Entry Keypad"]
    );
    assert.equal(check.status, "released");
    assert.equal(check.pass, false);
    assert.ok(check.missing.includes("Keyless Entry Keypad"));
  });

  it("Bronco Sport fixture decodes as Big Bend", () => {
    const s = parseFordStickerText(BRONCO, loadFixture(BRONCO));
    assert.equal(s.status, "released");
    assert.equal(s.model, "Bronco Sport");
    assert.equal(s.trim, "Big Bend");
    assert.equal(s.msrp, 36220);
  });
});

describe("advertised listing price from VDP HTML", () => {
  const DEALER_PAGE_DIR = path.join(import.meta.dirname, "testdata", "dealer-pages");

  it("prefers internet/sale price over MSRP and never invents a number", () => {
    const html = `
      <div>MSRP $64,705</div>
      <div>Internet Price $60,294</div>
      <script type="application/ld+json">{"@type":"Vehicle","offers":{"@type":"Offer","price":"60294"}}</script>
    `;
    assert.equal(extractAdvertisedListingPrice(html), 60294);
  });

  it("reads Shorkey Price below MSRP", () => {
    const html = `<span>MSRP $65,500</span><span>Shorkey Price $58,372</span>`;
    assert.equal(extractAdvertisedListingPrice(html), 58372);
  });

  it("prefers 23ford Sale Price over the higher Price line and MSRP", () => {
    const html = `
      <div>MSRP¹ $64,705</div>
      <div>Documentation Fee $589</div>
      <div>Price $64,794</div>
      <div>Sale Price** $60,294</div>
      <script type="application/ld+json">{"@type":"Vehicle","offers":{"@type":"Offer","price":"64794"}}</script>
    `;
    assert.equal(extractAdvertisedListingPrice(html), 60294);
  });

  it("uses JSON-LD offer only when it is a real discount vs MSRP", () => {
    const discounted = `
      <div>MSRP $64,705</div>
      <script type="application/ld+json">{"@type":"Vehicle","offers":{"@type":"Offer","price":60294}}</script>
    `;
    assert.equal(extractAdvertisedListingPrice(discounted), 60294);
    const feesOnly = `
      <div>MSRP $64,705</div>
      <div>Price $64,794</div>
      <script type="application/ld+json">{"@type":"Vehicle","offers":{"@type":"Offer","price":64794}}</script>
    `;
    assert.equal(extractAdvertisedListingPrice(feesOnly), null);
    assert.equal(extractAdvertisedListingPrice(`<div>MSRP $64,705</div>`), null);
  });

  it("reads 23ford Dealer.com JSON-LD 60294 and ignores internetPrice 64794 / salePrice 62499", () => {
    const html = fs.readFileSync(path.join(DEALER_PAGE_DIR, "23ford-explorer-47204.html"), "utf8");
    assert.equal(extractVin(html), SUBJECT);
    assert.equal(extractAdvertisedListingPrice(html), 60294);
  });

  it("does not treat Dealer.com typeClass internetPrice as Sale Price", () => {
    const html = `
      <div>MSRP¹ $64,705</div>
      {"label":"Price","type":"TOTAL","typeClass":"internetPrice","value":"$64,794"}
      "internetPrice": "64794",
      "salePrice": "62499"
    `;
    assert.equal(extractAdvertisedListingPrice(html), null);
  });

  it("falls back to the Dealer.com headline when JSON-LD is the fee-inclusive Price", () => {
    const html = `
      <div class="price-summary">
        <span class="price-summary__starting-price-value">$64,705</span>
        <span class="price-summary__final-price-value">60,294</span>
        <span class="price-summary__final-price-label">Sale Price**</span>
      </div>
      <script type="application/ld+json">{"@type":"Vehicle","offers":{"@type":"Offer","price":"64794"}}</script>
    `;
    assert.equal(extractAdvertisedListingPrice(html), 60294);
  });

  it("returns no listing price on empty or Akamai-denied HTML", () => {
    assert.equal(extractAdvertisedListingPrice(""), null);
    assert.equal(extractAdvertisedListingPrice("Access Denied\nReference #18.abc"), null);
  });

  it("parses VIN and Sale Price from a fetched 23ford hash URL", async () => {
    const html = fs.readFileSync(path.join(DEALER_PAGE_DIR, "23ford-explorer-47204.html"), "utf8");
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(html, { status: 200 })) as typeof fetch;
    try {
      const page = await extractVinFromDealerPage(
        "https://www.23ford.com/new/Ford/2026-Ford-Explorer-0cfbeebbac183eb725aa528a13fcbb21.htm"
      );
      assert.equal(page.blocked, false);
      assert.equal(page.vin, SUBJECT);
      assert.equal(page.listingPrice, 60294);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("reads advertised sale price from any Ford VDP shape, not a hardcoded VIN or dollar amount", () => {
    const f150 = `
      <div>MSRP $52,140</div>
      <script type="application/ld+json">{"@type":"Vehicle","vehicleIdentificationNumber":"1FTFW3L82RKF12345","offers":{"@type":"Offer","price":"48210"}}</script>
    `;
    assert.equal(extractAdvertisedListingPrice(f150), 48210);

    const bronco = `
      <span>MSRP $36,220</span>
      <span>Our Price $34,900</span>
    `;
    assert.equal(extractAdvertisedListingPrice(bronco), 34900);

    const namedDealer = `<span>MSRP $41,000</span><span>Westgate Price $38,250</span>`;
    assert.equal(extractAdvertisedListingPrice(namedDealer), 38250);
  });
});
