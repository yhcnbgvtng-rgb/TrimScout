import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessOptionsCapture, carryOptionsForward, decideOptionsIngest, normalizeOptionsSource, OPTIONS_MAX_ATTEMPTS, OPTIONS_RETRY_AFTER_DAYS } from '../src/optionsCapture.js';

const opt = (name) => ({ name, code: null });
const GOOD = [opt('Heated Front Seats'), opt('Panoramic Sunroof'), opt('Trailer Tow Package')];
const JUNK = [opt('$995 Dealer Document Processing Fee'), opt('See toyota'), opt('Heated Front Seats')];
const DAY = 24 * 3600 * 1000;
const T0 = new Date('2026-10-10T03:00:00Z');

describe('assessOptionsCapture', () => {
  it('good / empty / junk', () => {
    assert.equal(assessOptionsCapture(GOOD).state, 'good');
    assert.equal(assessOptionsCapture(null).state, 'empty');
    assert.equal(assessOptionsCapture([]).state, 'empty');
    assert.equal(assessOptionsCapture([{ name: '' }, {}]).state, 'empty');
    assert.equal(assessOptionsCapture(JUNK).state, 'junk', 'two of three labels junk = mostly junk');
    assert.equal(assessOptionsCapture([opt('See toyota'), opt('$995 Dealer Document Processing Fee')]).state, 'junk', 'nothing survives');
  });
  it('exactly half junk is still good ("mostly" means more than half)', () => {
    assert.equal(assessOptionsCapture([opt('Heated Front Seats'), opt('See toyota')]).state, 'good');
  });
});

describe('decideOptionsIngest', () => {
  const at = (days) => new Date(T0.getTime() + days * DAY);
  it('a never-seen VIN with good options is captured, source defaulting to vdp', () => {
    const d = decideOptionsIngest({ existing: null, incoming: { options: GOOD }, now: T0 });
    assert.equal(d.action, 'capture');
    assert.equal(d.useIncoming, true);
    assert.deepEqual({ at: d.set.capturedAt, src: d.set.source }, { at: T0, src: 'vdp' });
    assert.equal(decideOptionsIngest({ existing: null, incoming: { options: GOOD, source: 'feed' }, now: T0 }).set.source, 'feed');
    assert.equal(normalizeOptionsSource('Sticker'), 'sticker');
    assert.equal(normalizeOptionsSource('whatever'), 'vdp');
  });
  it('a captured VIN is skipped whatever tonight says', () => {
    const existing = { capturedAt: T0, attempts: 0, checkedAt: T0 };
    for (const options of [GOOD, JUNK, null, [opt('Something New')]]) {
      const d = decideOptionsIngest({ existing, incoming: { options }, now: at(30) });
      assert.deepEqual({ a: d.action, use: d.useIncoming, set: d.set }, { a: 'skip', use: false, set: {} });
    }
  });
  it('empty or junk is a counted try; real options that survive a junk capture are still stored', () => {
    const e = decideOptionsIngest({ existing: null, incoming: { options: null }, now: T0 });
    assert.deepEqual({ a: e.action, use: e.useIncoming, n: e.set.attempts }, { a: 'attempt_failed', use: false, n: 1 });
    const j = decideOptionsIngest({ existing: null, incoming: { options: JUNK }, now: T0 });
    assert.deepEqual({ a: j.action, use: j.useIncoming, n: j.set.attempts }, { a: 'attempt_failed', use: true, n: 1 });
    assert.equal(j.set.capturedAt, undefined, 'not marked captured');
  });
  it('after one failed try: waits until 7 days have passed, then takes exactly one retry', () => {
    const existing = { capturedAt: null, attempts: 1, checkedAt: T0 };
    assert.equal(OPTIONS_RETRY_AFTER_DAYS, 7);
    for (const d of [0, 1, 6]) assert.equal(decideOptionsIngest({ existing, incoming: { options: GOOD }, now: at(d) }).action, 'wait', `day ${d}`);
    assert.equal(decideOptionsIngest({ existing, incoming: { options: GOOD }, now: at(7) }).action, 'capture');
    const again = decideOptionsIngest({ existing, incoming: { options: null }, now: at(7) });
    assert.deepEqual({ a: again.action, n: again.set.attempts }, { a: 'attempt_failed', n: 2 });
  });
  it('never loops: after the allowed tries nothing is ever taken again', () => {
    assert.equal(OPTIONS_MAX_ATTEMPTS, 2);
    for (const d of [0, 7, 400]) assert.equal(decideOptionsIngest({ existing: { capturedAt: null, attempts: 2, checkedAt: T0 }, incoming: { options: GOOD }, now: at(d) }).action, 'give_up');
  });
});

