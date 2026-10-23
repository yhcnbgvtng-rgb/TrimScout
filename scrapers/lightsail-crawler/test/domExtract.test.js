import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractVehicleDom, pickVinOccurrence } from '../src/dom_store.js';
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

// box4, 2026-10-23: the five cached Team Velocity blobs were the page HEAD (VIN at offset 327-742 of 8.3-8.7 KB, no stock or price text), because the window
// was built around the first occurrence of the VIN, which is the canonical / og:url meta tag. The fixture has that head-first shape with masked VINs.
const hf = fx('team_velocity_head_first_vdp_sample.html');
const HF_VIN = 'WAUAGAF50RN000001';
const headEnd = hf.indexOf('</head>');
const pad = (n) => '<p>filler text</p>'.repeat(n);

describe('extractVehicleDom: a head-first Team Velocity page (box4 shape)', () => {
  it('the fixture really has the box4 shape: first VIN is in <head> meta/link tags, 4 times, before any stock or price', () => {
    const occ = [...hf.matchAll(new RegExp(HF_VIN, 'g'))].map((m) => m.index);
    assert.ok(occ[0] < 1000 && occ.filter((i) => i < headEnd).length === 4);
    assert.ok(occ.length > 4, 'and the VIN is on the page body too');
    assert.ok(!/Stock #/.test(hf.slice(0, occ[3] + 8000 > headEnd ? headEnd : occ[3] + 8000)), 'the old window (around the first VIN) holds no stock number');
    assert.ok(!/class="price"/.test(hf.slice(0, headEnd)));
  });
  it('before the fix the window around indexOf(VIN) was the page head with no stock and no price (the box4 blobs)', () => {
    const first = hf.indexOf(HF_VIN);
    const oldSlice = hf.slice(Math.max(0, first - 4000), Math.min(hf.length, first + 8000));
    assert.ok(oldSlice.includes('rel="canonical"'));
    assert.ok(!oldSlice.includes('ST24680') && !oldSlice.includes('$41,995'));
  });
  it('now the slice lands in the body: it holds the stock number, price and MSRP, not the head meta tags', () => {
    const cached = extractVehicleDom(hf, HF_VIN);
    assert.match(cached, /<span class="stock-number">ST24680<\/span>/);
    assert.match(cached, /<span class="price">\$41,995<\/span>/);
    assert.match(cached, /MSRP \$49,500/);
    assert.ok(cached.includes(`<span class="vin">${HF_VIN}</span>`));
    assert.ok(!cached.includes('rel="canonical"') && !cached.includes('og:url'));
    assert.ok(!cached.includes('"@graph"'));
  });
  it('the chosen index is the body VIN next to the stock line, not the footer VIN input and not any head tag', () => {
    const idx = pickVinOccurrence(hf, HF_VIN);
    assert.ok(idx > headEnd);
    assert.ok(hf.slice(idx - 40, idx).includes('class="vin"'));
    assert.ok(idx < hf.indexOf('<footer>'));
  });
  it('the window size is unchanged: 4,000 before and 8,000 after the chosen VIN, capped at the page', () => {
    const idx = pickVinOccurrence(hf, HF_VIN);
    const cached = extractVehicleDom(hf, HF_VIN);
    assert.equal(cached, hf.slice(Math.max(0, idx - 4000), Math.min(hf.length, idx + 8000)));
    assert.ok(cached.length <= 12000);
  });
});

describe('pickVinOccurrence', () => {
  const V = '1HGCM82633A004352';
  it('not on the page: -1', () => assert.equal(pickVinOccurrence('<p>nothing</p>', V), -1));
  it('one body occurrence is that occurrence (same as indexOf: every pre-fix page is unchanged)', () => {
    const t = `<html><head><title>x</title></head><body>${pad(10)}<div>VIN: ${V} Stock #: A1</div></body></html>`;
    assert.equal(pickVinOccurrence(t, V), t.indexOf(V));
  });
  it('skips <head> occurrences, even when stock or price text sits right next to them', () => {
    const t = `<html><head><meta name="x" content="${V}"><script>var stock="Stock # price msrp ${V}";</script></head><body>${pad(20)}<span>${V}</span> Price $20,000</body></html>`;
    assert.equal(pickVinOccurrence(t, V), t.lastIndexOf(V));
  });
  it('skips occurrences inside tag attributes (meta, link, href, data-*) and inside URLs in body scripts', () => {
    const body = `<a href="/viewdetails/used/${V}/car">link, Stock # and price nearby</a><div data-vin="${V}">Stock # price</div><script>var u="https://x.test/viewdetails/used/${V}/car"; var p="price msrp";</script>${pad(30)}<span>VIN ${V}</span>`;
    const t = `<html><head></head><body>${body}</body></html>`;
    assert.equal(pickVinOccurrence(t, V), t.lastIndexOf(V));
    assert.ok(extractVehicleDom(t, V).includes(`<span>VIN ${V}</span>`));
  });
  it('picks the body occurrence closest to stock / price / MSRP text, not just the first or the last', () => {
    const near = `<div>${V}</div><dl><dt>Stock #</dt><dd>S9</dd><dt>Price</dt><dd>$1</dd></dl>`;
    const t = `<html><head></head><body><p>${V} (related car)</p>${pad(300)}${near}${pad(300)}<p>${V} (footer)</p></body></html>`;
    const idx = pickVinOccurrence(t, V);
    assert.equal(t.slice(idx, idx + 40), `${V}</div><dl><dt>Stock #</dt><dd>S9`.slice(0, 40));
  });
  it('all three field words count: stock, price, MSRP', () => {
    for (const word of ['Stock #: S1', 'Our Price: $5', 'MSRP: $6', 'Stock Number: S1']) {
      const t = `<html><head></head><body><p>${V}</p>${pad(400)}<p>${V}</p><b>${word}</b></body></html>`;
      assert.equal(pickVinOccurrence(t, V), t.lastIndexOf(V), word);
      const u = `<html><head></head><body><p>${V}</p><b>${word}</b>${pad(400)}<p>${V}</p></body></html>`;
      assert.equal(pickVinOccurrence(u, V), u.indexOf(V), word);
    }
  });
  it('body occurrences with no stock/price text anywhere near: the last body occurrence', () => {
    const t = `<html><head></head><body><p>${V}</p>${pad(30)}<p>${V}</p></body></html>`;
    assert.equal(pickVinOccurrence(t, V), t.lastIndexOf(V));
  });
  it('every occurrence is head or markup: the last occurrence on the page', () => {
    const t = `<html><head><link rel="canonical" href="https://x.test/viewdetails/used/${V}/car"><meta property="og:url" content="https://x.test/${V}"></head><body><a href="/v/${V}">go</a></body></html>`;
    assert.equal(pickVinOccurrence(t, V), t.lastIndexOf(V));
  });
  it('a page with no </head> (a compact extract) still skips meta/link tags and URLs', () => {
    const t = `<meta property="og:url" content="https://x.test/${V}"><p>filler</p><span>${V}</span> Stock # 1`;
    assert.equal(pickVinOccurrence(t, V), t.lastIndexOf(V));
  });
  it('the old Team Velocity test page (VIN once, in the body) still gives the same window as before', () => {
    assert.equal(pickVinOccurrence(tv, TV_VIN), tv.indexOf(TV_VIN));
  });
});
