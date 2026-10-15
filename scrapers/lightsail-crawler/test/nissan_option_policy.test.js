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
import { buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle, policyFacetRows, resolvePolicyTrim } from '../src/factoryOptionAllowlist.js';
import { parseCsv } from '../../../scripts/lib/optionPolicyCommon.mjs';
import { normalizeOptionKey } from '../src/inventoryOptionRows.js';
import { ALIASES } from '../../../scripts/lib/optionPolicyAliases.mjs';

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
// Lines the engine's global non-option filter drops before any policy sees them: none (the ProPILOT carve-out, #519, lets the Armada packages through).
const ENGINE_DROPS = /(?!)/;
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
    for (const v of [{ make: 'Nissan', model: 'Rogue', year: 2025 }, { make: 'Nissan', model: 'Versa', year: 2026 }, { make: 'Nissan', model: 'Titan', year: 2026 }, { make: 'Nissan', model: 'Ariya', year: 2026 }, { make: 'Infiniti', model: 'QX60', year: 2026 }, { make: 'Volkswagen', model: 'Tiguan', year: 2026 }]) {
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
  it('the 2026 Armada ProPILOT Assist 2.1 packages match ($3,370 SL, $3,300 Platinum, $2,900 Platinum Reserve)', () => {
    for (const [trim, name, p] of [['SL', 'SL ProPILOT Assist 2.1 Package', 3370], ['Platinum', 'Platinum ProPILOT Assist 2.1 Package', 3300], ['Platinum Reserve', 'Platinum Reserve ProPILOT Assist 2.1 Package', 2900]]) {
      assert.deepEqual(run({ model: 'Armada', year: 2026, trim }, [name]).rows.map((x) => [x.kind, x.price]), [['package', p]], trim);
    }
  });
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

describe('exact trim aliases (every feed string is a real one from the 2026-10-14 box2 read-only dry run)', () => {
  const resolve = (year, model, trim) => {
    const v = { make: 'Nissan', year, model, trim };
    const ps = modelPoliciesFor(ALLOW, v);
    if (!ps.length) return { scope: null, trim: null };
    for (const p of ps) { const hit = resolvePolicyTrim(p, trim, model); if (hit) return { scope: p.scope, trim: hit.trim.label }; }
    return { scope: ps[0].scope, trim: null };
  };
  const ok = (year, model, feed, want) => { const r = resolve(year, model, feed); assert.ok(r.scope, `${year} ${model} covered`); assert.equal(r.trim, want, `${year} ${model} | ${feed}`); };
  const bad = (year, model, feed) => { const r = resolve(year, model, feed); assert.ok(r.scope, `${year} ${model} covered`); assert.equal(r.trim, null, `${year} ${model} | ${feed} must stay untrusted`); };
  it('transmission, drivetrain, body, "Ltd Avail" and warranty words are noise', () => {
    ok(2026, 'Murano', 'SL AWD Automatic', 'SL'); ok(2026, 'Murano', 'Awd Sl Ltd Avail', 'SL'); ok(2026, 'Pathfinder', 'SL 4WD Automatic', 'SL');
    ok(2027, 'Rogue', 'Dark Armor AWD CVT', 'Dark Armor'); ok(2027, 'Rogue', 'Dark Armor All Wheel', 'Dark Armor'); ok(2027, 'Sentra', 'SV Sedan', 'SV'); ok(2027, 'Sentra', 'SV FWD CVT', 'SV');
    ok(2026, 'Armada', '4x4 SV Ltd Avail', 'SV'); ok(2027, 'Kicks', 'S w/ Lifetime Powertrain', 'S'); ok(2027, 'Z', 'Performance Auto', 'Performance'); ok(2027, 'Z', 'Sport Manual', 'Sport'); ok(2027, 'Z', 'Performance M T', 'Performance');
  });
  it('package names written into the trim: Rogue / Kicks / Sentra', () => {
    ok(2026, 'Rogue', 'SV Cold Weather Package', 'SV'); ok(2026, 'Kicks', 'SV AWD Premium Package', 'SV'); ok(2026, 'Kicks', 'SR AWD Cold Weather', 'SR'); ok(2026, 'Kicks', 'SR PREMIUM', 'SR'); ok(2026, 'Sentra', 'SR Premium Package', 'SR');
  });
  it('spelling variants of one trim', () => {
    ok(2026, 'Rogue', 'Darkarmor', 'Dark Armor'); ok(2026, 'Altima', '2.5 SV', 'SV'); ok(2026, 'Altima', '25 SR', 'SR');
    ok(2026, 'LEAF', 'SV&#x2B', 'SV+'); ok(2026, 'LEAF', 'PLATINUM&#x2B', 'Platinum+'); ok(2026, 'LEAF', 'SV&#x2B FWD Automatic', 'SV+');
    ok(2026, 'Z', 'HERITAGE EDITION', 'Heritage Edition (Z32 Midnight Purple)'); ok(2027, 'Armada', 'PRO-4X', 'PRO-4X Premium');
    ok(2026, 'Rogue Plug-in Hybrid', 'Platinum PLUG IN HYBRID', 'Platinum'); ok(2026, 'Rogue Plug-in Hybrid', 'SL Sport Utility 4D', 'SL');
  });
  it('ambiguous or unknown trims stay untrusted: Frontier bare S, Crew Cab S, Crew Cab 4x4 Long (no cab or bed to choose), trims not on the site, blanks, dealer text', () => {
    for (const y of [2026, 2027]) for (const t of ['S', 'Crew Cab S', 'Crew Cab S 4x4', 'S Crew Cab 4x2', 'Crew Cab 4x4 S', 'Crew Cab 4x4 Long', 'Dark Armor', 'Sport Edition', 'PRO4X Truck Wilsonville OR', 'SV Truck Wilsonville OR', '', null]) bad(y, 'Frontier', t);
    bad(2026, 'Rogue', 'SL'); bad(2027, 'Murano', 'SV'); bad(2026, 'Pathfinder', 'S'); bad(2026, 'Rogue', 'Base');
    bad(2026, 'Rogue', ''); bad(2026, 'Rogue', null); bad(2026, 'Rogue', 'Platinum SUV Wilsonville OR'); bad(2026, 'Rogue', '20265 Awd Platinum'); bad(2027, 'Sentra', 'S S Sedan Regular');
  });
  it('Frontier (ruling 2026-10-14): SV / PRO-4X / PRO-X and their spelling, drivetrain-suffix and package-in-trim variants map to the Crew Cab trim', () => {
    for (const y of [2026, 2027]) {
      for (const t of ['SV', 'Sv', 'SV 4WD Automatic']) ok(y, 'Frontier', t, 'Crew Cab SV');
      for (const t of ['PRO-4X', 'PRO 4X', 'Pro 4x', 'PRO-4X 4WD Automatic', 'PRO-4X w/R Package', 'PRO 4X Wr Package', 'PRO-4X R', 'Crew Cab PRO-4X® R', 'Crew Cab PRO-4X R', 'Crew_cab_pro 4x®_r_by_roush®', 'Pro 4x_by_r_roush', 'PRO-4X w/Wheel & Tire Package']) ok(y, 'Frontier', t, 'Crew Cab PRO-4X');
      for (const t of ['PRO-X', 'PRO X', 'Pro X']) ok(y, 'Frontier', t, 'Crew Cab PRO-X');
      ok(y, 'Frontier', 'Crew Cab SV Long', 'Crew Cab SV Long Bed'); ok(y, 'Frontier', 'Crew Cab PRO-4X® Long', 'Crew Cab PRO-4X Long Bed'); ok(y, 'Frontier', 'Crew Cab PRO-4X Long', 'Crew Cab PRO-4X Long Bed');
    }
  });
  it('Frontier: the trims that already resolved still resolve to themselves (no re-pointing)', () => {
    for (const y of [2026, 2027]) { ok(y, 'Frontier', 'Crew Cab SV', 'Crew Cab SV'); ok(y, 'Frontier', 'SV Crew Cab 4x4', 'Crew Cab SV'); ok(y, 'Frontier', 'Crew Cab SV Long Bed', 'Crew Cab SV Long Bed'); ok(y, 'Frontier', 'King Cab S', 'King Cab S'); ok(y, 'Frontier', 'S King Cab 4x2', 'King Cab S'); }
  });
  it('an alias never maps one model year to another', () => {
    assert.equal(resolve(2027, 'LEAF', 'SV&#x2B').scope, null);
    assert.equal(resolve(2027, 'Altima', '2.5 SV').scope, null);
    assert.equal(resolve(2026, 'Armada', 'PRO-4X').trim, 'PRO-4X');
  });
  it('every alias key in the table is a scope the policy really has', () => {
    for (const k of Object.keys(ALIASES.nissan)) assert.ok(RAW[`nissan|${slug(k.split('|')[1])}|${k.split('|')[0]}`], k);
  });
});

describe('the Nissan apply script (scripts/box/2026-10-14-nissan-option-policy-apply.mjs)', () => {
  const src = fs.readFileSync(path.join(repo, 'scripts/box/2026-10-14-nissan-option-policy-apply.mjs'), 'utf8');
  it('is Nissan-only: Nissan 2026-27 car and dealer queries, its own lock owners, no other make named', () => {
    assert.ok(src.includes("make = 'Nissan' AND year IN (2026, 2027)") && src.includes("AND make = 'Nissan'"));
    assert.ok(src.includes('nissan-option-policy-apply') && src.includes('nissan-option-policy-restore'));
    assert.doesNotMatch(src, /hyundai|subaru/i);
  });
  it('keeps the safety rails: untrusted trims are skipped (never a wipe), backup first, deadline, sync lock, restore', () => {
    assert.ok(src.includes('if (!res.trimTrusted) { t.skippedNoTrustedTrim++; continue; }'));
    assert.ok(src.includes('backup.jsonl') && src.includes('pastDeadline()') && src.includes('takeLock(') && src.includes('async function restore()'));
    assert.ok(src.includes('LOCK BUSY') && src.includes('stale'));
  });
});

