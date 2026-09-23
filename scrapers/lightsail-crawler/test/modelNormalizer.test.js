import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { splitPorscheTrimFromModelName, isKnownPorscheNameplateWord, normalizeVehicleFields } from '../src/modelNormalizer.js';

describe('splitPorscheTrimFromModelName', () => {
  it('splits a matching-case prefix cleanly', () => {
    assert.equal(splitPorscheTrimFromModelName('718', '718 Spyder'), 'Spyder');
  });

  it('splits when modelRangeName and modelName disagree only on case (the real Macan/Cayenne bug)', () => {
    assert.equal(splitPorscheTrimFromModelName('macan', 'Macan S'), 'S');
    assert.equal(splitPorscheTrimFromModelName('Cayenne', 'cayenne GTS'), 'GTS');
  });

  it('returns null trim when modelName is exactly the range with no suffix', () => {
    assert.equal(splitPorscheTrimFromModelName('911', '911'), null);
  });

  it('returns the whole modelName unchanged when it does not start with the range at all (no guessing)', () => {
    assert.equal(splitPorscheTrimFromModelName('Cayenne', 'Macan S'), 'Macan S');
  });

  it('is a clean no-op when either input is missing', () => {
    assert.equal(splitPorscheTrimFromModelName(null, 'Macan S'), 'Macan S');
    assert.equal(splitPorscheTrimFromModelName('Macan', null), null);
    assert.equal(splitPorscheTrimFromModelName('', ''), null);
  });
});

describe('isKnownPorscheNameplateWord', () => {
  it('recognizes real trim/nameplate words', () => {
    assert.equal(isKnownPorscheNameplateWord('GTS'), true);
    assert.equal(isKnownPorscheNameplateWord('cabriolet'), true);
  });

  it('rejects arbitrary words', () => {
    assert.equal(isKnownPorscheNameplateWord('19696'), false);
    assert.equal(isKnownPorscheNameplateWord('sedan'), false);
  });
});

describe('normalizeVehicleFields — Taycan engine backfill', () => {
  it('fills engine with "Electric" for a Taycan with no engine value from any strategy', () => {
    const result = normalizeVehicleFields('Porsche', { model: 'Taycan', trim: null, bodyStyle: null, engine: null });
    assert.equal(result.engine, 'Electric');
  });

  it('does not override a real engine value if one was already extracted', () => {
    const result = normalizeVehicleFields('Porsche', { model: 'Taycan', trim: null, bodyStyle: null, engine: 'Dual Motor' });
    assert.equal(result.engine, 'Dual Motor');
  });

  it('never sets Electric for a non-Taycan model', () => {
    const result = normalizeVehicleFields('Porsche', { model: '911', trim: null, bodyStyle: null, engine: null });
    assert.equal(result.engine, null);
  });

  it('is a no-op for non-Porsche brands', () => {
    const vehicle = { model: 'Taycan', trim: null, bodyStyle: null, engine: null };
    assert.deepEqual(normalizeVehicleFields('Ford', vehicle), vehicle);
  });
});
