// The option -> facet-row rules shared by the nightly upsert (handleInventoryBulk) and the options
// backfill script. Pinned here because deals_api_server.js can't be imported in a test (it starts a
// real server at import time).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptionKey, optionRowsFromOptions, payloadHasOptions, looksLikeJunkCanonicalKey } from '../src/inventoryOptionRows.js';

describe('optionRowsFromOptions', () => {
  it('canonicalizes by name and dedupes, keeping the first label/code seen', () => {
    const { rows } = optionRowsFromOptions([
      { code: 'PKG-101A', name: 'FX4 Off-Road Package', price: 995 },
      { code: 'OPT-7', name: 'FX4 Off Road Package', price: 0 },
      { code: null, name: 'Twin Panel Moonroof' },
    ]);
    assert.deepEqual(rows, [
      { key: 'fx4 off road package', label: 'FX4 Off-Road Package', code: 'PKG-101A' },
      { key: 'twin panel moonroof', label: 'Twin Panel Moonroof', code: null },
    ]);
  });

  it('drops #333 marketing sentences before they reach the facet, and counts them', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: 'the FX4 Off-Road Package adds skid plates underneath' },
      { name: 'Picture the FX4 confidence on the road ahead' },
      { name: 'x'.repeat(80) },
      { name: 'Bowers & Wilkins Diamond Surround Sound System' },
    ]);
    assert.equal(junkDropped, 3);
    assert.deepEqual(rows.map((r) => r.key), ['bowers wilkins diamond surround sound system']);
  });

  it('drops dealer fees, finance/warranty products and split-decimal fragments (live Honda CR-V junk)', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: '$0 Deductible Coverage' },
      { name: '00 Dealer Document Processing Fee' },
      { name: '00 Doc Fee' },
      { name: '0-amp port in center console' },
      { name: '$0 Warranty Deductible' },
      { name: '(0 A) Marsh Gray' },
      { name: '0!!!' },
      { name: '0 adds adaptive cruise control with stop-and-go capability' },
      { name: '360-Degree Camera' },
      { name: '10-Speed Automatic Transmission' },
    ]);
    assert.equal(junkDropped, 8);
    assert.deepEqual(rows.map((r) => r.label), ['360-Degree Camera', '10-Speed Automatic Transmission']);
  });

  it('keeps a real option containing a single sentence-marker word', () => {
    const { rows, junkDropped } = optionRowsFromOptions([{ name: '20-inch Wheels With FX4 Off-Road Bodyside Decal' }]);
    assert.equal(junkDropped, 0);
    assert.equal(rows.length, 1);
  });

  // Confirmed live 2026-09-30 sampling Jeep Grand Cherokee Limited's real facet rows: OEM
  // incentive-program disclaimer text (expiration dates, cash/bonus program names, delivery-radius
  // and demo-mileage sentences, bare dealer-fee/zip-code numbers) stored as if each were an atomic
  // factory option. #333/#347 never targeted this category — it's not a marketing sentence about
  // the VEHICLE, and it's not a dealer fee/warranty product either.
  it('drops bare calendar dates (OEM incentive expiration dates), never a real slash-separated option', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: '09/30/2026' },
      { name: '09/30/2026)' },
      { name: '01/04/2027' },
      { name: '40/20/40 Split Bench Seat' },
      { name: 'Front 40/20/40 Split-Bench Seat' },
    ]);
    assert.equal(junkDropped, 3);
    assert.deepEqual(rows.map((r) => r.label), ['40/20/40 Split Bench Seat', 'Front 40/20/40 Split-Bench Seat']);
  });

  // Found live 2026-09-30 AFTER the first purge round: the same expiration date glues onto the
  // FRONT of something else with no separator — a missing-separator concatenation bug, same class
  // as (but the mirror image of) #335's mid-word camelCase fix. A row this corrupted can't be
  // trusted to have clean text after the date either, so the whole thing is dropped rather than an
  // attempt made to strip the date and recover the tail.
  it('drops a date GLUED onto the front of anything else, not just a bare date alone', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: '09/30/2026 Apple CarPlay' },
      { name: '09/30/2026 Price includes $620 of dealer added accessories' },
      { name: '01/04/2027 Steel Blue 2027 Jeep Grand Cherokee Limited 2' },
      { name: 'Apple CarPlay' },
    ]);
    assert.equal(junkDropped, 3);
    assert.deepEqual(rows.map((r) => r.label), ['Apple CarPlay']);
  });

  it('drops bare MSRP-discount phrasing and vehicle-history/condition disclosures — never factory options on any car', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: '122 off MSRP!' },
      { name: '010 off MSRP' },
      { name: '1 Owner Clean Carfax' },
      { name: '1-OWNERCLEAN AUTO CHECK WITH NO ACCIDENTS REPORTED' },
      { name: '$100 Tire Credit' },
      { name: 'Panoramic Sunroof' },
    ]);
    assert.equal(junkDropped, 5);
    assert.deepEqual(rows.map((r) => r.label), ['Panoramic Sunroof']);
  });

  // The single largest remaining category by vehicle count after the first two live purge rounds —
  // two real Monroney-sticker-style spec lines glued together with no separator. Only the LONG
  // (4+) all-caps-run shape is targeted; a bare single-capital transition ("RatioNormal",
  // "DisplayRadio") is a known, accepted residual — see LONG_CAPS_RUN_GLUED_ON's own comment.
  it('drops a real option glued to a following ALL-CAPS section header with no separator', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: 'Standard EquipmentMECHANICAL3' },
      { name: 'Hill Hold Control and Electric Parking BrakeEXTERIOR20 x 8' },
      { name: 'AM/FM radio: SiriusXM with 360L' },
      { name: '10-Speaker SiriusXM Ready Premium Audio System' },
    ]);
    assert.equal(junkDropped, 2);
    assert.deepEqual(rows.map((r) => r.label), ['AM/FM radio: SiriusXM with 360L', '10-Speaker SiriusXM Ready Premium Audio System']);
  });

  it('drops OEM cash/bonus incentive-program names', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: '$3000 - Retail Customer Cash' },
      { name: '$500 - 2026 National Bonus Cash' },
      { name: '$20 per $1000 financed' },
      { name: 'Price includes: $4000 - Retail Customer Cash' },
      { name: 'Panoramic Sunroof' },
    ]);
    assert.equal(junkDropped, 4);
    assert.deepEqual(rows.map((r) => r.label), ['Panoramic Sunroof']);
  });

  it('drops bare numbers/currency amounts (dealer fees, zip codes, bare years, hyphenated code ranges) with no letters at all', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: '$30' },
      { name: '506' },
      { name: '78705' },
      { name: '2023' },
      { name: '001-120' },
      { name: '$1,000' },
      { name: '4WD' },
      { name: '360-Degree Camera' },
    ]);
    assert.equal(junkDropped, 6);
    assert.deepEqual(rows.map((r) => r.label), ['4WD', '360-Degree Camera']);
  });

  it('drops mileage/location/delivery-radius marketing sentences — no real option in the live sample mentions mileage at all', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: 'Free deliveries within 200 miles' },
      { name: 'Located 2 Miles north of Isanti on Hwy 65' },
      { name: 'With only 3 miles on the odometer' },
      { name: '600 miles' },
      { name: 'HD Radio' },
    ]);
    assert.equal(junkDropped, 4);
    assert.deepEqual(rows.map((r) => r.label), ['HD Radio']);
  });

  it('skips code-only entries — a listing-position code is not a stable identity', () => {
    assert.deepEqual(optionRowsFromOptions([{ code: 'OPT-35', name: null }, { code: 'OPT-36' }]).rows, []);
  });

  it('returns nothing for a non-array', () => {
    assert.deepEqual(optionRowsFromOptions(null), { rows: [], junkDropped: 0 });
  });
});

