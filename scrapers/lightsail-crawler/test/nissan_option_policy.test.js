// 2026-27 Nissan option policy (11 models): same engine as the Toyota, Ford, GM, Cadillac, Honda, Kia, Hyundai, Audi, BMW, Mercedes-Benz and Subaru policies.
// Source: docs/option-catalogs-2026-10-14/nissan_lineup_options_by_trim.csv (built from Nissan's own public Build & Price data; see scripts/build_nissan_option_catalog.mjs)
//   -> scripts/build-cadillac-honda-kia-option-policy.mjs -> src/optionPolicies/nissan-2026-2027.json.
// Rule: every paid factory sticker line stays (paid paints, packages, options); accessories, dealer add-ons, $0 items and subscriptions are dropped.
// Trim aliases are exact and unambiguous only; anything ambiguous stays untrusted (no options).
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
const RAW = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionPolicies/nissan-2026-2027.json'), 'utf8'));
const CSV = parseCsv(fs.readFileSync(path.join(repo, 'docs/option-catalogs-2026-10-14/nissan_lineup_options_by_trim.csv'), 'utf8'));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const slug = normalizeOptionKey;
const price = (r) => Number(r.price_usd) || 0;
// The builder's own accessory / subscription rules (scripts/build-cadillac-honda-kia-option-policy.mjs): a CSV row they match is not kept.
const SUBSCRIPTION_RE = /subscription|\bplans?\b|siriusxm|sirius\b|onstar|connectivity|connected (?:service|plan)|monthly|annual|per year|free trial/i;
const ACCESSORY_RE = /\baccessor|aftermarket|\bdealer[- ](?:installed|added|option)|port[- ]installed|weathertech|husky|line-?x|rhino|tonneau|bed ?cover|bed ?rug|bed ?mat|cargo (?:net|liner|mat|tray|organizer|box|divider)|floor (?:mat|liner)|splash guards?|mud ?flaps?/i;
const builderDrops = (r) => SUBSCRIPTION_RE.test(r.item) || ACCESSORY_RE.test(r.item);
const csvPaid = CSV.filter((r) => r.category !== 'Base' && price(r) > 0);
const paid = csvPaid.filter((r) => !builderDrops(r));
// Lines the engine's global non-option filter drops before any policy sees them (shared by every make; see the PR description).
const ENGINE_DROPS = /ProPILOT Assist/i;
const matchable = paid.filter((r) => !ENGINE_DROPS.test(r.item));
const run = (vehicle, names) => optionRowsForVehicle(ALLOW, { make: 'Nissan', ...vehicle }, names.map((name) => ({ name })));
const entries = Object.entries(RAW).flatMap(([scope, p]) => Object.entries(p.trims).flatMap(([tk, t]) => Object.entries(t.options).map(([k, o]) => ({ scope, tk, k, o, trim: t.label }))));
const scopeOf = (r) => `nissan|${slug(r.model)}|${r.year}`;

describe('what is covered: make + model + year + trim', () => {
  it('11 models, 18 model-year policies, 80 trims, 369 entries (86 packages, 0 options, 0 powertrain, 283 paints)', () => {
    assert.equal(Object.keys(RAW).length, 18);
    assert.equal(new Set(Object.values(RAW).map((p) => p.models[0])).size, 11);
    assert.equal(Object.values(RAW).reduce((n, p) => n + Object.keys(p.trims).length, 0), 80);
    assert.equal(entries.length, 369);
    const by = (k) => entries.filter((e) => e.o.kind === k).length;
    assert.deepEqual(['package', 'option', 'powertrain', 'paint'].map(by), [86, 0, 0, 283]);
  });
  it('every policy scope is Nissan + the CSV model + the CSV year', () => {
    assert.deepEqual([...Object.keys(RAW)].sort(), [...new Set(CSV.map(scopeOf))].sort());
  });
  it('another model year, a model the CSV lacks and other makes are untouched', () => {
    for (const v of [{ make: 'Nissan', model: 'Rogue', year: 2025 }, { make: 'Nissan', model: 'Versa', year: 2026 }, { make: 'Nissan', model: 'Titan', year: 2026 }, { make: 'Nissan', model: 'Ariya', year: 2026 }, { make: 'Infiniti', model: 'QX60', year: 2026 }, { make: 'Subaru', model: 'Forester', year: 2026 }]) {
      assert.deepEqual(modelPoliciesFor(ALLOW, v), [], JSON.stringify(v));
      const same = [{ name: 'Cold Weather Package' }];
      assert.equal(optionRowsForVehicle(ALLOW, { ...v, trim: 'SV' }, same), null);
      assert.equal(policyFacetRows(ALLOW, { ...v, trim: 'SV' }, same), null);
    }
  });
  it('the other makes stay covered', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'BMW', model: 'X5', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Mercedes-Benz', model: 'GLC SUV', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Hyundai', model: 'Tucson', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'RAV4', year: 2026 }).length, 1);
  });
  it('the policy file is bundled and listed in the write-path doc and install script', () => {
    assert.ok(fs.readFileSync(path.join(repo, 'scripts/box/2026-10-11-option-policy-write-path.sh'), 'utf8').includes('nissan-2026-2027'));
    assert.ok(fs.readFileSync(path.join(repo, 'docs/OPTION_POLICY_WRITE_PATH.md'), 'utf8').includes('nissan-2026-2027.json'));
  });
});

