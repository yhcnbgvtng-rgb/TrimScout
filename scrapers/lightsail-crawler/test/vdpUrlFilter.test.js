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
