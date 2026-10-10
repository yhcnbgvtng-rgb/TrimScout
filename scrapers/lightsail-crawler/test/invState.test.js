// Store-0 cars ("no store matched in the directory") used to get state NULL from the BEFORE INSERT/UPDATE trigger, which only
// looks the state up by dealer_id. 19.6k live cars (Oct 9) were invisible to every state= search. The sync now sends the crawl's own
// state and the trigger falls back to it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeState } from '../src/invState.js';

const SRC = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');

describe('normalizeState', () => {
  it('accepts a 2-letter code in any case', () => {
    assert.equal(normalizeState('co'), 'CO');
    assert.equal(normalizeState(' NC '), 'NC');
  });
  it('rejects anything that is not a 2-letter code', () => {
    for (const v of [null, undefined, '', 'Colorado', 'C0', 'COL', 12, {}]) assert.equal(normalizeState(v), null, String(v));
  });
});

describe('the shipped SQL', () => {
  it('the trigger prefers the directory state and falls back to the row\'s own', () => {
    assert.match(SRC, /SET NEW\.state = COALESCE\(\(SELECT state FROM dealership_contacts WHERE id = NEW\.dealer_id LIMIT 1\), NEW\.state\);/);
  });
  it('the bulk upsert writes state and never blanks one with a null', () => {
    assert.match(SRC, /crawl_first_seen, source_box, state, vehicle_id\)/);
    assert.match(SRC, /state = COALESCE\(VALUES\(state\), state\)/);
  });
});
