// looksLikeOptionSentence() exists because dealer_inventory_options had 1.19M of 9.54M rows
// (12.5%) that were marketing prose or even a whole vehicle listing blurb stored as if it were
// one atomic option — confirmed live 2026-09-27 while investigating why AI search's option
// matching for "FX4 package" was fragmented across 212 near-duplicate canonical_key variants.
// These cases are the real examples pulled directly from that live table, so a future change to
// the heuristic can be checked against the actual problem instead of an imagined one.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeOptionSentence } from '../src/optionSentenceFilter.js';

describe('looksLikeOptionSentence — real junk pulled from dealer_inventory_options 2026-09-27', () => {
  const junk = [
    'the fx4 off road package adds skid plates underneath',
    'aided by the fx4 off road package',
    'combined with the fx4 off road package',
    'while the fx4 off road package adds skid plates',
    'including the fx4 off road package',
    'this king ranch is equipped with the fx4 off road package',
    'the fx4 and locking axle give it traction hardware',
    'the fx4 off road package and skid plates',
    'with the fx4 off road package and tow haul package',
    'and the fx4 bodyside decal',
    'picture the fx4 confidence on the road ahead',
    'steering wheel black pvc with integral cruise control switches includes audio co',
  ];
  for (const text of junk) {
    it(`rejects: "${text}"`, () => {
      assert.equal(looksLikeOptionSentence(text), true);
    });
  }
});

describe('looksLikeOptionSentence — real option names that must never be dropped', () => {
  const real = [
    'fx4 off road',
    'fx4 equipment',
    'fx4 hardware',
    'fx4 offroad',
    'fx4 capability',
    'Bowers & Wilkins Diamond Surround Sound System',
    '20 Chrome Like PVD Wheels With FX4 Off Road Bodyside Decal',
    'Equipment Group 601A High',
    'Heated and Ventilated Front Seats',
  ];
  for (const text of real) {
    it(`keeps: "${text}"`, () => {
      assert.equal(looksLikeOptionSentence(text), false);
    });
  }
});

describe('looksLikeOptionSentence — edge cases', () => {
  it('rejects at 75 characters even with no marker words (close to the DB column\'s 80-char limit)', () => {
    assert.equal(looksLikeOptionSentence('x'.repeat(75)), true);
  });
  it('keeps 74 characters with no marker words', () => {
    assert.equal(looksLikeOptionSentence('x'.repeat(74)), false);
  });
  it('is conservative on a single marker word — one "with" does not reject', () => {
    assert.equal(looksLikeOptionSentence('Off-Road Package with Skid Plates'), false);
  });
  it('rejects two marker words even in a short string', () => {
    assert.equal(looksLikeOptionSentence('the package adds this'), true);
  });
  it('handles non-string input safely', () => {
    assert.equal(looksLikeOptionSentence(null), false);
    assert.equal(looksLikeOptionSentence(undefined), false);
  });
});
