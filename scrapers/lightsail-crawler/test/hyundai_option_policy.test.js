// 2025-27 Hyundai option policy (19 models): the approved rules, same engine as the Toyota, Ford, GM, Cadillac, Honda and Kia policies.
// Source: docs/hyundai-2025-2027/hyundai_lineup_options_by_trim.csv -> scripts/build-cadillac-honda-kia-option-policy.mjs -> src/optionPolicies/hyundai-2025-2027.json.
// Paul's rule: every paid factory line on the window sticker stays (paints, packages, options, drivetrain, paid interior colors / materials);
// accessories, dealer add-ons, $0 items and subscription-only items are dropped.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle, policyFacetRows } from '../src/factoryOptionAllowlist.js';
import { parseCsv } from '../../../scripts/lib/optionPolicyCommon.mjs';
import { normalizeOptionKey, compileJunkRules, setJunkRules } from '../src/inventoryOptionRows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const RAW = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionPolicies/hyundai-2025-2027.json'), 'utf8'));
const CSV = parseCsv(fs.readFileSync(path.join(repo, 'docs/hyundai-2025-2027/hyundai_lineup_options_by_trim.csv'), 'utf8'));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const slug = normalizeOptionKey;
const price = (r) => Number(r.price_usd) || 0;
const paid = CSV.filter((r) => r.category !== 'Base' && price(r) > 0);
const run = (vehicle, names) => optionRowsForVehicle(ALLOW, { make: 'Hyundai', ...vehicle }, names.map((name) => ({ name })));
const entries = Object.entries(RAW).flatMap(([scope, p]) => Object.entries(p.trims).flatMap(([tk, t]) => Object.entries(t.options).map(([k, o]) => ({ scope, tk, k, o, trim: t.label }))));

describe('what is covered: make + model + year + trim', () => {
  it('19 models, one policy per model and year, 79 trims, 214 entries (0 packages, 0 options, 40 powertrain, 174 paints)', () => {
    assert.equal(Object.keys(RAW).length, 19);
    assert.equal(new Set(Object.values(RAW).map((p) => p.models[0])).size, 19);
    assert.equal(Object.values(RAW).reduce((n, p) => n + Object.keys(p.trims).length, 0), 79);
    assert.equal(entries.length, 214);
    const by = (k) => entries.filter((e) => e.o.kind === k).length;
    assert.deepEqual(['package', 'option', 'powertrain', 'paint'].map(by), [0, 0, 40, 174]);
  });
  it('every policy scope is Hyundai + the CSV model + the CSV year', () => {
    const want = new Set(CSV.map((r) => `hyundai|${slug(r.model)}|${r.year}`));
    assert.deepEqual([...Object.keys(RAW)].sort(), [...want].sort());
  });
  it('another model year, a model the CSV lacks and other makes are untouched', () => {
    for (const v of [
      { make: 'Hyundai', model: 'Palisade', year: 2026 }, { make: 'Hyundai', model: 'Tucson', year: 2027 }, { make: 'Hyundai', model: 'Kona', year: 2026 },
      { make: 'Hyundai', model: 'Ioniq 5', year: 2026 }, { make: 'Hyundai', model: 'Elantra', year: 2025 }, { make: 'Hyundai', model: 'Nexo', year: 2026 },
      { make: 'Genesis', model: 'GV70', year: 2026 }, { make: 'Kia', model: 'Sorento', year: 2026 },
    ]) {
      assert.deepEqual(modelPoliciesFor(ALLOW, v), [], JSON.stringify(v));
      const same = [{ name: 'Ultimate Red' }];
      assert.equal(optionRowsForVehicle(ALLOW, { ...v, trim: 'SE' }, same), null);
      assert.equal(policyFacetRows(ALLOW, { ...v, trim: 'SE' }, same), null);
    }
  });
  it('the other makes stay covered', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Kia', model: 'Sorento', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'RAV4', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Ford', model: 'Ranger', year: 2026 }).length, 1);
  });
  it('the policy file is bundled and listed in the write-path doc and install script', () => {
    assert.ok(fs.readFileSync(path.join(repo, 'scripts/box/2026-10-11-option-policy-write-path.sh'), 'utf8').includes('hyundai-2025-2027'));
    assert.ok(fs.readFileSync(path.join(repo, 'docs/OPTION_POLICY_WRITE_PATH.md'), 'utf8').includes('hyundai-2025-2027.json'));
  });
});

