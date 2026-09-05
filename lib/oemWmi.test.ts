import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAudiVin,
  isBmwVin,
  isFordOrLincolnVin,
  isGenesisVin,
  isGmVin,
  isHondaVin,
  isHyundaiVin,
  isKiaVin,
  isMazdaVin,
  isMercedesVin,
  isMiniVin,
  isMitsubishiVin,
  isNissanVin,
  isPorscheVin,
  isStellantisVin,
  isSubaruVin,
  isToyotaVin,
  isVolkswagenVin,
  isVolvoVin,
  looksLikeAudiPaste,
  looksLikeBmwPaste,
  looksLikeHyundaiPaste,
  looksLikeKiaPaste,
  looksLikeMazdaPaste,
  looksLikeMercedesPaste,
  looksLikeMiniPaste,
  looksLikeMitsubishiPaste,
  looksLikeNissanPaste,
  looksLikeSubaruPaste,
  looksLikeVolkswagenPaste,
  looksLikeVolvoPaste,
} from "./oemWmi";

// Real VINs pulled from live active MarketCheck listings 2026-09-05, one
// per newly-added brand — every one of these actually exists on a lot
// right now, not a fabricated example. Hyundai/Audi/MINI are the three
// brands where the one-VIN probe didn't happen to land on the dominant
// confirmed prefix, so those three use a syntactically-shaped VIN built
// from the confirmed-real prefix (KM8 / WA1 / WMW) from the 50-row WMI
// survey instead — fine for exercising prefix matching, which is all
// these functions do (no checksum validation).
const REAL_VINS = {
  nissan: "3N1AB9DV0TY244155",
  hyundai: "KM8J3CAL0RU123456",
  kia: "5XYPCES11VG050173",
  subaru: "4S4BSANCXJ3375756",
  mazda: "JM3KFBCM4P0154276",
  volkswagen: "3VV3B7AX8MM029164",
  audi: "WA1LFAFP8RD123456",
  bmw: "5YMCY0C0XN9M47043",
  mini: "WMWXP9C58N2A123456".slice(0, 17),
  mercedes: "4JGGM1CB8VA076505",
  volvo: "YV4L12UC3T2781600",
  mitsubishi: "JA4ARUAU5TU015541",
};

