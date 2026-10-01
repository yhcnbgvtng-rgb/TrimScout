import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGate, SearchBusyError } from '../src/searchGate.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('createGate — caps concurrent searches', () => {
  it('never runs more than max at once, and runs everything that fits in the wait', async () => {
    const gate = createGate({ max: 2, waitMs: 1000 });
    let active = 0, peak = 0;
    const job = () => gate.run(async () => { active++; peak = Math.max(peak, active); await sleep(20); active--; return 'ok'; });
    const out = await Promise.all([job(), job(), job(), job(), job()]);
    assert.deepEqual(out, ['ok', 'ok', 'ok', 'ok', 'ok']);
    assert.equal(peak, 2);
    assert.deepEqual(gate.stats(), { active: 0, waiting: 0, max: 2 });
  });

  it('refuses a caller that cannot get a slot within waitMs (fail fast, no cascade)', async () => {
    const gate = createGate({ max: 1, waitMs: 30 });
    const slow = gate.run(() => sleep(120));
    await assert.rejects(gate.run(async () => 'never'), SearchBusyError);
    await slow;
    assert.equal(gate.stats().active, 0);
  });

  it('releases the slot when the job throws', async () => {
    const gate = createGate({ max: 1, waitMs: 50 });
    await assert.rejects(gate.run(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await gate.run(async () => 'next'), 'next');
  });
});
