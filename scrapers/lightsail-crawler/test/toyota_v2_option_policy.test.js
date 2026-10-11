// Toyota v2 lineup file (docs/toyota-2026-2027/toyota_lineup_options_by_trim.csv) -> src/optionPolicies/toyota-2026-2027.json, plus Paul's 2026-10-11 calls.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, normalizeOptionKey } from '../../../scripts/lib/optionPolicyCommon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const rows = parseCsv(fs.readFileSync(path.join(repo, 'docs/toyota-2026-2027/toyota_lineup_options_by_trim.csv'), 'utf8'));
const policies = JSON.parse(fs.readFileSync(path.join(here, '../src/optionPolicies/toyota-2026-2027.json'), 'utf8'));
const clean = (t) => t.replace(/®|™/g, '').replace(/\s+/g, ' ').trim();
const slug = normalizeOptionKey;
const trimOf = (r) => policies[`toyota|${slug(r.model)}|${r.year}`]?.trims[slug(r.trim)];
const paidRows = rows.filter((r) => r.category !== 'Base' && Number(r.price_usd) > 0);
const optionsOf = (year, model, trim) => Object.values(policies[`toyota|${slug(model)}|${year}`].trims[slug(trim)].options);

describe('v2 file shape', () => {
  it('758 rows, 24 models, 125 trims', () => {
    assert.equal(rows.length, 758);
    assert.equal(new Set(rows.map((r) => `${r.year}|${r.model}`)).size, 24);
    assert.equal(new Set(rows.map((r) => `${r.year}|${r.model}|${r.trim}`)).size, 125);
  });
  it('every non-Base row in v2 is paid (the file already dropped $0 / accessory / subscription rows)', () => {
    assert.equal(paidRows.length, rows.filter((r) => r.category !== 'Base').length);
    assert.deepEqual([...new Set(rows.map((r) => r.category))].sort(), ['Base', 'Exterior color', 'Factory option', 'Factory package', 'Powertrain']);
  });
});

describe('every paid v2 row is in its trim\'s policy at the CSV price', () => {
  const covered = paidRows.filter((r) => !(r.year === '2026' && r.model === 'RAV4')); // 2026 RAV4 stays PR #432's policy
  it('covers the rows', () => assert.ok(covered.length > 600, String(covered.length)));
  for (const r of covered) {
    it(`${r.year} ${r.model} ${r.trim}: ${r.item} $${r.price_usd}`, () => {
      const t = trimOf(r);
      assert.ok(t, `no policy trim for ${r.year} ${r.model} ${r.trim}`);
      const o = t.options[slug(clean(r.item))];
      assert.ok(o, `missing: ${r.item}`);
      assert.equal(o.price, Number(r.price_usd));
      assert.equal(o.label, clean(r.item));
    });
  }
  it('kinds: Factory package -> package, Factory option -> option, Exterior color (incl. Two-tone) -> paint, Drivetrain -> option, Transmission -> powertrain', () => {
    for (const r of covered) {
      const want = { 'Factory package': 'package', 'Factory option': 'option', 'Exterior color': 'paint' }[r.category] || (r.subcategory === 'Drivetrain' ? 'option' : 'powertrain');
      assert.equal(trimOf(r).options[slug(clean(r.item))].kind, want, `${r.model} ${r.trim} ${r.item}`);
    }
  });
});

describe('no $0, Base, accessory or cab/bed row becomes an option', () => {
  const paidKeys = new Set(paidRows.map((r) => `${r.year}|${slug(r.model)}|${slug(r.trim)}|${slug(clean(r.item))}`));
  const added = new Set(); // Paul's Tundra rows
  for (const t of ['sr5', 'limited', 'limited i force max', 'platinum', '1794 edition']) added.add(`2026|tundra|${t}|trd off road package`);
  it('every policy entry is a paid CSV row or one of Paul\'s five additions, priced > 0', () => {
    let n = 0;
    for (const [scope, p] of Object.entries(policies)) {
      const year = scope.split('|')[2];
      const csvModelSlugs = scope.split('|')[1];
      for (const [tk, t] of Object.entries(p.trims)) for (const [k, o] of Object.entries(t.options)) {
        n++;
        assert.ok(o.price > 0, `${scope} ${t.label} ${o.label}`);
        assert.ok(paidKeys.has(`${year}|${csvModelSlugs}|${tk}|${k}`) || added.has(`${year}|${csvModelSlugs}|${tk}|${k}`), `${scope} ${t.label} ${o.label} is not a paid CSV row`);
      }
    }
    assert.ok(n > 600);
  });
  it('no Base / MSRP / cab-bed / accessory / subscription label is an option', () => {
    const bad = /base price|base msrp|\b(?:crewmax|double cab|xtracab|regular cab)\b|\b\d+(?:\.\d)?-?ft\b|accessor|\bmats?\b|subscription|connected services|safety connect|wheel locks?/i;
    for (const [scope, p] of Object.entries(policies)) for (const t of Object.values(p.trims)) for (const o of Object.values(t.options)) assert.ok(!bad.test(o.label), `${scope} ${t.label}: ${o.label}`);
  });
  it('the Tacoma and Tundra cab/bed choices stay notes on the Base rows', () => {
    const base = rows.filter((r) => r.category === 'Base' && /cab\/bed:/.test(r.notes) && /^(Tacoma|Tundra)$/.test(r.model));
    assert.ok(base.length >= 18, String(base.length));
    for (const r of base) assert.ok(!Object.keys(trimOf(r).options).some((k) => /cab|bed|crewmax/.test(k)), `${r.model} ${r.trim}`);
  });
  it('the CSV has no Interior, Accessory or $0 category left to leak', () => assert.ok(rows.every((r) => r.category === 'Base' || Number(r.price_usd) > 0)));
});

