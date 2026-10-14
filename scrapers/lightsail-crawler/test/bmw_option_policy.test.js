// 2026-27 BMW option policy (25 models): the approved rules, same engine as the Toyota, Ford, GM, Cadillac, Honda, Kia, Hyundai and Audi policies.
// Source: docs/option-catalogs-2026-10-12/bmw_lineup_options_by_trim.csv -> scripts/build-cadillac-honda-kia-option-policy.mjs -> src/optionPolicies/bmw-2026-2027.json.
// Paul's rule: every paid factory line on the window sticker stays (paints, packages, options, wheels, paid interior colors / materials / trim, design styles);
// accessories, dealer add-ons, $0 items and subscription-only items are dropped.
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
const RAW = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionPolicies/bmw-2026-2027.json'), 'utf8'));
const CSV = parseCsv(fs.readFileSync(path.join(repo, 'docs/option-catalogs-2026-10-12/bmw_lineup_options_by_trim.csv'), 'utf8'));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const slug = normalizeOptionKey;
const price = (r) => Number(r.price_usd) || 0;
const paid = CSV.filter((r) => r.category !== 'Base' && price(r) > 0);
const codeOf = (r) => { const m = /(?:^|;\s*)key=code:\s*([^;]+)/.exec(r.notes); return m ? m[1].trim() : null; };
const keyOf = (r) => slug(codeOf(r) || r.item);
const run = (vehicle, names) => optionRowsForVehicle(ALLOW, { make: 'BMW', ...vehicle }, names.map((name) => ({ name })));
const entries = Object.entries(RAW).flatMap(([scope, p]) => Object.entries(p.trims).flatMap(([tk, t]) => Object.entries(t.options).map(([k, o]) => ({ scope, tk, k, o, trim: t.label }))));

describe('what is covered: make + model + year + trim', () => {
  it('25 models, one policy per model and year, 60 trims, 2,009 entries (350 packages, 1,075 options, 0 powertrain, 584 paints)', () => {
    assert.equal(CSV.length, 2069);
    assert.equal(Object.keys(RAW).length, 26);
    assert.equal(new Set(Object.values(RAW).map((p) => p.models[0])).size, 25);
    assert.equal(Object.values(RAW).reduce((n, p) => n + Object.keys(p.trims).length, 0), 60);
    assert.equal(entries.length, 2009);
    const by = (k) => entries.filter((e) => e.o.kind === k).length;
    assert.deepEqual(['package', 'option', 'powertrain', 'paint'].map(by), [350, 1075, 0, 584]);
  });
  it('every policy scope is BMW + the CSV model + the CSV year', () => {
    const want = new Set(CSV.map((r) => `bmw|${slug(r.model)}|${r.year}`));
    assert.deepEqual([...Object.keys(RAW)].sort(), [...want].sort());
  });
  it('another model year, a model the CSV lacks and other makes are untouched', () => {
    for (const v of [
      { make: 'BMW', model: 'X5', year: 2025 }, { make: 'BMW', model: 'X3', year: 2025 }, { make: 'BMW', model: 'Z4', year: 2026 }, { make: 'BMW', model: 'iX', year: 2026 },
      { make: 'MINI', model: 'Cooper', year: 2026 }, { make: 'Genesis', model: 'GV70', year: 2026 },
    ]) {
      const covered = modelPoliciesFor(ALLOW, v);
      assert.deepEqual(covered, [], JSON.stringify(v));
      const same = [{ name: 'Glass Controls' }];
      assert.equal(optionRowsForVehicle(ALLOW, { ...v, trim: 'xDrive40i' }, same), null);
      assert.equal(policyFacetRows(ALLOW, { ...v, trim: 'xDrive40i' }, same), null);
    }
  });
  it('the other makes stay covered', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Audi', model: 'Q9', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Hyundai', model: 'Tucson', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Kia', model: 'Sorento', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'RAV4', year: 2026 }).length, 1);
  });
  it('the policy file is bundled and listed in the write-path doc and install script', () => {
    assert.ok(fs.readFileSync(path.join(repo, 'scripts/box/2026-10-11-option-policy-write-path.sh'), 'utf8').includes('bmw-2026-2027'));
    assert.ok(fs.readFileSync(path.join(repo, 'docs/OPTION_POLICY_WRITE_PATH.md'), 'utf8').includes('bmw-2026-2027.json'));
  });
});

