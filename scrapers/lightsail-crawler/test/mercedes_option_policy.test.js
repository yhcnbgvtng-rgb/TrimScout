// 2026-27 Mercedes-Benz option policy (25 models): the approved rules, same engine as the Toyota, Ford, GM, Cadillac, Honda, Kia, Hyundai, Audi and BMW policies.
// Source: docs/option-catalogs-2026-10-12/mercedes_lineup_options_by_trim.csv -> scripts/build-cadillac-honda-kia-option-policy.mjs -> src/optionPolicies/mercedes-2026-2027.json.
// Paul's rule: every paid factory line on the window sticker stays (paints incl. MANUFAKTUR, packages, options, wheels, paid interior colors / materials / trim);
// accessories, dealer add-ons and $0 items are dropped. Paul's ruling: Digital Extras (flagged as subscriptions in the CSV) stay.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle, policyFacetRows } from '../src/factoryOptionAllowlist.js';
import { parseCsv } from '../../../scripts/lib/optionPolicyCommon.mjs';
import { normalizeOptionKey } from '../src/inventoryOptionRows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const RAW = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionPolicies/mercedes-2026-2027.json'), 'utf8'));
const CSV = parseCsv(fs.readFileSync(path.join(repo, 'docs/option-catalogs-2026-10-12/mercedes_lineup_options_by_trim.csv'), 'utf8'));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const slug = normalizeOptionKey;
const price = (r) => Number(r.price_usd) || 0;
const paid = CSV.filter((r) => r.category !== 'Base' && price(r) > 0);
const insidePackage = (r) => /\(inside package /i.test(r.item);
const run = (vehicle, names) => optionRowsForVehicle(ALLOW, { make: 'Mercedes-Benz', ...vehicle }, names.map((name) => ({ name })));
const entries = Object.entries(RAW).flatMap(([scope, p]) => Object.entries(p.trims).flatMap(([tk, t]) => Object.entries(t.options).map(([k, o]) => ({ scope, tk, k, o, trim: t.label }))));
const scopeOf = (r) => `mercedes-benz|${slug(r.model)}|${r.year}`;

describe('what is covered: make + model + year + trim', () => {
  it('25 models, one policy per model and year, 67 trims, 2,962 entries (473 packages, 1,469 options, 0 powertrain, 1,020 paints)', () => {
    assert.equal(CSV.length, 3029);
    assert.equal(Object.keys(RAW).length, 26);
    assert.equal(new Set(Object.values(RAW).map((p) => p.models[0])).size, 25);
    assert.equal(Object.values(RAW).reduce((n, p) => n + Object.keys(p.trims).length, 0), 67);
    assert.equal(entries.length, 2962);
    const by = (k) => entries.filter((e) => e.o.kind === k).length;
    assert.deepEqual(['package', 'option', 'powertrain', 'paint'].map(by), [473, 1469, 0, 1020]);
  });
  it('every policy scope is Mercedes-Benz + the CSV model + the CSV year (the make is the canonical "Mercedes-Benz")', () => {
    const want = new Set(CSV.map(scopeOf));
    assert.deepEqual([...Object.keys(RAW)].sort(), [...want].sort());
  });
  it('another model year, a model the CSV lacks and other makes are untouched', () => {
    for (const v of [
      { make: 'Mercedes-Benz', model: 'C-Class Sedan', year: 2025 }, { make: 'Mercedes-Benz', model: 'EQB', year: 2026 }, { make: 'Mercedes-Benz', model: 'Sprinter', year: 2026 },
      { make: 'Genesis', model: 'GV70', year: 2026 }, { make: 'Lexus', model: 'RX', year: 2026 },
    ]) {
      assert.deepEqual(modelPoliciesFor(ALLOW, v), [], JSON.stringify(v));
      const same = [{ name: 'Digital Extra: MB.DRIVE ASSIST' }];
      assert.equal(optionRowsForVehicle(ALLOW, { ...v, trim: 'GLC 300 SUV' }, same), null);
      assert.equal(policyFacetRows(ALLOW, { ...v, trim: 'GLC 300 SUV' }, same), null);
    }
  });
  it('the other makes stay covered', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'BMW', model: 'X5', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Audi', model: 'Q9', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Hyundai', model: 'Tucson', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'RAV4', year: 2026 }).length, 1);
  });
  it('the policy file is bundled and listed in the write-path doc and install script', () => {
    assert.ok(fs.readFileSync(path.join(repo, 'scripts/box/2026-10-11-option-policy-write-path.sh'), 'utf8').includes('mercedes-2026-2027'));
    assert.ok(fs.readFileSync(path.join(repo, 'docs/OPTION_POLICY_WRITE_PATH.md'), 'utf8').includes('mercedes-2026-2027.json'));
  });
});

