import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractVehicleDom } from '../src/dom_store.js';
import { findVehicleLd } from '../src/porscheSchemaOrgFields.js';
import { readJsonLdStock } from '../src/jsonLdStock.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const tv = fx('team_velocity_dealer_only_jsonld_sample.html');
const dc = fx('dealercom_in_transit_datalayer_sample.html');
const TV_VIN = '2T36CRAV0TW000001';
const ldBlocks = (h) => [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => JSON.parse(m[1]));

describe('why the stock number stays blank (real cached pages, VINs anonymized)', () => {
  it('Dealer.com: the page\'s own dataLayer says stockNumber "null" for a car in transit, so there is nothing to read', () => {
    const cached = extractVehicleDom(dc, '5YFB4MDE0VP000001');
    assert.match(cached, /"stockNumber": "null"/);
    assert.match(cached, /"status": "In Transit At Factory"/);
    assert.equal(readJsonLdStock(dc, { vin: '5YFB4MDE0VP000001' }), null);
  });
  it('Team Velocity: the only JSON-LD is the dealer graph, so neither the @graph Vehicle parse (#565) nor the sku read finds a car', () => {
    const blocks = ldBlocks(tv);
    assert.equal(blocks.length, 1);
    assert.ok(Array.isArray(blocks[0]['@graph']));
    assert.equal(findVehicleLd(blocks[0], { graph: true }), null);
    assert.equal(readJsonLdStock(tv, { vin: TV_VIN }), null);
    assert.ok(!tv.includes('"sku"') && !/vehicleIdentificationNumber/.test(tv.split('</script>')[0]));
  });
});

describe('extractVehicleDom: what the DOM store keeps for a car', () => {
  it('a Team Velocity page with only the dealer graph keeps the page around the VIN, not the dealer block', () => {
    const cached = extractVehicleDom(tv, TV_VIN);
    assert.ok(cached.includes(TV_VIN));
    assert.match(cached, /Stock #: ST12345/);
    assert.ok(!cached.includes('"@graph"'), 'the dealer-only JSON-LD is no longer stored in place of the car');
  });
  it('keeps the old behaviour everywhere else', () => {
    // a JSON-LD block that carries the VIN still wins over the page window
    const withVin = `<script type="application/ld+json">{"@type":"Vehicle","vehicleIdentificationNumber":"${TV_VIN}","sku":"A1"}</script><p>${TV_VIN}</p>`;
    assert.match(extractVehicleDom(withVin, TV_VIN), /"sku":"A1"/);
    // the DDC dataLayer still comes first
    assert.match(extractVehicleDom(dc, '5YFB4MDE0VP000001'), /^DDC\.dataLayer/);
    // VIN not on the page: the first Vehicle-like JSON-LD block, as before
    assert.ok(extractVehicleDom(tv.replace(TV_VIN, 'XXXXXXXXXXXXXXXXX'), TV_VIN).includes('"@graph"'));
    // no VIN given: first Vehicle-like block; nothing matching: the whole text
    assert.ok(extractVehicleDom(tv).includes('"@graph"'));
    assert.equal(extractVehicleDom('<p>nothing</p>', TV_VIN), '<p>nothing</p>');
  });
});