describe('payloadHasOptions — a crawl that extracted nothing must not wipe existing facet rows', () => {
  it('is false for null, undefined, and an empty list (what the sync sends when nothing was extracted)', () => {
    assert.equal(payloadHasOptions(null), false);
    assert.equal(payloadHasOptions(undefined), false);
    assert.equal(payloadHasOptions([]), false);
  });

  it('is true for a real options list, even one that turns out to be all junk after filtering', () => {
    assert.equal(payloadHasOptions([{ name: 'x' }]), true);
  });
});

// A separate, narrower classifier from looksLikeNonOptionText/looksLikeOptionSentence — built to run
// directly against canonical_key (already lowercased, punctuation collapsed to spaces) so the
// one-shot purge script (scripts/box/2026-09-30-purge-junk-option-keys.mjs) never has to read the
// 24M-row label column at all (confirmed live: that took 13+ minutes; canonical_key alone, 28s).
// Every case here feeds normalizeOptionKey() first, exactly like the purge script's real input, so
// this also pins the normalization each junk pattern actually has to survive.
describe('looksLikeJunkCanonicalKey — the purge script\'s fast, canonical_key-only classifier', () => {
  const keyOf = (label) => normalizeOptionKey(label);

  it('drops bare calendar dates, and a date glued onto the front of anything else, in normalized (space-separated) form', () => {
    assert.equal(looksLikeJunkCanonicalKey(keyOf('09/30/2026')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('09/30/2026)')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('01/04/2027')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('09/30/2026 Apple CarPlay')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('01/04/2027 Steel Blue 2027 Jeep Grand Cherokee Limited 2')), true);
  });

  it('never drops a real slash-separated option once normalized — "40" is not a valid month or day', () => {
    assert.equal(looksLikeJunkCanonicalKey(keyOf('40/20/40 Split Bench Seat')), false);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('Front 40/20/40 Split-Bench Seat')), false);
  });

  it('drops bare MSRP-discount phrasing and vehicle-history/condition disclosures', () => {
    assert.equal(looksLikeJunkCanonicalKey(keyOf('122 off MSRP!')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('1 Owner Clean Carfax')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('1-OWNERCLEAN AUTO CHECK WITH NO ACCIDENTS REPORTED')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('$100 Tire Credit')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('Panoramic Sunroof')), false);
  });

  it('drops cash/bonus/financed incentive-program names', () => {
    assert.equal(looksLikeJunkCanonicalKey(keyOf('$3000 - Retail Customer Cash')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('$500 - 2026 National Bonus Cash')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('$20 per $1000 financed')), true);
  });

  it('drops bare numbers, including a comma-formatted amount and a hyphenated code range — both normalize to the same "digit groups separated by whitespace" shape', () => {
    assert.equal(looksLikeJunkCanonicalKey(keyOf('$30')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('506')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('78705')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('2023')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('001-120')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('$1,000')), true);
  });

  it('keeps real options that happen to be short or numeric-looking', () => {
    assert.equal(looksLikeJunkCanonicalKey(keyOf('4WD')), false);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('360-Degree Camera')), false);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('10-Speed Automatic Transmission')), false);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('Panoramic Sunroof')), false);
  });

  it('drops mileage/location/delivery sentences', () => {
    assert.equal(looksLikeJunkCanonicalKey(keyOf('Free deliveries within 200 miles')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('600 miles')), true);
    assert.equal(looksLikeJunkCanonicalKey(keyOf('HD Radio')), false);
  });

  it('handles non-string input safely', () => {
    assert.equal(looksLikeJunkCanonicalKey(null), false);
    assert.equal(looksLikeJunkCanonicalKey(undefined), false);
    assert.equal(looksLikeJunkCanonicalKey(''), false);
  });
});

