import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { enrichYearAndModelFromUrl } from '../src/porscheUrlFields.js';

const dealer = { make: 'Porsche' };
const CHAMPION_URL = 'https://www.champion-porsche.com/vehicle-details-used-2020-porsche-911-carrera-cabriolet-abc123';

describe('enrichYearAndModelFromUrl', () => {
  it('recovers year and trim/nameplate words from the URL slug when schema.org omits them (real Champion Porsche case)', () => {
    const result = enrichYearAndModelFromUrl({
      vehicleLd: { model: '911', manufacturer: { name: 'Porsche' } },
      url: CHAMPION_URL,
      dealer,
    });
    assert.equal(result.year, 2020);
    assert.equal(result.model, '911 Carrera Cabriolet');
  });

  it('never appends a trailing stock-number-like fragment as if it were part of the nameplate', () => {
    const result = enrichYearAndModelFromUrl({
      vehicleLd: { model: 'Macan', manufacturer: { name: 'Porsche' } },
      url: 'https://www.champion-porsche.com/vehicle-details-used-2018-porsche-macan-19696',
      dealer,
    });
    assert.equal(result.year, 2018);
    assert.equal(result.model, 'Macan');
  });

  it('prefers schema.org\'s own vehicleModelDate over the URL slug when both are present', () => {
    const result = enrichYearAndModelFromUrl({
      vehicleLd: { model: '911', vehicleModelDate: '2026', manufacturer: { name: 'Porsche' } },
      url: CHAMPION_URL,
      dealer,
    });
    assert.equal(result.year, 2026);
  });

  it('leaves model untouched when the URL slug disagrees with the model schema.org already reported', () => {
    const result = enrichYearAndModelFromUrl({
      vehicleLd: { model: 'Cayenne', manufacturer: { name: 'Porsche' } },
      url: CHAMPION_URL,
      dealer,
    });
    assert.equal(result.model, 'Cayenne');
  });

  it('is a clean no-op when the URL has no vehicle-details slug at all', () => {
    const result = enrichYearAndModelFromUrl({
      vehicleLd: { model: 'Taycan' },
      url: 'https://example.com/some/other/path',
      dealer,
    });
    assert.equal(result.year, null);
    assert.equal(result.model, 'Taycan');
  });

  it('returns a null model when schema.org provided none, even with a matching URL slug', () => {
    const result = enrichYearAndModelFromUrl({
      vehicleLd: {},
      url: CHAMPION_URL,
      dealer,
    });
    assert.equal(result.model, null);
  });
});
