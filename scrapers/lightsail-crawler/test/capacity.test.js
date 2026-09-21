import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { countRooftopsForState, countRooftopsForStates, projectedHours, P90_SECONDS_PER_ROOFTOP } from '../src/capacity.js';

// ---------------------------------------------------------------------
// Real bug this whole module exists to prevent: box 1/box 3/box 4 were
// each assigned a state list sized by dealer COUNT or vehicle VOLUME —
// neither of which is what actually determines wall-clock time. Real
// measurement (23 samples across today's runs) showed p90 seconds/rooftop
// varying enough that a dealer-count-balanced split still projected two
// boxes past 30 hours. These helpers make that real math reusable instead
// of a one-off spreadsheet calculation redone by hand each time.
// ---------------------------------------------------------------------
describe('capacity.js (real rooftop-count + p90-rate projections)', () => {
  let tmpDir;
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-capacity-'));
    await fs.mkdir(path.join(tmpDir, 'dealers', 'nj'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'dealers', 'ny'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'dealers', 'nj', 'ford.json'), JSON.stringify([{ name: 'A' }, { name: 'B' }]));
    await fs.writeFile(path.join(tmpDir, 'dealers', 'nj', 'chevrolet.json'), JSON.stringify([{ name: 'C' }]));
    await fs.writeFile(path.join(tmpDir, 'dealers', 'ny', 'ford.json'), JSON.stringify([{ name: 'D' }, { name: 'E' }, { name: 'F' }]));
    // No dealers/ny/chevrolet.json at all — must count as 0, not throw
    // (mirrors the real Hawaii-has-no-Buick-file case found live).
  });
  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('countRooftopsForState sums real dealer-file lengths for the given brands', () => {
    assert.equal(countRooftopsForState('nj', ['ford', 'chevrolet'], tmpDir), 3);
    assert.equal(countRooftopsForState('ny', ['ford', 'chevrolet'], tmpDir), 3);
  });

  it('a missing (state, brand) dealer file counts as 0 rooftops, not an error', () => {
    assert.equal(countRooftopsForState('ny', ['chevrolet'], tmpDir), 0);
    assert.equal(countRooftopsForState('zz', ['ford'], tmpDir), 0); // state that doesn't exist at all
  });

  it('countRooftopsForStates sums across multiple states', () => {
    assert.equal(countRooftopsForStates(['nj', 'ny'], ['ford', 'chevrolet'], tmpDir), 6);
  });

  it('projectedHours matches the real formula: rooftops * secondsPerRooftop / 3600 / concurrency', () => {
    // 1000 rooftops at the real measured p90 rate, 4-way concurrency —
    // hand-computed: 1000 * 93.2 / 3600 / 4 = 6.472...h
    const hours = projectedHours(1000, 4, P90_SECONDS_PER_ROOFTOP);
    assert.ok(Math.abs(hours - 6.4722) < 0.001, `expected ~6.4722h, got ${hours}`);
  });

  it('projectedHours never divides by zero concurrency — degrades to concurrency=1', () => {
    const hours = projectedHours(100, 0, 100);
    assert.equal(hours, 100 * 100 / 3600); // same as concurrency=1
  });

  it('doubling concurrency halves the projected hours, all else equal', () => {
    const h1 = projectedHours(2000, 2, 90);
    const h2 = projectedHours(2000, 4, 90);
    assert.ok(Math.abs(h1 / 2 - h2) < 0.001);
  });
});