describe('the CSV is the contract: every paid factory line is in at its price, nothing else is', () => {
  it('every paid CSV row is in its trim\'s policy (make + model + year + trim) at the CSV price', () => {
    assert.equal(paid.length, 2009);
    for (const r of paid) {
      const t = RAW[`bmw|${slug(r.model)}|${r.year}`]?.trims[slug(r.trim)];
      assert.ok(t, `${r.year} ${r.model} ${r.trim}: trim missing`);
      const o = t.options[keyOf(r)];
      assert.ok(o, `${r.year} ${r.model} ${r.trim}: ${r.item} missing`);
      assert.equal(o.price, price(r), `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('every paid CSV row also survives the real matcher: the sticker line "<item>" on that exact vehicle comes back at the CSV price', () => {
    for (const r of paid) {
      const res = run({ model: r.model, year: Number(r.year), trim: r.trim }, [r.item]);
      assert.equal(res.rows.length, 1, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
      assert.equal(res.rows[0].price, price(r), `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('nothing is in the policy that is not a paid CSV row: no Base price, no $0 row, no accessory, no subscription', () => {
    const want = new Set(paid.map((r) => `bmw|${slug(r.model)}|${r.year}|${slug(r.trim)}|${keyOf(r)}`));
    const have = entries.map((e) => `${e.scope}|${e.tk}|${e.k}`);
    assert.equal(have.length, want.size);
    assert.deepEqual(have.filter((x) => !want.has(x)), []);
    for (const { o, trim } of entries) {
      assert.ok(o.price > 0, `${trim} ${o.label}`);
      assert.notEqual(o.label, 'Base Price (trim MSRP)');
      assert.doesNotMatch(o.label, /accessor|subscription|floor mat|cargo (net|liner|mat)|splash|\bplan\b/i, o.label);
    }
  });
  it('no Base CSV row becomes an option on its trim', () => {
    for (const r of CSV.filter((x) => x.category === 'Base')) {
      const o = RAW[`bmw|${slug(r.model)}|${r.year}`].trims[slug(r.trim)].options;
      assert.equal(o[slug(r.item)], undefined, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('accessories, dealer add-ons, subscriptions and standard equipment from a feed never become options', () => {
    const junk = ['Carpeted Floor Mats', 'All-Weather Floor Mats', 'Cargo Net', 'Splash Guards', 'BMW Connected Drive Subscription', 'SiriusXM Subscription', 'Ceramic Coating', 'Nitrogen Tires', 'Wheel Locks', 'Roof Rack Cross Bars', 'Heated Seats', 'Leather Seats'];
    for (const [v, t] of [[{ model: 'X5', year: 2027 }, 'X5 40 xDrive'], [{ model: 'X7', year: 2027 }, 'X7 M60i'], [{ model: '3 Series Sedan', year: 2026 }, '330i Sedan']]) {
      assert.deepEqual(run({ ...v, trim: t }, junk).rows, [], `${v.model} ${t}`);
    }
  });
  it('the generated JSON and reports are current', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-cadillac-honda-kia-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('BMW specifics', () => {
  it('V2H and V2L are not in the CSV, so there is nothing to drop; no entry is a vehicle-to-home / vehicle-to-load line', () => {
    assert.equal(CSV.filter((r) => /\bV2[HL]\b|vehicle[- ]to[- ](home|load|grid)/i.test(`${r.item} ${r.notes}`)).length, 0);
    assert.deepEqual(entries.filter((e) => /\bv2[hl]\b|vehicle to (home|load|grid)/i.test(e.o.label)), []);
  });
  it('X5 Glass Controls stays: BMW Glass Controls $650 on the X5 40 xDrive, keyed on its code S042A', () => {
    const r = run({ model: 'X5', year: 2027, trim: 'X5 40 xDrive' }, ['BMW Glass Controls']);
    assert.deepEqual(r.rows.map((x) => [x.key, x.kind, x.price, x.code]), [['s042a', 'option', 650, null]]);
    assert.equal(RAW['bmw|x5|2027'].trims['x5 40 xdrive'].options.s042a.price, 650);
  });
  it('Glass Controls stays a $650 option on the 3 Series', () => {
    assert.deepEqual(run({ model: '3 Series Sedan', year: 2026, trim: '330i Sedan' }, ['Glass Controls']).rows.map((x) => [x.kind, x.price]), [['option', 650]]);
  });
  it('Highway Assistant stays a plain $800 option on the X7 M60i, with no flag or rule attached', () => {
    const o = RAW['bmw|x7|2027'].trims['x7 m60i'].options['highway assistant'];
    assert.equal(o.price, 800); assert.equal(o.kind, 'option'); assert.equal(o.rules, undefined); assert.equal(o.flag, undefined);
    assert.deepEqual(run({ model: 'X7', year: 2027, trim: 'X7 M60i' }, ['Highway Assistant']).rows.map((x) => [x.kind, x.price]), [['option', 800]]);
  });
  it('the 3 code-keyed rows are keyed on the code without the "code:" prefix', () => {
    const coded = entries.filter((e) => e.o.code);
    assert.equal(coded.length, 3);
    for (const e of coded) { assert.doesNotMatch(e.o.code, /code:/i); assert.equal(e.k, slug(e.o.code)); }
  });
  it('requires / not-available notes are stored as rules (328), never as options', () => {
    assert.equal(entries.reduce((n, e) => n + (e.o.rules || []).length, 0), 328);
  });
  it('no trusted trim -> no options (trim missing or not in the CSV)', () => {
    assert.deepEqual(run({ model: 'X5', year: 2027, trim: 'Nope' }, ['BMW Glass Controls']).rows, []);
    assert.deepEqual(run({ model: 'X5', year: 2027, trim: null }, ['BMW Glass Controls']).rows, []);
  });
  it('a blank trim on the sync payload leaves stored rows alone, a trim the policy does not trust also leaves them alone (skip, never wipe)', () => {
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'BMW', model: 'X5', year: 2027, trim: '' }, [{ name: 'BMW Glass Controls' }]), { skip: true });
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'BMW', model: 'X5', year: 2027, trim: 'Nope' }, [{ name: 'BMW Glass Controls' }]), { skip: true });
  });
});