describe('the CSV is the contract: every paid factory line is in, nothing else is', () => {
  it('every CSV row has a source URL on nissan.com; a flagged row says why', () => {
    for (const r of CSV) assert.match(r.source_url, /^https:\/\/www\.nissanusa\.com\/shopping-tools\/build-price\/c\?modelCode=\d+&versionCode=[A-Z0-9-]+&optionkey=[A-Z0-9]+$/, `${r.year} ${r.model} ${r.trim}`);
    assert.equal(CSV.filter((r) => r.needs_review).length, 33);
    assert.ok(CSV.filter((r) => r.needs_review).every((r) => r.needs_review.length > 20));
  });
  it('every paid CSV row is in its trim\'s policy (make + model + year + trim) at the CSV price', () => {
    assert.equal(csvPaid.length, 369);
    assert.equal(paid.length, 369);
    for (const r of paid) {
      const t = RAW[scopeOf(r)]?.trims[slug(r.trim)];
      assert.ok(t, `${r.year} ${r.model} ${r.trim}: trim missing`);
      const o = Object.values(t.options).find((x) => slug(x.label) === slug(r.item) && x.price === price(r));
      assert.ok(o, `${r.year} ${r.model} ${r.trim}: ${r.item} at $${r.price_usd} missing`);
    }
  });
  it('every paid CSV row also survives the real matcher: the sticker line "<item>" on that exact vehicle comes back at a CSV price', () => {
    for (const r of matchable) {
      const res = run({ model: r.model, year: Number(r.year), trim: r.trim }, [r.item]);
      assert.equal(res.rows.length, 1, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
      const prices = paid.filter((x) => scopeOf(x) === scopeOf(r) && x.trim === r.trim && slug(x.item) === slug(r.item)).map(price);
      assert.ok(prices.includes(res.rows[0].price), `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('nothing is in the policy that is not a paid CSV row: no Base price, no $0 row, no accessory', () => {
    const want = paid.map((r) => `${scopeOf(r)}|${slug(r.trim)}|${slug(r.item)}|${price(r)}`).sort();
    const have = entries.map((e) => `${e.scope}|${e.tk}|${slug(e.o.label)}|${e.o.price}`).sort();
    assert.deepEqual(have, want);
    for (const { o, trim } of entries) {
      assert.ok(o.price > 0, `${trim} ${o.label}`);
      assert.notEqual(o.label, 'Base Price (trim MSRP)');
      assert.doesNotMatch(o.label, /by Mopar|floor mats?|splash guards?|subscription|MyFlexCare/i, o.label);
    }
  });
  it('accessories, dealer add-ons, subscriptions and standard equipment from a feed never become options', () => {
    const junk = ['Carpeted Floor Mats', 'All-Weather Floor Mats', 'Splash Guards', 'Cargo Net', 'Ceramic Coating', 'Nitrogen Tires', 'Wheel Locks', 'Roof Rack Cross Bars', 'Heated Seats', 'Leather Seats'];
    for (const key of Object.keys(RAW).slice(0, 6)) {
      const p = RAW[key];
      const trim = Object.values(p.trims)[0].label;
      assert.deepEqual(run({ model: p.models[0], year: Number(key.split('|')[2]), trim }, junk).rows, [], `${key} ${trim}`);
    }
  });
  it('the generated JSON and reports are current', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-cadillac-honda-kia-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('Nissan specifics', () => {
  it('a paid line comes back with its kind and price (Scarlet Ember Tintcoat $450 on the 2026 SR)', () => {
    const r = run({ model: RAW['nissan|altima|2026'].models[0], year: 2026, trim: 'SR' }, ['Scarlet Ember Tintcoat']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]), [['paint', 450]]);
  });
  it('no trusted trim -> no options (trim missing or not in the CSV)', () => {
    const key = Object.keys(RAW)[0], p = RAW[key], yr = Number(key.split('|')[2]);
    assert.deepEqual(run({ model: p.models[0], year: yr, trim: 'Nope' }, ['Scarlet Ember Tintcoat']).rows, []);
    assert.deepEqual(run({ model: p.models[0], year: yr, trim: null }, ['Scarlet Ember Tintcoat']).rows, []);
  });
  it('a blank or untrusted trim on the sync payload leaves stored rows alone (skip, never wipe)', () => {
    const key = Object.keys(RAW)[0], p = RAW[key], yr = Number(key.split('|')[2]);
    for (const trim of ['', 'Nope']) assert.deepEqual(policyFacetRows(ALLOW, { make: 'Nissan', model: p.models[0], year: yr, trim }, [{ name: 'Cold Weather Package' }]), { skip: true });
  });
});
