// The factory-option allowlist ships empty, so the most important property is that it changes
// nothing until real sticker/brochure data is loaded. Then: aliases fold onto one stored key at
// write time, and allowlist mode shows only options the allowlist vouches for.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EMPTY_ALLOWLIST, buildAllowlist, allowlistFromCatalogEntries, hasAllowlistFor,
  resolveAllowlisted, catalogModeFromEnv, loadAllowlistFromEnv,
} from '../src/factoryOptionAllowlist.js';
import { optionRowsFromOptions, buyerOptionCatalog } from '../src/inventoryOptionRows.js';

const JEEP = buildAllowlist({
  Jeep: {
    'Sky One-Touch Power Top': { label: 'Sky One-Touch Power Top', aliases: ['SKY 1-TOUCH PWR TOP', 'Sky One Touch Top'] },
    'Black 3-Piece Hard Top': { label: 'Black 3-Piece Hard Top' },
  },
});
const resolveJeep = (key) => resolveAllowlisted(JEEP, 'Jeep', key);

describe('empty allowlist — no behavior change', () => {
  it('resolves nothing and gates no make', () => {
    assert.equal(resolveAllowlisted(EMPTY_ALLOWLIST, 'Jeep', 'sky one touch power top'), null);
    assert.equal(hasAllowlistFor(EMPTY_ALLOWLIST, 'Jeep'), false);
  });

  it('leaves write-time rows exactly as they were without a resolver', () => {
    const opts = [{ name: 'SKY 1-TOUCH PWR TOP' }, { name: 'Heated Seats' }];
    const withEmpty = optionRowsFromOptions(opts, { resolveKey: (k) => resolveAllowlisted(EMPTY_ALLOWLIST, 'Jeep', k) });
    assert.deepEqual(withEmpty, optionRowsFromOptions(opts));
  });

  it('defaults to the heuristic catalog mode, and loads nothing when OPTION_ALLOWLIST_PATH is unset', () => {
    assert.equal(catalogModeFromEnv({}), 'heuristic');
    assert.equal(catalogModeFromEnv({ OPTION_CATALOG_MODE: 'ALLOWLIST' }), 'allowlist');
    assert.equal(catalogModeFromEnv({ OPTION_CATALOG_MODE: 'nonsense' }), 'heuristic');
    assert.deepEqual(loadAllowlistFromEnv({}), { allowlist: EMPTY_ALLOWLIST, error: null });
  });

  it('falls back to empty — never throws — when the allowlist file is missing or malformed', () => {
    const missing = loadAllowlistFromEnv({ OPTION_ALLOWLIST_PATH: '/nonexistent/allowlist.json' });
    assert.equal(missing.allowlist, EMPTY_ALLOWLIST);
    assert.match(missing.error, /allowlist\.json/);
    const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'allowlist-')), 'bad.json');
    fs.writeFileSync(bad, '{ not json');
    assert.equal(loadAllowlistFromEnv({ OPTION_ALLOWLIST_PATH: bad }).allowlist, EMPTY_ALLOWLIST);
  });
});

describe('resolution', () => {
  it('maps a canonical key and every alias to the one allowlisted option, per make', () => {
    const want = { key: 'sky one touch power top', label: 'Sky One-Touch Power Top' };
    assert.deepEqual(resolveJeep('sky one touch power top'), want);
    assert.deepEqual(resolveJeep('sky 1 touch pwr top'), want);
    assert.deepEqual(resolveJeep('sky one touch top'), want);
    assert.equal(resolveAllowlisted(JEEP, 'jeep', 'sky one touch top').key, 'sky one touch power top', 'make is case-insensitive');
  });

  it('is honest-empty for anything it cannot vouch for: unknown option, other make, no make', () => {
    assert.equal(resolveJeep('heated seats'), null);
    assert.equal(resolveAllowlisted(JEEP, 'Ford', 'sky one touch power top'), null);
    assert.equal(resolveAllowlisted(JEEP, null, 'sky one touch power top'), null);
  });

  it('keeps the first owner of an alias claimed by two options, instead of flipping', () => {
    const a = buildAllowlist({ Ram: { 'Level 1 Equipment Group': { aliases: ['lvl 1'] }, 'Level 2 Equipment Group': { aliases: ['lvl 1'] } } });
    assert.equal(resolveAllowlisted(a, 'Ram', 'lvl 1').key, 'level 1 equipment group');
  });
});

