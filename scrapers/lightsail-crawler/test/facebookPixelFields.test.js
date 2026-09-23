import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fillFromFacebookPixelViewContent } from '../src/facebookPixelFields.js';

// Real fbq('track', 'ViewContent', {...}) calls captured live 2026-09-23
// from paulmillertoyota.com and righttoyota.com — both on a platform whose
// schema.org markup has no Vehicle/Product type at all, only
// AutoDealer/Organization (confirmed live: a production audit found 532
// dealers / ~77,000 vehicles with this exact gap). Trimmed to the
// surrounding script tag only; everything else on a real VDP is irrelevant
// to this module.
const PAUL_MILLER_TOYOTA_HTML = `
<script>fbq('track', 'ViewContent', {content_type: 'vehicle',content_ids: ['2T3G1RFV1SW519088'],postal_code: '07058',country: 'United States',make: 'Toyota',model: 'RAV4',year: '2025',state_of_vehicle: 'CPO',exterior_color: 'Ice Cap',transmission: 'Automatic',body_style: '4D Sport Utility',fuel_type: 'Gasoline Fuel',drivetrain: 'AWD',price: 31995,currency: 'USD'});</script>
`;

const RIGHT_TOYOTA_HTML = `
<script>fbq('track', 'ViewContent', {content_type: 'vehicle',content_ids: ['JTDACACU0S3046591'],make: 'Toyota',model: 'Prius Plug-In Hybrid',year: '2025',exterior_color: 'Midnight Black Metallic',transmission: 'CVT',body_style: '5D Hatchback',price: 27995,currency: 'USD'});</script>
`;

const NO_PIXEL_HTML = `<html><body>no facebook pixel on this page at all</body></html>`;

// A dealer's normal, non-vehicle pixel fire (page view, homepage, a lead
// form submit) — must never be mistaken for vehicle data just because
// "fbq('track', 'ViewContent'" is present.
const NON_VEHICLE_VIEWCONTENT_HTML = `
<script>fbq('track', 'ViewContent', {content_type: 'product', content_ids: ['sku-123'], value: 19.99, currency: 'USD'});</script>
`;

describe('facebookPixelFields.js — Strategy 3b fallback', () => {
  it('fills every gap field from a real Paul Miller Toyota VDP pixel call', () => {
    const vehicle = { vin: 'REAL', model: null, make: null, exteriorColor: null, transmission: null, bodyStyle: null };
    const result = fillFromFacebookPixelViewContent(vehicle, PAUL_MILLER_TOYOTA_HTML);
    assert.equal(result.model, 'RAV4');
    assert.equal(result.make, 'Toyota');
    assert.equal(result.exteriorColor, 'Ice Cap');
    assert.equal(result.transmission, 'Automatic');
    assert.equal(result.bodyStyle, '4D Sport Utility');
  });

  it('fills every gap field from a real Right Toyota VDP pixel call', () => {
    const vehicle = { vin: 'REAL2', model: null, make: null, exteriorColor: null, transmission: null, bodyStyle: null };
    const result = fillFromFacebookPixelViewContent(vehicle, RIGHT_TOYOTA_HTML);
    assert.equal(result.model, 'Prius Plug-In Hybrid');
    assert.equal(result.exteriorColor, 'Midnight Black Metallic');
    assert.equal(result.transmission, 'CVT');
    assert.equal(result.bodyStyle, '5D Hatchback');
  });

  it('never overwrites a field a stronger strategy already found', () => {
    const vehicle = { vin: 'REAL', model: 'ALREADY KNOWN', make: 'Toyota', exteriorColor: null, transmission: null, bodyStyle: null };
    const result = fillFromFacebookPixelViewContent(vehicle, PAUL_MILLER_TOYOTA_HTML);
    assert.equal(result.model, 'ALREADY KNOWN', 'model must stay whatever the stronger strategy already set');
    assert.equal(result.make, 'Toyota', 'make must stay whatever the stronger strategy already set');
    assert.equal(result.exteriorColor, 'Ice Cap', 'genuinely-empty fields still get filled');
  });

  it('is a safe no-op when the page has no Facebook Pixel ViewContent call', () => {
    const vehicle = { vin: 'REAL', model: null };
    const result = fillFromFacebookPixelViewContent(vehicle, NO_PIXEL_HTML);
    assert.equal(result.model, null);
  });

  it('ignores a real ViewContent call for something other than a vehicle', () => {
    const vehicle = { vin: 'REAL', model: null };
    const result = fillFromFacebookPixelViewContent(vehicle, NON_VEHICLE_VIEWCONTENT_HTML);
    assert.equal(result.model, null, 'a non-vehicle content_type must never populate vehicle fields');
  });

  it('does not throw on a null vehicle (no VIN found by any earlier strategy)', () => {
    assert.equal(fillFromFacebookPixelViewContent(null, PAUL_MILLER_TOYOTA_HTML), null);
  });

  it('does not throw on malformed pixel JS it cannot parse', () => {
    const malformed = `<script>fbq('track', 'ViewContent', {this is not valid js at all $$$});</script>`;
    const vehicle = { vin: 'REAL', model: null };
    assert.doesNotThrow(() => fillFromFacebookPixelViewContent(vehicle, malformed));
  });
});
