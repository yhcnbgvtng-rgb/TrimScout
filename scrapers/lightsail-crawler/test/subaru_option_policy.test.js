// 2026-27 Subaru option policy (10 models): same engine as the Toyota, Ford, GM, Cadillac, Honda, Kia, Hyundai, Audi, BMW and Mercedes policies.
// Source: docs/option-catalogs-2026-10-14/subaru_lineup_options_by_trim.csv (scripts/fetch_subaru_option_catalog.mjs, from subaru.com's own Build & Price data)
//   -> scripts/build-cadillac-honda-kia-option-policy.mjs -> src/optionPolicies/subaru-2026-2027.json.
// Rule: every paid factory sticker line stays (paid paints incl. two-tone, option packages, powertrain upcharges); accessories, dealer add-ons, $0 items and subscriptions are dropped.
// Trim aliases are exact and unambiguous only; an ambiguous feed trim (Ascent "Premium" = 7- or 8-Passenger) is left untrusted.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle, policyFacetRows, resolvePolicyTrim } from '../src/factoryOptionAllowlist.js';
import { parseCsv } from '../../../scripts/lib/optionPolicyCommon.mjs';
import { normalizeOptionKey } from '../src/inventoryOptionRows.js';
import { ALIASES } from '../../../scripts/lib/optionPolicyAliases.mjs';
import { rowsFor } from '../../../scripts/fetch_subaru_option_catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const RAW = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionPolicies/subaru-2026-2027.json'), 'utf8'));
const CSV = parseCsv(fs.readFileSync(path.join(repo, 'docs/option-catalogs-2026-10-14/subaru_lineup_options_by_trim.csv'), 'utf8'));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const slug = normalizeOptionKey;
const price = (r) => Number(r.price_usd) || 0;
const paid = CSV.filter((r) => r.category !== 'Base' && price(r) > 0);
const run = (vehicle, names) => optionRowsForVehicle(ALLOW, { make: 'Subaru', ...vehicle }, names.map((name) => ({ name })));
const entries = Object.entries(RAW).flatMap(([scope, p]) => Object.entries(p.trims).flatMap(([tk, t]) => Object.entries(t.options).map(([k, o]) => ({ scope, tk, k, o, trim: t.label }))));
const scopeOf = (r) => `subaru|${slug(r.model)}|${r.year}`;
const resolve = (year, model, trim) => {
  const v = { make: 'Subaru', year, model, trim };
  const ps = modelPoliciesFor(ALLOW, v);
  if (!ps.length) return { scope: null, trim: null };
  for (const p of ps) { const hit = resolvePolicyTrim(p, trim, model); if (hit) return { scope: p.scope, trim: hit.trim.label }; }
  return { scope: ps[0].scope, trim: null };
};

describe('what is covered: make + model + year + trim', () => {
  it('10 models, 14 model-year policies, 67 trims, 144 entries (15 packages, 0 options, 3 powertrain, 126 paints)', () => {
    assert.equal(Object.keys(RAW).length, 14);
    assert.equal(new Set(Object.values(RAW).map((p) => p.models[0])).size, 10);
    assert.equal(Object.values(RAW).reduce((n, p) => n + Object.keys(p.trims).length, 0), 67);
    assert.equal(entries.length, 144);
    const by = (k) => entries.filter((e) => e.o.kind === k).length;
    assert.deepEqual(['package', 'option', 'powertrain', 'paint'].map(by), [15, 0, 3, 126]);
  });
  it('every policy scope is Subaru + the CSV model + the CSV year', () => {
    assert.deepEqual([...Object.keys(RAW)].sort(), [...new Set(CSV.map(scopeOf))].sort());
  });
  it('model years the site does not list yet (2027 Crosstrek / Forester / Outback / Impreza / WRX / Solterra), a model the CSV lacks and other makes are untouched', () => {
    for (const v of [
      { make: 'Subaru', model: 'Crosstrek', year: 2027 }, { make: 'Subaru', model: 'Impreza', year: 2027 }, { make: 'Subaru', model: 'Solterra', year: 2027 },
      { make: 'Subaru', model: 'Outback', year: 2025 }, { make: 'Subaru', model: 'Legacy', year: 2026 }, { make: 'Subaru', model: 'Baja', year: 2026 },
      { make: 'Mazda', model: 'CX-5', year: 2026 }, { make: 'Toyota', model: 'GR86', year: 2026 },
    ]) {
      assert.deepEqual(modelPoliciesFor(ALLOW, v), [], JSON.stringify(v));
      const same = [{ name: 'Option Package 13' }];
      assert.equal(optionRowsForVehicle(ALLOW, { ...v, trim: 'Premium' }, same), null);
      assert.equal(policyFacetRows(ALLOW, { ...v, trim: 'Premium' }, same), null);
    }
  });
  it('the other makes stay covered', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'BMW', model: 'X5', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Mercedes-Benz', model: 'GLC SUV', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Hyundai', model: 'Tucson', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'RAV4', year: 2026 }).length, 1);
  });
  it('the policy file is bundled and listed in the write-path doc and install script', () => {
    assert.ok(fs.readFileSync(path.join(repo, 'scripts/box/2026-10-11-option-policy-write-path.sh'), 'utf8').includes('subaru-2026-2027'));
    assert.ok(fs.readFileSync(path.join(repo, 'docs/OPTION_POLICY_WRITE_PATH.md'), 'utf8').includes('subaru-2026-2027.json'));
  });
});