describe('normalizeOptionKey', () => {
  it('folds B&W into the full brand name before stripping punctuation', () => {
    assert.equal(normalizeOptionKey('B&W Premium Audio'), 'bowers wilkins premium audio');
  });

  it('caps at 80 characters (the column width)', () => {
    assert.equal(normalizeOptionKey('a '.repeat(100)).length <= 80, true);
  });
});

import { buyerOptionCatalog, isBuyerFacingOption, buyerOptionLabel, CATALOG_MAX_OPTIONS } from '../src/inventoryOptionRows.js';

describe('buyer option catalog hygiene', () => {
  const row = (canonical_key, label, vehicleCount) => ({ canonical_key, label, vehicleCount });

  it('drops listing-position codes, near-empty keys and non-option text', () => {
    const out = buyerOptionCatalog([
      row('opt 35', 'OPT-35', 5000),
      row('heated front seats', 'Heated front seats', 2714),
      row('4wd', '4WD', 24),
      row('doc fee', 'Doc Fee', 9000),
      row('09 30 2026', '09/30/2026', 9000),
    ]);
    assert.deepEqual(out.map((o) => o.key), ['heated front seats']);
  });

  it('orders by vehicle count, cleans SHOUTING labels, and caps the list', () => {
    const many = Array.from({ length: 200 }, (_, i) => row(`feature ${String.fromCharCode(97 + (i % 26))} ${i}`, `Feature ${i}`, 100 + i));
    const out = buyerOptionCatalog([row('sunroof', 'PANORAMIC SUNROOF', 99999), ...many]);
    assert.equal(out.length, CATALOG_MAX_OPTIONS);
    assert.equal(out[0].label, 'Panoramic Sunroof');
    assert.ok(out.every((o, i) => i === 0 || out[i - 1].vehicleCount >= o.vehicleCount));
  });

  it('rejects over-long run-on labels and digit-only keys', () => {
    assert.equal(isBuyerFacingOption('x'.repeat(10), 'x'.repeat(61)), false);
    assert.equal(isBuyerFacingOption('123 456', '123-456'), false);
    assert.equal(buyerOptionLabel('  Tow   package '), 'Tow package');
  });
});
