import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { recoverTrimFromUrl } from '../src/vdpUrlTrim.js';

// Real URLs confirmed live 2026-09-26 against dealer_inventory — all had
// null trim in the DB despite the trim sitting right in the URL.
describe('recoverTrimFromUrl (real live-confirmed VDP URLs, 2026-09-26)', () => {
  it('recovers a short uppercase trim code (karlchevrolet.com Bolt LT — 1000/1000 blank at this dealer)', () => {
    const url = 'https://www.karlchevrolet.com/new-Ankeny-2027-Chevrolet-Bolt-LT-1G1FY6EV3VF121418';
    assert.equal(recoverTrimFromUrl(url, 'Bolt', '1G1FY6EV3VF121418'), 'LT');
  });

  it('recovers a two-word trim with a "+"-encoded space (greshamtoyota.com RAV4 XLE Premium)', () => {
    const url = 'https://www.greshamtoyota.com/new-Gresham-2026-Toyota-RAV4-XLE+Premium-2T36CRAV0TC42F658';
    assert.equal(recoverTrimFromUrl(url, 'RAV4', '2T36CRAV0TC42F658'), 'XLE Premium');
  });

  it('recovers a lowercase single-word trim, VIN followed by a city/state suffix (firstteamhonda.com Civic Sport)', () => {
    const url = 'https://www.firstteamhonda.com/inventory/used-2025-honda-civic-sport-19xfl2h82se034958-in-chesapeake-va';
    assert.equal(recoverTrimFromUrl(url, 'Civic', '19XFL2H82SE034958'), 'Sport');
  });

  it('handles a multi-word model ("Civic Hybrid") and a multi-word trim ("Sport Touring")', () => {
    const url = 'https://www.firstteamhonda.com/inventory/new-2026-honda-civic-hybrid-sport-touring-19xfl4h90te012964-in-chesapeake-va';
    assert.equal(recoverTrimFromUrl(url, 'Civic Hybrid', '19XFL4H90TE012964'), 'Sport Touring');
  });

  it('recovers a "+"-encoded city before the year, unaffected by decoding (abelgm.com Corvette Z06 3LZ)', () => {
    const url = 'https://www.abelgm.com/used-RIO+VISTA-2023-Chevrolet-Corvette+Z06-3LZ-1G1YF2D39P5600863';
    assert.equal(recoverTrimFromUrl(url, 'Corvette Z06', '1G1YF2D39P5600863'), '3LZ');
  });

  it('returns null when the model is not present in the slug at all (never guesses)', () => {
    const url = 'https://www.karlchevrolet.com/new-Ankeny-2027-Chevrolet-Bolt-LT-1G1FY6EV3VF121418';
    assert.equal(recoverTrimFromUrl(url, 'Silverado', '1G1FY6EV3VF121418'), null);
  });

  it('returns null when the VIN is not present in the slug at all', () => {
    const url = 'https://www.karlchevrolet.com/new-Ankeny-2027-Chevrolet-Bolt-LT-1G1FY6EV3VF121418';
    assert.equal(recoverTrimFromUrl(url, 'Bolt', '1FTFW1ET1EFA00000'), null);
  });

  it('returns null when model and VIN are adjacent with no trim words between them', () => {
    const url = 'https://www.example.com/new-2026-Toyota-RAV4-2T36CRAV0TC42F658';
    assert.equal(recoverTrimFromUrl(url, 'RAV4', '2T36CRAV0TC42F658'), null);
  });

  it('returns null when the VIN appears BEFORE the model match (wrong slug shape for this pattern)', () => {
    const url = 'https://www.example.com/2T36CRAV0TC42F658-new-2026-Toyota-RAV4-XLE';
    assert.equal(recoverTrimFromUrl(url, 'RAV4', '2T36CRAV0TC42F658'), null);
  });

  it('returns null when the candidate trim is implausibly long (more than 4 words) — refuses to guess from slug noise', () => {
    const url = 'https://www.example.com/new-2026-Toyota-RAV4-this-is-way-too-many-words-2T36CRAV0TC42F658';
    assert.equal(recoverTrimFromUrl(url, 'RAV4', '2T36CRAV0TC42F658'), null);
  });

  it('rejects an engine-displacement spec mistaken for a trim — real false positive caught live (firstteamhonda.com Acura TLX "2-4l")', () => {
    const url = 'https://www.firstteamhonda.com/inventory/used-2020-acura-tlx-2-4l-19uub1f34la002790-in-chesapeake-va';
    assert.equal(recoverTrimFromUrl(url, 'TLX', '19UUB1F34LA002790'), null);
  });

  it('returns null when url, model, or vin is missing', () => {
    assert.equal(recoverTrimFromUrl(null, 'RAV4', 'X'.repeat(17)), null);
    assert.equal(recoverTrimFromUrl('https://example.com/x', null, 'X'.repeat(17)), null);
    assert.equal(recoverTrimFromUrl('https://example.com/x', 'RAV4', null), null);
  });

  it('is case-insensitive when matching the model and the VIN in the slug', () => {
    const url = 'https://www.example.com/new-2026-toyota-rav4-limited-2t36crav0tc42f658';
    assert.equal(recoverTrimFromUrl(url, 'RAV4', '2T36CRAV0TC42F658'), 'Limited');
  });

  it('preserves an already-uppercase trim code exactly, never re-titlecasing it to e.g. "Xle"', () => {
    const url = 'https://www.example.com/new-2026-Toyota-RAV4-XLE-2T36CRAV0TC42F658';
    assert.equal(recoverTrimFromUrl(url, 'RAV4', '2T36CRAV0TC42F658'), 'XLE');
  });

  it('malformed percent-encoding in the URL does not throw — falls back to the raw string', () => {
    const url = 'https://www.example.com/new-2026-Toyota-RAV4-XLE-2T36CRAV0TC42F658-%';
    assert.doesNotThrow(() => recoverTrimFromUrl(url, 'RAV4', '2T36CRAV0TC42F658'));
  });
});
