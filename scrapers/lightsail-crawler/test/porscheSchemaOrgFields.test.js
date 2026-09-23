import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isVehicleLikeSchemaOrgType, readSchemaOrgVehicleFields } from '../src/porscheSchemaOrgFields.js';

// Trimmed to the fields these functions actually read, captured live
// 2026-09-22 from jackdaniels.porsche.com (an official Porsche-network
// dealer) — a new Taycan 4S and a used Cayenne S E-Hybrid.
const REAL_TAYCAN_LD = {
  '@type': ['Car', 'Product'],
  vehicleIdentificationNumber: 'WP0AB2Y11TSA28652',
  color: 'White',
  vehicleInteriorColor: 'Leather Interior In Black/bordeaux Red',
  vehicleTransmission: 'Automatic',
  mileageFromOdometer: { value: 0 },
  vehicleEngine: { fuelType: 'ELECTRIC' },
};

const REAL_CAYENNE_LD = {
  '@type': ['Car', 'Product'],
  vehicleIdentificationNumber: 'WP1BN2AY5SDA41051',
  color: 'Chromite Black Metallic',
  vehicleInteriorColor: 'Leather Interior In Black',
  vehicleTransmission: 'Automatic',
  mileageFromOdometer: { value: 39061 },
  vehicleEngine: { fuelType: 'PLUG_IN_HYBRID' },
};

describe('isVehicleLikeSchemaOrgType', () => {
  it('matches the real Porsche-network shape: an array containing "Car"', () => {
    assert.equal(isVehicleLikeSchemaOrgType(['Car', 'Product']), true);
  });

  it('still matches the plain "Vehicle" string used elsewhere', () => {
    assert.equal(isVehicleLikeSchemaOrgType('Vehicle'), true);
  });

  it('rejects unrelated types', () => {
    assert.equal(isVehicleLikeSchemaOrgType('Product'), false);
    assert.equal(isVehicleLikeSchemaOrgType(['Organization']), false);
    assert.equal(isVehicleLikeSchemaOrgType(undefined), false);
  });
});

describe('readSchemaOrgVehicleFields', () => {
  it('reads real mileage/color/transmission and converts an electric fuelType to a real engine value (Taycan)', () => {
    const result = readSchemaOrgVehicleFields(REAL_TAYCAN_LD);
    assert.deepEqual(result, {
      mileage: 0,
      exteriorColor: 'White',
      interiorColor: 'Leather Interior In Black/bordeaux Red',
      engine: 'Electric',
      transmission: 'Automatic',
    });
  });

  it('reads real mileage/color/transmission and converts a plug-in-hybrid fuelType to words (Cayenne)', () => {
    const result = readSchemaOrgVehicleFields(REAL_CAYENNE_LD);
    assert.deepEqual(result, {
      mileage: 39061,
      exteriorColor: 'Chromite Black Metallic',
      interiorColor: 'Leather Interior In Black',
      engine: 'Plug In Hybrid',
      transmission: 'Automatic',
    });
  });

  it('prefers vehicleEngine.name over fuelType when a platform provides a real name', () => {
    const result = readSchemaOrgVehicleFields({ vehicleEngine: { name: '3.0L V6 Turbo', fuelType: 'GASOLINE' } });
    assert.equal(result.engine, '3.0L V6 Turbo');
  });

  it('is a clean no-op (0/null, no throw) when given nothing', () => {
    const result = readSchemaOrgVehicleFields({});
    assert.deepEqual(result, { mileage: 0, exteriorColor: null, interiorColor: null, engine: null, transmission: null });
  });
});