describe('carryOptionsForward (crawler side)', () => {
  it('keeps the previous good options and capture stamp; tonight\'s junk parse cannot replace them', () => {
    const prev = { dealerListedOptions: GOOD, optionsCapturedAt: '2026-10-01T00:00:00.000Z', optionsSource: 'vdp' };
    const v = carryOptionsForward({ vin: 'X', dealerListedOptions: JUNK }, prev, { now: T0 });
    assert.deepEqual(v.dealerListedOptions, GOOD);
    assert.equal(v.optionsCapturedAt, '2026-10-01T00:00:00.000Z');
  });
  it('a fresh good parse of a new VIN is stamped; a junk or empty one is not', () => {
    assert.equal(carryOptionsForward({ vin: 'X', dealerListedOptions: GOOD }, null, { now: T0 }).optionsCapturedAt, T0.toISOString());
    assert.equal(carryOptionsForward({ vin: 'X', dealerListedOptions: JUNK }, null, { now: T0 }).optionsCapturedAt, undefined);
    assert.equal(carryOptionsForward({ vin: 'X', dealerListedOptions: [] }, null, { now: T0 }).optionsCapturedAt, undefined);
  });
  it('a previous record without a capture stamp is not carried', () => {
    const v = carryOptionsForward({ vin: 'X', dealerListedOptions: [opt('Heated Front Seats')] }, { dealerListedOptions: GOOD }, { now: T0 });
    assert.equal(v.dealerListedOptions.length, 1);
  });
});

import { shouldFetchOptions, stampOptionsTry } from '../src/optionsCapture.js';
describe('shouldFetchOptions / stampOptionsTry (a crawl with its own options request)', () => {
  const at = (days) => new Date(T0.getTime() + days * DAY);
  it('a new VIN is fetched; a captured one never; a failed one once more after 7 days; then never', () => {
    assert.equal(shouldFetchOptions(null, T0), true);
    assert.equal(shouldFetchOptions({ optionsCapturedAt: T0.toISOString() }, at(100)), false);
    const failed = { optionsAttempts: 1, optionsCheckedAt: T0.toISOString() };
    assert.equal(shouldFetchOptions(failed, at(6)), false);
    assert.equal(shouldFetchOptions(failed, at(7)), true);
    assert.equal(shouldFetchOptions({ optionsAttempts: 2, optionsCheckedAt: T0.toISOString() }, at(400)), false);
  });
  it('stamping: a good result marks the capture; a junk or empty one counts a try (1, then 2)', () => {
    const good = stampOptionsTry({ dealerListedOptions: GOOD }, null, { now: T0 });
    assert.equal(good.optionsCapturedAt, T0.toISOString());
    assert.equal(good.optionsAttempts, undefined);
    const first = stampOptionsTry({ dealerListedOptions: [] }, null, { now: T0 });
    assert.equal(first.optionsAttempts, 1);
    assert.equal(first.optionsCapturedAt, undefined);
    const second = stampOptionsTry({ dealerListedOptions: JUNK }, { optionsAttempts: 1 }, { now: at(7) });
    assert.equal(second.optionsAttempts, 2);
  });
});