describe('write path — aliases fold onto one stored key', () => {
  it('stores every dealer spelling of one real option under the allowlisted key and label', () => {
    const { rows } = optionRowsFromOptions(
      [{ name: 'SKY 1-TOUCH PWR TOP' }, { name: 'Sky One Touch Top' }, { name: 'Heated Seats' }],
      { resolveKey: resolveJeep },
    );
    assert.deepEqual(rows, [
      { key: 'sky one touch power top', label: 'Sky One-Touch Power Top', code: null },
      { key: 'heated seats', label: 'Heated Seats', code: null },
    ]);
  });

  it('still drops junk before resolution — the allowlist never rescues junk', () => {
    const { rows, junkDropped } = optionRowsFromOptions([{ name: 'MYFLEXCARE SERVICE PLAN' }], { resolveKey: () => ({ key: 'x', label: 'X' }) });
    assert.deepEqual(rows, []);
    assert.equal(junkDropped, 1);
  });
});

describe('catalog gating — allowlist mode', () => {
  const row = (canonical_key, label, vehicleCount) => ({ canonical_key, label, vehicleCount });
  const rows = [
    row('sky one touch power top', 'Sky One-Touch Power Top', 2219),
    row('sky 1 touch pwr top', 'SKY 1-TOUCH PWR TOP', 300),
    row('black 3 piece hard top', 'â?¢ Black 3-Piece Hard Top', 7355),
    row('heated seats', 'Heated Seats', 4974),
  ];

  it('heuristic mode (gate off) shows every clean option, as before', () => {
    assert.deepEqual(buyerOptionCatalog(rows).map((o) => o.label), ['Black 3-Piece Hard Top', 'Heated Seats', 'Sky One-Touch Power Top', 'Sky 1-Touch Pwr Top']);
  });

  it('allowlist mode shows only vouched options, under the allowlisted label, folding aliases to the bigger stored key', () => {
    assert.deepEqual(buyerOptionCatalog(rows, { gate: true, resolve: resolveJeep }), [
      { key: 'black 3 piece hard top', label: 'Black 3-Piece Hard Top', vehicleCount: 7355 },
      { key: 'sky one touch power top', label: 'Sky One-Touch Power Top', vehicleCount: 2219 },
    ]);
  });

  it('gate without a resolver is ignored rather than blanking the list', () => {
    assert.equal(buyerOptionCatalog(rows, { gate: true }).length, 4);
  });
});

describe('allowlistFromCatalogEntries — the sticker-pipeline bridge', () => {
  it('turns lib/factoryOptionCatalog.ts entries into per-make allowlist JSON', () => {
    const raw = allowlistFromCatalogEntries([
      { canonicalName: 'M Sport Package', aliases: ['M Sport Package', 'M SPORT PKG'], makes: ['BMW'] },
      { canonicalName: 'Trailer Tow Package', aliases: ['Trailer Tow Pkg'], makes: ['Ford', 'Lincoln'] },
      { canonicalName: '', aliases: [], makes: ['Ford'] },
    ]);
    assert.deepEqual(raw, {
      bmw: { 'm sport package': { label: 'M Sport Package', aliases: ['m sport pkg'] } },
      ford: { 'trailer tow package': { label: 'Trailer Tow Package', aliases: ['trailer tow pkg'] } },
      lincoln: { 'trailer tow package': { label: 'Trailer Tow Package', aliases: ['trailer tow pkg'] } },
    });
    assert.equal(resolveAllowlisted(buildAllowlist(raw), 'Ford', 'trailer tow pkg').label, 'Trailer Tow Package');
  });
});