describe('the CSV is the contract: every paid factory line is in at its price, nothing else is', () => {
  it('every paid CSV row is in its trim\'s policy (make + model + year + trim) at the CSV price', () => {
    assert.equal(paid.length, 214);
    for (const r of paid) {
      const t = RAW[`hyundai|${slug(r.model)}|${r.year}`]?.trims[slug(r.trim)];
      assert.ok(t, `${r.year} ${r.model} ${r.trim}: trim missing`);
      const o = t.options[slug(r.item)];
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
    const want = new Set(paid.map((r) => `hyundai|${slug(r.model)}|${r.year}|${slug(r.trim)}|${slug(r.item)}`));
    const have = entries.map((e) => `${e.scope}|${e.tk}|${e.k}`);
    assert.equal(have.length, want.size);
    assert.deepEqual(have.filter((x) => !want.has(x)), []);
    for (const { o, trim } of entries) {
      assert.ok(o.price > 0, `${trim} ${o.label}`);
      assert.notEqual(o.label, 'Base Price (trim MSRP)');
      assert.doesNotMatch(o.label, /accessor|subscription|blue ?link|floor mat|cargo|splash|tonneau|bed ?liner|\bplan\b/i, o.label);
    }
  });
  it('no $0 or Base CSV row becomes an option on its trim', () => {
    for (const r of CSV.filter((x) => x.category === 'Base' || !(price(x) > 0))) {
      const o = RAW[`hyundai|${slug(r.model)}|${r.year}`].trims[slug(r.trim)].options;
      assert.equal(o[slug(r.item)], undefined, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('accessories, dealer add-ons, subscriptions and standard equipment from a feed never become options', () => {
    const junk = ['Carpeted Floor Mats', 'All-Weather Floor Mats', 'Cargo Net', 'Splash Guards', 'Hyundai Blue Link Subscription', 'Ceramic Coating', 'Nitrogen Tires', 'Wheel Locks', 'Roof Rack Cross Bars', 'Tow Hitch', 'Panoramic Sunroof', 'Heated Seats', 'Leather Seats'];
    for (const [v, t] of [[{ model: 'Tucson', year: 2026 }, 'Limited'], [{ model: 'Santa Fe', year: 2027 }, 'Calligraphy'], [{ model: 'Palisade', year: 2027 }, 'Limited'], [{ model: 'Ioniq 5', year: 2027 }, 'Limited']]) {
      assert.deepEqual(run({ ...v, trim: t }, junk).rows, [], `${v.model} ${t}`);
    }
  });
  it('the generated JSON and reports are current', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-cadillac-honda-kia-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('Hyundai specifics', () => {
  it('Santa Fe 2027 Calligraphy: AWD $1,800 and a matte paint $1,000 stay; drivetrain words in the vehicle trim are noise', () => {
    for (const trim of ['Calligraphy', 'Calligraphy AWD']) {
      const r = run({ model: 'Santa Fe', year: 2027, trim }, ['AWD', 'Earthy Brass Matte', 'Serenity White']);
      assert.deepEqual(r.rows.map((x) => [x.kind, x.price]).sort(), [['paint', 1000], ['paint', 500], ['powertrain', 1800]].sort(), trim);
    }
  });
  it('AWD is priced per trim: Ioniq 5 SE $3,500, Limited $3,900, Palisade SE $2,000; an AWD-only trim has no AWD row', () => {
    assert.equal(run({ model: 'Ioniq 5', year: 2027, trim: 'SE' }, ['AWD']).rows[0].price, 3500);
    assert.equal(run({ model: 'Ioniq 5', year: 2027, trim: 'Limited' }, ['AWD']).rows[0].price, 3900);
    assert.equal(run({ model: 'Palisade', year: 2027, trim: 'SE' }, ['AWD']).rows[0].price, 2000);
    assert.deepEqual(run({ model: 'Ioniq 5', year: 2027, trim: 'XRT' }, ['AWD']).rows, []);
    assert.deepEqual(run({ model: 'Santa Fe', year: 2027, trim: 'XRT' }, ['AWD']).rows, []);
  });
  it('Elantra N: the 8-speed wet DCT ($1,500) is a powertrain option', () => {
    assert.deepEqual(run({ model: 'Elantra N', year: 2026, trim: 'N' }, ['N 8-speed Wet Dual Clutch Transmission']).rows.map((x) => [x.kind, x.price]), [['powertrain', 1500]]);
  });
  it('a paint the trim does not offer is not kept (Ioniq 5 XRT has no Atlas White Matte), and neither is an unnamed default paint', () => {
    assert.deepEqual(run({ model: 'Ioniq 5', year: 2027, trim: 'XRT' }, ['Atlas White Matte']).rows, []);
    assert.deepEqual(run({ model: 'Tucson', year: 2026, trim: 'XRT' }, ['Amazon Gray']).rows, []);
  });
  it('Ioniq 5 and Ioniq 5 N, Kona and Kona Electric, Santa Fe and Santa Fe Hybrid are separate models', () => {
    assert.deepEqual(run({ model: 'Ioniq 5 N', year: 2026, trim: 'N' }, ['Performance Blue Matte']).rows.map((x) => x.price), [1000]);
    assert.deepEqual(run({ model: 'Ioniq 5', year: 2027, trim: 'SE' }, ['Performance Blue Matte']).rows, []);
    assert.deepEqual(run({ model: 'Kona Electric', year: 2025, trim: 'SE' }, ['Neoteric Yellow']).rows.map((x) => x.price), [500]);
  });
  it('no trusted trim -> no options (trim missing, not in the CSV, or Venue SEL w/ 2-Tone Roof which has no paid line)', () => {
    assert.deepEqual(run({ model: 'Tucson', year: 2026, trim: 'Nope' }, ['Ultimate Red']).rows, []);
    assert.deepEqual(run({ model: 'Tucson', year: 2026, trim: null }, ['Ultimate Red']).rows, []);
    assert.deepEqual(run({ model: 'Venue', year: 2026, trim: 'SEL w/ 2-Tone Roof' }, ['Ultimate Red']).rows, []);
  });
  it('a blank trim on the sync payload leaves stored rows alone, a trim the policy does not trust also leaves them alone (skip, never wipe)', () => {
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Hyundai', model: 'Tucson', year: 2026, trim: '' }, [{ name: 'Ultimate Red' }]), { skip: true });
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Hyundai', model: 'Tucson', year: 2026, trim: 'Nope' }, [{ name: 'Ultimate Red' }]), { skip: true });
  });
});

describe('SiriusXM stays as a feature (keepBare)', () => {
  const H = { make: 'Hyundai', model: 'Tucson', year: 2026 };
  const trim = () => Object.values(RAW[Object.keys(RAW).find((k) => k.startsWith('hyundai|tucson|2026'))].trims)[0].label;
  before(() => setJunkRules(compileJunkRules(JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionJunkRules.json'), 'utf8')))));
  after(() => setJunkRules(null));
  it('every Hyundai policy lists siriusxm as a bare feature', () => {
    for (const p of Object.values(RAW)) assert.deepEqual(p.keepBare, ['siriusxm']);
  });
  it('bare SiriusXM and the junk list rewrite of its trial/subscription lines come back as one $0 "SiriusXM" row on a trusted trim', () => {
    for (const name of ['SiriusXM', 'SiriusXM Subscription', 'SiriusXM with 360L Trial Subscription']) {
      const r = optionRowsForVehicle(ALLOW, { ...H, trim: trim() }, [{ name }]);
      assert.deepEqual(r.rows.map((x) => [x.key, x.label, x.kind, x.price]), [['siriusxm', 'SiriusXM', 'bare', 0]], name);
    }
  });
  it('a paid SiriusXM extra is still not an option, and an untrusted trim still gets nothing', () => {
    assert.deepEqual(optionRowsForVehicle(ALLOW, { ...H, trim: trim() }, [{ name: 'SiriusXM 3 Year Traffic and Travel Link Subscription' }]).rows, []);
    assert.deepEqual(optionRowsForVehicle(ALLOW, { ...H, trim: 'Nope' }, [{ name: 'SiriusXM' }]).rows, []);
  });
});
