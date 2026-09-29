import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isLikelyVdpUrl } from '../src/vdpUrlFilter.js';

const CHEVROLET = {
  name: 'Chevrolet',
  vinPrefixes: ['1G1', '1GB', '1GC', '1GN', '2G1', '2GC', '3G1', '3GC', '3GN', 'KL1', 'KL7'],
};

// Real used-VDP URLs confirmed live 2026-09-27 on Feldman Chevrolet of Livonia's actual
// sitemap — the dealer is a Chevrolet franchise, but its used lot (like any real used
// lot) is mostly OTHER makes' trade-ins.
describe('isLikelyVdpUrl (flat-slug cross-brand used-trade-in fix)', () => {
  it('still matches a same-brand used VDP via the brand VIN-prefix branch (pre-existing behavior)', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/used-Livonia-2027-Chevrolet-Corvette+Stingray-1LT-1G1YA2D53V5100436';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), true);
  });

  it('now matches a cross-brand used trade-in (Kia on a Chevrolet dealer lot) — previously dropped', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/used-Livonia-2027-Kia-Telluride+X+Line+EX-5XYPCES14VG017233';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), true);
  });

  it('now matches a cross-brand used trade-in (Jeep) — previously dropped', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/used-Livonia-2026-Jeep-Wrangler-Sport+S-1C4PJXDG6TW170201';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), true);
  });

  it('now matches a cross-brand used trade-in (RAM) — previously dropped', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/used-Livonia-2026-RAM-1500-Big+HornLone+Star-1C6SRFFP9TN157708';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), true);
  });

  it('now matches a cross-brand used trade-in (Hyundai) — previously dropped', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/used-Livonia-2026-Hyundai-Santa+Fe-XRT-5NMP3DGLXTH152062';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), true);
  });

  it('still matches a same-brand new VDP on the identical flat-slug shape', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/new-Livonia-2026-Chevrolet-Blazer+EV-LT-3GNKDARM0TS145553';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), true);
  });

  it('still matches a DDC 32-hex-hash VDP regardless of brand (existing branch, unaffected)', () => {
    const url = 'https://www.example.com/used/Ford/2022-Ford-Explorer-0d831636ac181ed93e1225758f1e7d0f.htm';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), true);
  });

  it('still matches an /inventory/used/ path VDP (existing branch, unaffected)', () => {
    const url = 'https://www.example.com/inventory/used-2025-honda-civic-sport-19xfl2h82se034958-in-chesapeake-va';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), true);
  });

  it('does NOT match an SEO landing page with no VIN-shaped segment (no false positive)', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/used-car-dealer-livonia-mi.html';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), false);
  });

  it('does NOT match a blog/content page with no VIN-shaped segment (no false positive)', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/your-checklist-for-inspecting-and-buying-a-used-car.html';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), false);
  });

  it('does NOT match a non-vehicle page whose final segment is short and not VIN-shaped', () => {
    const url = 'https://www.feldmanchevyoflivonia.com/privacy.aspx';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), false);
  });

  it('does NOT match a 16-char segment one short of a real VIN (boundary check)', () => {
    const url = 'https://www.example.com/used-Livonia-2026-Kia-Telluride-5XYPCES14VG01723';
    assert.equal(isLikelyVdpUrl(url, CHEVROLET), false);
  });
});

const VOLKSWAGEN = { name: 'Volkswagen', vinPrefixes: ['3VW', '1VW', 'WVW', 'WVG', '1V2'] };

// A third real-world VDP URL family, distinct from both DDC's 32-hex-hash and DealerOn's flat
// hyphen-suffixed slug: "Team Velocity/Apollo"-platform dealers (confirmed live 2026-09-28 on
// Volkswagen of Hartford's real sitemap) put the VIN as its own bare path segment,
// /viewdetails/used/{vin}/{slug} — a used Porsche Taycan trade-in was invisible everywhere in the
// app because this exact URL never matched any existing branch, catching this well after
// PR #334/#335 already fixed the brand-isolation and flat-slug cases (VW of Hartford's own site
// lists 61 used vehicles across 12 makes; only the 39 actual VWs were ever being found before
// this fix landed, since the sitemap URL itself was the thing being dropped, upstream of any
// make-matching logic at all).
describe('isLikelyVdpUrl (bare-VIN-path-segment fix, "viewdetails" platform)', () => {
  it('matches a cross-brand used trade-in whose VIN is its own path segment, not hyphen-suffixed', () => {
    const url = 'https://www.vwofhartford.com/viewdetails/used/wp0ad2y1xpsa47099/2023-porsche-taycan-4dr-car?type=finance';
    assert.equal(isLikelyVdpUrl(url, VOLKSWAGEN), true);
  });

  it('still matches a same-brand VDP on the identical bare-VIN-segment shape', () => {
    const url = 'https://www.vwofhartford.com/viewdetails/used/3vwc57bu3rm003526/2024-volkswagen-jetta-4dr-car';
    assert.equal(isLikelyVdpUrl(url, VOLKSWAGEN), true);
  });

  it('does NOT match when the segment is bare but not VIN-shaped (no false positive)', () => {
    const url = 'https://www.vwofhartford.com/viewdetails/used/not-a-real-vin-segment/2023-porsche-taycan';
    assert.equal(isLikelyVdpUrl(url, VOLKSWAGEN), false);
  });
});