describe('the CSV is the contract: every paid factory line is in, nothing else is', () => {
  it('every CSV row has a source URL on subaru.com; a flagged row says why', () => {
    for (const r of CSV) {
      assert.match(r.source_url, /^https:\/\/www\.subaru\.com\/services\/vehicles\/trims\/limiteddetails\/20(26|27)\/[A-Z]{3}$/, `${r.year} ${r.model} ${r.trim}`);
      assert.ok(r.source_file.endsWith(r.source_url.split('/limiteddetails/')[1]));
    }
    assert.equal(CSV.filter((r) => r.needs_review).length, 14);
    assert.ok(CSV.filter((r) => r.needs_review).every((r) => r.category === 'Factory package' && /sticker wording/.test(r.needs_review)));
  });
  it('every paid CSV row is in its trim\'s policy (make + model + year + trim) at the CSV price', () => {
    assert.equal(paid.length, 144);
    for (const r of paid) {
      const t = RAW[scopeOf(r)]?.trims[slug(r.trim)];
      assert.ok(t, `${r.year} ${r.model} ${r.trim}: trim missing`);
      const o = Object.values(t.options).find((x) => slug(x.label) === slug(r.item) && x.price === price(r));
      assert.ok(o, `${r.year} ${r.model} ${r.trim}: ${r.item} at $${r.price_usd} missing`);
    }
  });
  it('every paid CSV row also survives the real matcher: the sticker line "<item>" on that exact vehicle comes back', () => {
    for (const r of paid) {
      const res = run({ model: r.model, year: Number(r.year), trim: r.trim }, [r.item]);
      assert.equal(res.rows.length, 1, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
      assert.equal(res.rows[0].price, price(r), `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('nothing is in the policy that is not a paid CSV row: no Base price, no $0 row, no accessory', () => {
    const want = paid.map((r) => `${scopeOf(r)}|${slug(r.trim)}|${slug(r.item)}|${price(r)}`).sort();
    const have = entries.map((e) => `${e.scope}|${e.tk}|${slug(e.o.label)}|${e.o.price}`).sort();
    assert.deepEqual(have, want);
    for (const { o, trim } of entries) {
      assert.ok(o.price > 0, `${trim} ${o.label}`);
      assert.notEqual(o.label, 'Base Price (trim MSRP)');
    }
  });
  it('accessories, dealer add-ons, subscriptions and standard equipment from a feed never become options', () => {
    const junk = ['All-Weather Floor Mats', 'Cargo Net', 'Splash Guards', 'Ceramic Coating', 'Nitrogen Tires', 'Wheel Locks', 'Roof Rack Cross Bars', 'STARLINK Safety Plus', 'Heated Seats', 'Leather Seats'];
    for (const [model, year, trim] of [['Outback', 2026, 'Premium'], ['Forester', 2026, 'Sport'], ['Ascent', 2027, 'Touring 7-Passenger'], ['Solterra', 2026, 'Limited']]) {
      assert.deepEqual(run({ model, year, trim }, junk).rows, [], `${model} ${trim}`);
    }
  });
  it('the generated JSON and reports are current', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-cadillac-honda-kia-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('the fetcher (scripts/fetch_subaru_option_catalog.mjs) keeps only what the rules keep', () => {
  const trim = (over = {}) => ({
    name: 'Premium', code: 'TDD', msrp: 34995,
    exteriorColors: [{ name: 'Crystal White Pearl', msrp: 0 }, { name: 'Deep Emerald Green Pearl', msrp: 395 }, { name: 'Two Tone', msrp: 495, requiredPackages: ['13'] }],
    transmissions: [{ name: 'Automatic <sup>Lineartronic</sup> CVT', msrp: 0, optionPackages: [
      { code: '12', name: 'Standard Model', msrp: 0 }, { code: '13', name: 'Optional Package', msrp: 2270, features: [{ name: 'Power moonroof' }, { name: 'Navigation' }] },
      { code: '14', name: 'Optional Package', msrp: 0, features: [{ name: 'Color-matched moldings' }] }, { code: '15', name: 'Onyx Edition Package', msrp: 1700, features: [] },
    ] }, { name: '6-speed Automatic', msrp: 850, optionPackages: [] }],
    ...over,
  });
  const rows = rowsFor(2026, 'Outback', 'OBK', [trim()], 'https://www.subaru.com/services/vehicles/trims/limiteddetails/2026/OBK');
  const by = (cat) => rows.filter((r) => r[5] === cat);
  it('paid paints, paid packages and a paid transmission stay; $0 colors, the $0 "Optional Package" and the Standard Model row are dropped', () => {
    assert.deepEqual(by('Exterior color').map((r) => [r[7], r[8]]), [['Deep Emerald Green Pearl', 395], ['Two Tone', 495]]);
    assert.deepEqual(by('Factory package').map((r) => [r[7], r[8]]), [['Option Package 13', 2270], ['Onyx Edition Package', 1700]]);
    assert.deepEqual(by('Powertrain').map((r) => [r[7], r[8]]), [['6-speed Automatic', 850]]);
    assert.equal(by('Base').length, 1);
  });
  it('every row carries the source URL; only a package named from the site code is flagged for review', () => {
    assert.ok(rows.every((r) => r[12] === 'https://www.subaru.com/services/vehicles/trims/limiteddetails/2026/OBK'));
    assert.deepEqual(rows.filter((r) => r[13]).map((r) => r[7]), ['Option Package 13']);
  });
});

describe('exact trim aliases (every feed string is a real one from the 2026-10-13 box2 read-only dry run)', () => {
  const ok = (year, model, feed, want) => { const r = resolve(year, model, feed); assert.ok(r.scope, `${year} ${model} covered`); assert.equal(r.trim && r.trim.toLowerCase(), want.toLowerCase(), `${year} ${model} | ${feed}`); };
  const bad = (year, model, feed) => { const r = resolve(year, model, feed); assert.ok(r.scope, `${year} ${model} covered`); assert.equal(r.trim, null, `${year} ${model} | ${feed} must stay untrusted`); };
  it('transmission / drivetrain / warranty words are noise, nothing else changes', () => {
    ok(2026, 'Outback', 'Touring XT All Wheel', 'Touring XT'); ok(2026, 'Outback', 'Limited AWD CVT', 'Limited'); ok(2026, 'Outback', 'Premium LIFETIME POWERTRAIN', 'Premium');
    ok(2026, 'Crosstrek', 'Limited Hybrid All Wheel', 'Limited Hybrid'); ok(2026, 'Forester', 'Wilderness CVT', 'Wilderness');
    ok(2027, 'Ascent', 'Premium 7-Passenger All Wheel', 'Premium 7-Passenger'); ok(2027, 'Ascent', 'Touring 7-Passenger All Wheel', 'Touring 7-Passenger');
  });
  it('Forester Sport Onyx Edition = Sport (Onyx is Option Package 25 on Sport); Crosstrek / Forester Hybrid model + bare trim = the Hybrid trim', () => {
    ok(2026, 'Forester', 'Sport Onyx Edition', 'Sport');
    ok(2026, 'Crosstrek Hybrid', 'Limited', 'Limited Hybrid'); ok(2026, 'Crosstrek Hybrid', 'Sport', 'Sport Hybrid');
    ok(2026, 'Forester Hybrid', 'Premium', 'Premium Hybrid'); ok(2026, 'Forester Hybrid', 'Touring', 'Touring Hybrid');
  });
  it('Ascent trims that only come in 7-Passenger, the only Uncharted Premium, the only Trailseeker "Touring w/Leather"', () => {
    for (const y of [2026, 2027]) { ok(y, 'Ascent', 'Touring', 'Touring 7-Passenger'); ok(y, 'Ascent', 'Onyx Edition Touring', 'Onyx Edition Touring 7-Passenger'); ok(y, 'Ascent', 'Limited Bronze Edition', 'Limited Bronze Edition 7-Passenger'); ok(y, 'Uncharted', 'Premium', 'Premium FWD'); ok(y, 'Trailseeker', 'Touring w/Leather', 'Touring Leather'); }
  });
  it('ambiguous or unknown trims stay untrusted: Ascent Premium / Limited (7- or 8-Passenger), Forester Standard Model, 2.5RS, Series.Yellow, blank, dealer text, equipment abbreviations', () => {
    for (const y of [2026, 2027]) { bad(y, 'Ascent', 'Premium'); bad(y, 'Ascent', 'Limited'); }
    bad(2026, 'Forester', 'Standard Model'); bad(2026, 'Impreza', '2.5RS'); bad(2026, 'Impreza', '25RS'); bad(2026, 'WRX', 'Series.Yellow'); bad(2026, 'BRZ', 'Series.Yellow');
    bad(2026, 'Outback', ''); bad(2026, 'Outback', null); bad(2026, 'Outback', 'Inventory'); bad(2026, 'Outback', 'AWD'); bad(2026, 'Forester', 'Premium w/BSD/RCTA/PRG'); bad(2026, 'Crosstrek', 'Premium W/Moonroof/BSD/Rcta');
  });
  it('an alias never maps one model year to another', () => {
    assert.equal(resolve(2027, 'Crosstrek Hybrid', 'Limited').scope, null);
    assert.equal(resolve(2027, 'Forester', 'Sport Onyx Edition').scope, null);
    assert.equal(resolve(2025, 'Ascent', 'Touring').scope, null);
  });
  it('every alias key in the table is a scope the policy really has', () => {
    for (const k of Object.keys(ALIASES.subaru)) assert.ok(RAW[`subaru|${slug(k.split('|')[1])}|${k.split('|')[0]}`], k);
  });
});

describe('Subaru specifics', () => {
  it('Option Package 13 is a paid package on the 2026 Outback Premium ($2,270) and a feed line by that name matches it', () => {
    assert.deepEqual(run({ model: 'Outback', year: 2026, trim: 'Premium' }, ['Option Package 13']).rows.map((x) => [x.kind, x.price]), [['package', 2270]]);
  });
  it('two-tone paint is a paid paint ($495 on the 2026 Forester Touring Hybrid)', () => {
    assert.deepEqual(run({ model: 'Forester', year: 2026, trim: 'Touring Hybrid' }, ['Ice Silver Metallic Two Tone']).rows.map((x) => [x.kind, x.price]), [['paint', 495]]);
  });
  it('a transmission upcharge stays (BRZ Limited 6-speed Automatic $850)', () => {
    assert.deepEqual(run({ model: 'BRZ', year: 2026, trim: 'Limited' }, ['6-speed Automatic']).rows.map((x) => [x.kind, x.price]), [['powertrain', 850]]);
  });
  it('no trusted trim -> no options; a blank or untrusted trim on the sync payload leaves stored rows alone (skip, never wipe)', () => {
    assert.deepEqual(run({ model: 'Ascent', year: 2027, trim: 'Premium' }, ['Daybreak Blue Pearl']).rows, []);
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Subaru', model: 'Outback', year: 2026, trim: '' }, [{ name: 'Option Package 13' }]), { skip: true });
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Subaru', model: 'Ascent', year: 2027, trim: 'Premium' }, [{ name: 'Daybreak Blue Pearl' }]), { skip: true });
  });
});
