import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseFeaturesFromDescription } from '../src/descriptionFeatures.js';

// Extracted from standalone.js 2026-09-26 so this could finally be
// unit-tested — it had sat fully built, correctly guarded, but never
// actually called from extractSchemaOrgVehicle. These fixtures cover both
// the real "why it was never wired in" case and the real gap it now closes.
describe('parseFeaturesFromDescription', () => {
  it('extracts a real bulleted feature list, deduped and filtered of generic baseline equipment', () => {
    const description = '- Sport Chrono Package\n- Bose Surround Sound\n- Panoramic Roof\n- Air Conditioning\n- Sport Chrono Package';
    const result = parseFeaturesFromDescription(description);
    assert.deepEqual(result.map((f) => f.name), ['Sport Chrono Package', 'Bose Surround Sound', 'Panoramic Roof']);
    assert.ok(result.every((f) => f.code === 'FEATURE' && f.category === 'feature' && f.price === 0));
  });

  it('the exact undelimited spec-sheet dump that originally justified never calling this at all — confirmed real, from Porsche Beverly Hills — produces no garbage feature', () => {
    const description = 'Standard EquipmentMECHANICALFull-Time All-WheelAxle RatioP245/45R20 Performance Tires';
    const result = parseFeaturesFromDescription(description);
    // No commas/periods/newlines to split on -> the whole string is ONE
    // token far past the 60-char cap, so it's discarded entirely rather
    // than shipped as a single mashed-together "feature."
    assert.deepEqual(result, []);
  });

  it('skips extraction entirely for flowing marketing prose instead of emitting sentence fragments', () => {
    const description = 'Porsche North Houston is delighted to showcase this stunning Panamera. We invite you to Activate Your Ownership with us today!';
    assert.deepEqual(parseFeaturesFromDescription(description), []);
  });

  it('trusts only the bulleted items when a description mixes a real list with trailing prose', () => {
    const description = '- Sport Chrono Package\n- Bose Surround Sound\n- Panoramic Roof\nThe vehicle has been freshly detailed. All prices plus sales tax and government fees.';
    const result = parseFeaturesFromDescription(description);
    assert.deepEqual(result.map((f) => f.name), ['Sport Chrono Package', 'Bose Surround Sound', 'Panoramic Roof']);
  });

  it('drops everything from a boilerplate marker (fees/disclaimers) onward before parsing', () => {
    const description = 'Heated Seats, Sunroof, Sport Package, plus government fees and taxes, any finance charges, dealer document processing charge.';
    const result = parseFeaturesFromDescription(description);
    assert.deepEqual(result.map((f) => f.name), ['Heated Seats', 'Sunroof', 'Sport Package']);
  });

  it('filters out a duplicated/truncated title fragment', () => {
    const description = 'Sport Package, 2026 Porsche Macan S 2026 Porsche Macan';
    const result = parseFeaturesFromDescription(description);
    assert.deepEqual(result.map((f) => f.name), ['Sport Package']);
  });

  it('returns an empty array for a null/empty/undefined description rather than throwing', () => {
    assert.deepEqual(parseFeaturesFromDescription(null), []);
    assert.deepEqual(parseFeaturesFromDescription(undefined), []);
    assert.deepEqual(parseFeaturesFromDescription(''), []);
  });

  it('strips <br> tags into item boundaries and other HTML tags into whitespace', () => {
    const description = 'Heated Seats<br>Sunroof<br><b>Sport Package</b>';
    const result = parseFeaturesFromDescription(description);
    assert.deepEqual(result.map((f) => f.name), ['Heated Seats', 'Sunroof', 'Sport Package']);
  });

  it('never splits inside a number — decimals and thousands separators stay whole (live CR-V "00 Dealer Document Processing Fee" / "0-amp port" artifacts)', () => {
    const description = '2.0-amp USB port in center console, 3.5L V6 Engine. Twin Panel Moonroof,Tow Package';
    const result = parseFeaturesFromDescription(description);
    assert.deepEqual(result.map((f) => f.name), ['2.0-amp USB port in center console', '3.5L V6 Engine', 'Twin Panel Moonroof', 'Tow Package']);
  });
});