describe('the CSV is the contract: every paid factory line is in, nothing else is', () => {
  it('every paid CSV row is in its trim\'s policy (make + model + year + trim) at the CSV price (the 15 "inside package" rows: price 0, CSV price as packagePrice)', () => {
    assert.equal(paid.length, 2962);
    for (const r of paid) {
      const t = RAW[scopeOf(r)]?.trims[slug(r.trim)];
      assert.ok(t, `${r.year} ${r.model} ${r.trim}: trim missing`);
      const o = Object.values(t.options).find((x) => slug(x.label) === slug(r.item) && (x.packagePrice ?? x.price) === price(r));
      assert.ok(o, `${r.year} ${r.model} ${r.trim}: ${r.item} at $${r.price_usd} missing`);
      if (insidePackage(r)) { assert.equal(o.price, 0); assert.equal(o.additive, false); assert.equal(o.packagePrice, price(r)); } else assert.equal(o.price, price(r));
    }
  });
  it('every paid CSV row also survives the real matcher: the sticker line "<item>" on that exact vehicle comes back (the 15 "inside package" names are cut mid-parenthesis and are dropped by the global unbalanced-paren rule first)', () => {
    let seen = 0;
    for (const r of paid) {
      const res = run({ model: r.model, year: Number(r.year), trim: r.trim }, [r.item]);
      if (insidePackage(r)) { seen++; assert.equal(res.rows.length, 0, r.item); continue; }
      assert.equal(res.rows.length, 1, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
      // the same name at two prices on one trim resolves to the first (documented in the report)
      const prices = paid.filter((x) => scopeOf(x) === scopeOf(r) && x.trim === r.trim && slug(x.item) === slug(r.item)).map(price);
      assert.ok(prices.includes(res.rows[0].price), `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
    assert.equal(seen, 15);
  });
  it('nothing is in the policy that is not a paid CSV row: no Base price, no $0 row, no accessory', () => {
    const want = paid.map((r) => `${scopeOf(r)}|${slug(r.trim)}|${slug(r.item)}|${price(r)}`).sort();
    const have = entries.map((e) => `${e.scope}|${e.tk}|${slug(e.o.label)}|${e.o.packagePrice ?? e.o.price}`).sort();
    assert.deepEqual(have, want);
    for (const { o, trim } of entries) {
      assert.ok(o.price > 0 || o.additive === false, `${trim} ${o.label}`);
      assert.notEqual(o.label, 'Base Price (trim MSRP)');
      assert.doesNotMatch(o.label, /accessor|floor mat|cargo (net|liner|mat)|splash/i, o.label);
    }
  });
  it('no Base CSV row becomes an option on its trim', () => {
    for (const r of CSV.filter((x) => x.category === 'Base')) {
      const o = RAW[scopeOf(r)].trims[slug(r.trim)].options;
      assert.equal(o[slug(r.item)], undefined, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('accessories, dealer add-ons and standard equipment from a feed never become options', () => {
    const junk = ['Carpeted Floor Mats', 'All-Weather Floor Mats', 'Cargo Net', 'Splash Guards', 'Ceramic Coating', 'Nitrogen Tires', 'Wheel Locks', 'Roof Rack Cross Bars', 'Heated Seats', 'Leather Seats'];
    for (const [v, t] of [[{ model: 'GLC SUV', year: 2027 }, 'GLC 300 4MATIC SUV'], [{ model: 'C-Class Sedan', year: 2027 }, 'C 300 Sedan'], [{ model: 'G-Class SUV', year: 2026 }, 'G 550 SUV']]) {
      const key = Object.keys(RAW).find((k) => k.startsWith(`mercedes-benz|${slug(v.model)}|`));
      const trim = Object.values(RAW[key].trims)[0].label;
      assert.deepEqual(run({ model: v.model, year: Number(key.split('|')[2]), trim }, junk).rows, [], `${v.model} ${trim}`);
    }
  });
  it('the generated JSON and reports are current', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-cadillac-honda-kia-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('Mercedes specifics', () => {
  it('Digital Extras stay (Paul\'s ruling): 46 entries, e.g. MB.DRIVE ASSIST $1,950 on the CLA 220 Hybrid', () => {
    const de = entries.filter((e) => /^digital extra/.test(e.k));
    assert.equal(de.length, 46);
    assert.deepEqual(run({ model: 'CLA Sedan', year: 2027, trim: 'CLA 220 Hybrid Sedan' }, ['Digital Extra: MB.DRIVE ASSIST']).rows.map((x) => [x.kind, x.price]), [['package', 1950]]);
  });
  it('MANUFAKTUR paints and interiors stay as paid lines (991 entries mention MANUFAKTUR)', () => {
    assert.equal(entries.filter((e) => /manufaktur/i.test(e.o.label)).length, 991);
    const csvMf = paid.filter((r) => /manufaktur/i.test(r.item));
    assert.equal(csvMf.length, 991);
  });
  it('the trailer hitch stays a paid option and does not become a dealer add-on', () => {
    const h = entries.filter((e) => /trailer hitch/.test(e.k));
    assert.equal(h.length, 19);
    const e = h[0];
    const r = run({ model: Object.values(RAW[e.scope].models)[0], year: Number(e.scope.split('|')[2]), trim: e.trim }, [e.o.label]);
    assert.deepEqual(r.rows.map((x) => x.price), [e.o.price]);
    assert.deepEqual(r.dealerAddons, []);
  });
  it('15 "(inside package ...)" rows are priced at exactly their package\'s own price: kept, but they never add to a price', () => {
    const na = entries.filter((e) => e.o.additive === false);
    assert.equal(na.length, 15);
    for (const e of na) {
      assert.equal(e.o.price, 0);
      const pkg = Object.values(RAW[e.scope].trims[e.tk].options).find((x) => x.kind === 'package' && x.price === e.o.packagePrice && slug(e.o.label).includes(slug(x.label)));
      assert.ok(pkg, `${e.trim} ${e.o.label}: its package row`);
    }
  });
  it('requires / not-available notes are stored as rules (200), never as options', () => {
    assert.equal(entries.reduce((n, e) => n + (e.o.rules || []).length, 0), 200);
  });
  it('the same name at two prices on one trim keeps both (GLC 400 4MATIC Electric: 21-inch AMG Y-spoke $1,300 and $1,600)', () => {
    const o = RAW['mercedes-benz|glc electric suv|2027'].trims['glc 400 4matic electric suv'].options;
    assert.equal(o['21 inch amg y spoke w black accents'].price, 1300);
    assert.equal(o['21 inch amg y spoke w black accents 1600'].price, 1600);
  });
  it('no trusted trim -> no options (trim missing or not in the CSV)', () => {
    assert.deepEqual(run({ model: 'GLC SUV', year: 2027, trim: 'Nope' }, ['Digital Extra: MB.DRIVE ASSIST']).rows, []);
    assert.deepEqual(run({ model: 'GLC SUV', year: 2027, trim: null }, ['Digital Extra: MB.DRIVE ASSIST']).rows, []);
  });
  it('a blank trim on the sync payload leaves stored rows alone, a trim the policy does not trust also leaves them alone (skip, never wipe)', () => {
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Mercedes-Benz', model: 'GLC SUV', year: 2027, trim: '' }, [{ name: 'Digital Extra: MB.DRIVE ASSIST' }]), { skip: true });
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Mercedes-Benz', model: 'GLC SUV', year: 2027, trim: 'Nope' }, [{ name: 'Digital Extra: MB.DRIVE ASSIST' }]), { skip: true });
  });
});