describe('Paul\'s calls (2026-10-11)', () => {
  it('1: Tundra TRD Off-Road Package on the five Mudbath-pop-up trims, at the price in the Base note', () => {
    const want = { SR5: 2125, Limited: 3580, 'Limited i-FORCE MAX': 3580, Platinum: 2180, '1794 Edition': 2140 };
    for (const [trim, price] of Object.entries(want)) {
      const o = optionsOf(2026, 'Tundra', trim).find((x) => x.label === 'TRD Off-Road Package');
      assert.equal(o?.price, price, trim);
      assert.equal(o.kind, 'package');
      const base = rows.find((r) => r.year === '2026' && r.model === 'Tundra' && r.trim === trim && r.category === 'Base');
      assert.match(base.notes, new RegExp(`Mudbath paint only via TRD Off-Road Package \\$${price.toLocaleString('en-US')}\\b[\\s\\S]*so no row`), trim); // the CSV agrees: no row of its own
      assert.ok(!rows.some((r) => r.year === '2026' && r.model === 'Tundra' && r.trim === trim && r.item === 'TRD Off-Road Package'), trim);
    }
  });
  it('1: the trims that already had the package in the CSV are untouched (Platinum / 1794 Edition i-FORCE MAX)', () => {
    assert.equal(optionsOf(2026, 'Tundra', 'Platinum i-FORCE MAX').find((x) => x.label === 'TRD Off-Road Package').price, 2180);
    assert.equal(optionsOf(2026, 'Tundra', '1794 Edition i-FORCE MAX').find((x) => x.label === 'TRD Off-Road Package').price, 2140);
  });
  it('2: Tacoma TRD Off-Road keeps separate manual and automatic package rows', () => {
    const o = optionsOf(2026, 'Tacoma', 'TRD Off-Road'); // the CSV names the manual rows without a suffix (their contents say "(M/T)"), the automatic ones "(A/T)"
    const price = (l) => o.find((x) => x.label === l)?.price;
    assert.equal(price('TRD Off-Road Premium Package'), 8940);
    assert.equal(price('TRD Off-Road Premium Package (A/T)'), 9220);
    assert.equal(price('TRD Off-Road Upgrade Package'), 4825);
    assert.equal(price('TRD Off-Road Upgrade Package (A/T)'), 4840);
    assert.equal(o.find((x) => x.label === '8-Speed Automatic').kind, 'powertrain');
  });
  it('3: bZ AWD deltas kept and flagged unconfirmed - and nothing else is flagged', () => {
    const awd = (trim) => optionsOf(2027, 'bZ', trim).find((x) => x.label === 'All-Wheel Drive');
    assert.deepEqual([awd('bZ XLE').price, awd('bZ XLE').unconfirmed], [5000, true]);
    assert.deepEqual([awd('bZ Limited').price, awd('bZ Limited').unconfirmed], [2000, true]);
    const flagged = [];
    for (const [s, p] of Object.entries(policies)) for (const t of Object.values(p.trims)) for (const o of Object.values(t.options)) if (o.unconfirmed) flagged.push(`${s}|${t.label}|${o.label}`);
    assert.deepEqual(flagged.sort(), ['toyota|bz|2027|bZ Limited|All-Wheel Drive', 'toyota|bz|2027|bZ XLE|All-Wheel Drive']);
    assert.equal(optionsOf(2027, 'bZ', 'bZ XLE').find((x) => x.label === 'Front-Wheel Drive Plus').unconfirmed, undefined); // confirmed on Summary
  });
  it('4: Digital Key is kept at $275 on every trim that lists it', () => {
    const dk = paidRows.filter((r) => /^Digital Key/.test(r.item));
    assert.ok(dk.length >= 8);
    for (const r of dk) assert.equal(trimOf(r).options[slug(clean(r.item))].price, 275);
  });
  it('Mirai is not buildable: no row in v2 and no policy', () => {
    assert.ok(!rows.some((r) => /mirai/i.test(r.model)));
    assert.ok(!Object.keys(policies).some((k) => k.includes('mirai')));
  });
});