describe("new manufacturer VIN detectors — real VINs from live listings", () => {
  it("recognizes each brand's own real VIN", () => {
    assert.equal(isNissanVin(REAL_VINS.nissan), true);
    assert.equal(isHyundaiVin(REAL_VINS.hyundai), true);
    assert.equal(isKiaVin(REAL_VINS.kia), true);
    assert.equal(isSubaruVin(REAL_VINS.subaru), true);
    assert.equal(isMazdaVin(REAL_VINS.mazda), true);
    assert.equal(isVolkswagenVin(REAL_VINS.volkswagen), true);
    assert.equal(isAudiVin(REAL_VINS.audi), true);
    assert.equal(isBmwVin(REAL_VINS.bmw), true);
    assert.equal(isMiniVin(REAL_VINS.mini), true);
    assert.equal(isMercedesVin(REAL_VINS.mercedes), true);
    assert.equal(isVolvoVin(REAL_VINS.volvo), true);
    assert.equal(isMitsubishiVin(REAL_VINS.mitsubishi), true);
  });

  it("never cross-matches another new brand's real VIN", () => {
    const detectors: Array<[string, (vin: string) => boolean]> = [
      ["nissan", isNissanVin],
      ["hyundai", isHyundaiVin],
      ["kia", isKiaVin],
      ["subaru", isSubaruVin],
      ["mazda", isMazdaVin],
      ["volkswagen", isVolkswagenVin],
      ["audi", isAudiVin],
      ["bmw", isBmwVin],
      ["mini", isMiniVin],
      ["mercedes", isMercedesVin],
      ["volvo", isVolvoVin],
      ["mitsubishi", isMitsubishiVin],
    ];
    for (const [ownerBrand, vin] of Object.entries(REAL_VINS)) {
      for (const [detectorBrand, detect] of detectors) {
        if (detectorBrand === ownerBrand) continue;
        assert.equal(detect(vin), false, `${detectorBrand} detector should not match ${ownerBrand}'s VIN ${vin}`);
      }
    }
  });

  it("never cross-matches an existing OEM's real detection VINs", () => {
    const newDetectors: Array<(vin: string) => boolean> = [
      isNissanVin, isHyundaiVin, isKiaVin, isSubaruVin, isMazdaVin,
      isVolkswagenVin, isAudiVin, isBmwVin, isMiniVin, isMercedesVin, isVolvoVin, isMitsubishiVin,
    ];
    // A representative VIN per pre-existing OEM — real ones where this repo
    // already has them (Ford/Honda from its own fixtures, Porsche from its
    // own MOCK_CATALOG_PORSCHE_VIN), a correctly-prefixed synthetic VIN
    // elsewhere (same approach as the Hyundai/Audi/MINI VINs above) since
    // this test only exercises prefix matching, not checksum validation.
    const existing: Array<[string, string]> = [
      ["ford", "1FMWK8JCXTGB47204"],
      ["gm", "1GCPKKEKXTZ461947"],
      ["stellantis", "1C4RJFAG5MC500001"],
      ["genesis", "KMTG34TE1PU000001"],
      ["porsche", "WP0AB2A98SS160032"],
      ["toyota", "4T1G11AK0RU000001"],
      ["honda", "1HGCY1F27TA052939"],
    ];
    for (const [name, vin] of existing) {
      for (const detect of newDetectors) {
        assert.equal(detect(vin), false, `a new-brand detector should not match the ${name} VIN ${vin}`);
      }
      // And the reverse: none of the new brands' real VINs should look like an existing OEM's.
    }
    const existingDetectors: Array<[string, (vin: string) => boolean]> = [
      ["ford", isFordOrLincolnVin],
      ["gm", isGmVin],
      ["stellantis", isStellantisVin],
      ["genesis", isGenesisVin],
      ["porsche", isPorscheVin],
      ["toyota", isToyotaVin],
      ["honda", isHondaVin],
    ];
    for (const vin of Object.values(REAL_VINS)) {
      for (const [name, detect] of existingDetectors) {
        assert.equal(detect(vin), false, `${name} should not match a new-brand VIN ${vin}`);
      }
    }
  });

  it("resolves the Genesis/Hyundai 5NM overlap in favor of Genesis, on purpose", () => {
    // 5NM is Hyundai Motor Manufacturing Alabama — shared by real Genesis
    // and real Hyundai-brand vehicles. Genesis already has a working
    // factory-sticker pipeline riding on it; Hyundai's isHyundaiVin
    // deliberately excludes it rather than creating an ambiguous VIN.
    const fiveNmVin = "5NMJB3AE1SH123456";
    assert.equal(isGenesisVin(fiveNmVin), true);
    assert.equal(isHyundaiVin(fiveNmVin), false);
  });
});

describe("new manufacturer paste-text detection", () => {
  it("recognizes a brand mention even without a VIN in the paste", () => {
    assert.equal(looksLikeNissanPaste("Check out this Nissan Rogue!"), true);
    assert.equal(looksLikeHyundaiPaste("2026 Hyundai Tucson listing"), true);
    assert.equal(looksLikeKiaPaste("Kia Telluride for sale"), true);
    assert.equal(looksLikeSubaruPaste("Subaru Outback"), true);
    assert.equal(looksLikeMazdaPaste("Mazda CX-5"), true);
    assert.equal(looksLikeVolkswagenPaste("VW Atlas"), true);
    assert.equal(looksLikeAudiPaste("Audi Q5"), true);
    assert.equal(looksLikeBmwPaste("BMW X3"), true);
    assert.equal(looksLikeMiniPaste("Mini Cooper"), true);
    assert.equal(looksLikeMercedesPaste("Mercedes-Benz GLE"), true);
    assert.equal(looksLikeVolvoPaste("Volvo XC90"), true);
    assert.equal(looksLikeMitsubishiPaste("Mitsubishi Outlander"), true);
  });

  it("does not fire on unrelated text", () => {
    assert.equal(looksLikeNissanPaste("2026 Ford Explorer"), false);
    assert.equal(looksLikeBmwPaste("just some random text"), false);
  });
});
