// Kia rosters for AR, MI, LA, DE: the OEM dump had no rows for them, so dealers/<st>/kia.json was empty (or 2 stores) and the Kia job was skipped.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeRosterIntoDump, rosterEntryToDumpRow } from '../src/rosterMerge.js';

const entry = (o) => ({ code: 'X', name: 'Some Kia', city: 'Town', state: 'AR', url: 'https://www.somekia.com/', latitude: '35.1', longitude: '-92.4', ...o });

describe('rosterEntryToDumpRow', () => {
  it('uses the dealer website host without www and keeps the dump row shape', () => {
    const { row } = rosterEntryToDumpRow(entry(), 'Kia');
    assert.deepEqual(Object.keys(row).sort(), ['city', 'domain', 'lat', 'lng', 'make', 'name', 'source', 'sourceUrl', 'state']);
    assert.equal(row.domain, 'somekia.com');
    assert.equal(row.lat, 35.1);
    assert.equal(row.make, 'Kia');
  });
  it('skips an entry with no website or only the OEM marketing site, and says why', () => {
    assert.match(rosterEntryToDumpRow(entry({ url: '' }), 'Kia').skip, /no dealer website/);
    assert.match(rosterEntryToDumpRow(entry({ url: 'https://www.kia.com/us/en/x' }), 'Kia').skip, /OEM marketing host/);
  });
});

describe('mergeRosterIntoDump', () => {
  const dump = [
    { make: 'Kia', name: 'Keep NJ', state: 'NJ', domain: 'a.com', source: 'oem-locator' },
    { make: 'Kia', name: 'Old LA', state: 'LA', domain: 'old.com', source: 'oem-locator' },
  ];
  const roster = [entry({ name: 'B Kia', state: 'LA', url: 'https://b.com' }), entry({ name: 'A Kia', state: 'LA', url: 'https://a-la.com' }), entry({ name: 'FL Kia', state: 'FL' }), entry({ name: 'No Site', state: 'LA', url: null }), entry({ name: 'A Kia', state: 'LA', url: 'https://dup.com' })];
  it('replaces only the listed states and keeps every other row as it was', () => {
    const { rows, report } = mergeRosterIntoDump({ dump, roster, states: ['LA', 'AR'], make: 'Kia' });
    assert.deepEqual(rows[0], dump[0]);
    assert.deepEqual(rows.slice(1).map((r) => r.name), ['A Kia', 'B Kia']);
    assert.ok(!rows.some((r) => r.name === 'FL Kia' || r.name === 'Old LA'));
    assert.deepEqual(report.perState.LA, { rosterEntries: 4, dumpBefore: 1, dumpAfter: 2 });
    assert.deepEqual(report.perState.AR, { rosterEntries: 0, dumpBefore: 0, dumpAfter: 0 });
    assert.deepEqual(report.skipped.map((s) => s.why).sort(), ['duplicate name in state', 'no dealer website']);
  });
});

describe('regenerated rosters match the Sep 15 locator crawl', () => {
  const roster = JSON.parse(fs.readFileSync(new URL('../../dealer-rosters/kia/roster_raw.json', import.meta.url), 'utf8'));
  const EXPECTED = { ar: 8, mi: 22, la: 14, de: 4 };
  for (const [st, n] of Object.entries(EXPECTED)) {
    it(`${st.toUpperCase()}: dealers/${st}/kia.json has every locator dealer (${n})`, () => {
      assert.equal(roster.filter((r) => r.state === st.toUpperCase()).length, n);
      const file = JSON.parse(fs.readFileSync(new URL(`../dealers/${st}/kia.json`, import.meta.url), 'utf8'));
      assert.equal(file.length, n);
      assert.ok(file.every((d) => d.make === 'Kia' && d.state === st.toUpperCase() && d.domain && !/^www\./.test(d.domain)));
      assert.equal(new Set(file.map((d) => d.domain)).size, n, 'no two rooftops share a host');
    });
  }
});
