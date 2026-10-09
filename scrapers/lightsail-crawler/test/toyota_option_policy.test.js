// Toyota 2026-2027 option policies (rules 1-8, same rules as the 2026 RAV4 policy). Source: docs/toyota-2026-2027/*.csv ->
// scripts/build-toyota-option-policy.mjs -> src/optionPolicies/toyota-2026-2027.json (+ docs/toyota-2026-2027/POLICY_REPORT.md).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, modelPolicyFor, optionRowsForVehicle, resolvePolicyTrim,
} from '../src/factoryOptionAllowlist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const run = (vehicle, names) => optionRowsForVehicle(ALLOW, { make: 'Toyota', year: 2026, ...vehicle }, names.map((name) => ({ name })));
const labels = (r) => r.rows.map((x) => x.label).sort();
const by = (r, label) => r.rows.find((x) => x.label === label);

describe('rule 1: only paid packages, paid options, paid colors and paid powertrain/drivetrain upgrades, per model + year + trim', () => {
  it('Camry LE keeps its paid AWD, packages and option', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['All-Wheel Drive', 'Convenience Package', 'Cold Weather Package', 'Power tilt/slide moonroof']);
    assert.deepEqual(labels(r), ['All-Wheel Drive', 'Cold Weather Package', 'Convenience Package', 'Power tilt/slide moonroof']);
    assert.equal(by(r, 'All-Wheel Drive').price, 1525);
    assert.equal(by(r, 'Convenience Package').kind, 'package');
  });
  it('a paid paint is kept at its price, tied to the trim', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['Ruby Flare Pearl', 'Wind Chill Pearl']);
    assert.ok(r.rows.every((x) => x.kind === 'paint' && x.price > 0), JSON.stringify(r.rows));
  });
  it('a paid engine/transmission upgrade is a powertrain option (Tacoma TRD Off-Road 8-speed, $1,100)', () => {
    const r = run({ model: 'Tacoma', trim: 'TRD Off-Road' }, ['8-Speed Automatic Transmission']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]), [['powertrain', 1100]]);
  });
  it('the same package name on different trims is a separate entry with its own price', () => {
    const rwd = run({ model: 'Tacoma', trim: 'TRD Sport' }, ['TRD Sport Premium Package']);
    const max = run({ model: 'Tacoma', trim: 'TRD Sport i-FORCE MAX' }, ['TRD Sport Premium Package']);
    assert.equal(rwd.rows[0].price, 8465);
    assert.equal(max.rows[0].price, 8290);
  });
  it('a package offered on one trim is not kept on a trim that lacks it', () => {
    const r = run({ model: 'Tundra', trim: 'SR' }, ['Limited Power Package', 'Nightshade Package']);
    assert.deepEqual(r.rows, []);
    assert.ok(r.dropped.every((d) => d.rule === 'not-offered-on-trim'));
  });
  it('AWD / 4WD fold onto the paid drive option only where it costs extra', () => {
    assert.equal(run({ model: 'Camry', trim: 'LE' }, ['AWD']).rows.length, 1);
    assert.equal(run({ model: 'Tundra', trim: 'SR5' }, ['4WD']).rows[0].price, 3000);
    assert.deepEqual(run({ model: 'Tacoma', trim: 'TRD Off-Road' }, ['4x4']).rows, []); // standard there
  });
});

describe('rule 2: standard, no-cost, unknown, no-cost colors, interiors, Base and Cab/Bed are not options', () => {
  it('drops standard equipment, no-cost colors and interiors', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['Bluetooth', 'Apple CarPlay', 'Black Fabric', 'Midnight Black Metallic', 'Convenience Package']);
    assert.deepEqual(labels(r), ['Convenience Package']);
  });
  it('a $0 / "No Additional Cost" package row is not an option (Tundra Limited PVM + BSM Outer Mirrors, $0)', () => {
    const r = run({ model: 'Tundra', trim: 'Limited' }, ['PVM + BSM Outer Mirrors']);
    assert.deepEqual(r.rows, []);
  });
  it('Cab/Bed rows describe the configuration: never an option, even the priced ones', () => {
    const r = run({ model: 'Tundra', trim: 'SR5' }, ['CrewMax, 5.5-Ft.', 'CrewMax, 6.5-Ft.', 'Double Cab, 6.5-Ft.', 'Double Cab, 8.1-Ft.']);
    assert.deepEqual(r.rows, []);
    const t = run({ model: 'Tacoma', trim: 'SR' }, ['XtraCab, 6-ft Bed', 'Double Cab, 5-ft Bed']);
    assert.deepEqual(t.rows, []);
  });
  it('the generated policies hold no Cab/Bed, Interior, Base or $0 entries', () => {
    for (const [scope, p] of Object.entries(loadBundledModelPoliciesRaw())) for (const t of Object.values(p.trims)) for (const o of Object.values(t.options)) {
      assert.ok(o.price > 0, `${scope} ${t.label} ${o.label}`);
      assert.ok(['package', 'option', 'paint', 'powertrain'].includes(o.kind), `${scope} ${o.label}`);
    }
  });
});

describe('rule 3: packages only; feature lines roll up only to a package the trim offers and whose contents match', () => {
  it('a package is one row; its features are not added', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['Cold Weather Package']);
    assert.deepEqual(labels(r), ['Cold Weather Package']);
  });
  it('a content line rolls up to its package on a trim that offers it', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['Heated leather steering wheel']);
    assert.deepEqual(r.rows.map((x) => `${x.label}/${x.via}`), ['Cold Weather Package/rolled_up']);
  });
  it('the same line is dropped on a trim that does not offer that package', () => {
    const r = run({ model: 'Tundra', trim: 'SR' }, ['Digital rearview mirror', 'Premium LED headlights']);
    assert.deepEqual(r.rows, []);
  });
  it('a line that is in two packages on the trim is ambiguous and dropped, never guessed', () => {
    const r = run({ model: 'Tundra', trim: 'SR5' }, ['Blind Spot Monitor (BSM) *']); // Advanced Technology Package AND SR5 Convenience Package
    assert.deepEqual(r.rows, []);
    assert.ok(r.dropped.some((d) => /Blind Spot/.test(d.label)));
  });
  it('a line that matches no package content is dropped', () => assert.deepEqual(run({ model: 'Camry', trim: 'LE' }, ['Lane Departure Alert', 'Panoramic View Monitor']).rows, []));
});

describe('rule 4: Accessory package rows and known dealer products go to dealer_addons (whole names); disclaimers are dropped', () => {
  it('CSV accessory packages and known dealer products', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['Carpet Mat Package', 'PermaPlate', 'Lifetime Oil Plan', 'Nitrogen Filled Tires', 'VIN Etch', 'Appearance Package', 'Protection Package', 'Cold Weather Package']);
    assert.deepEqual(labels(r), ['Cold Weather Package']);
    assert.equal(r.dealerAddons.length, 7);
  });
  it('whole product names only: a longer sentence that mentions a product is not an add-on', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['Includes PermaPlate and a lifetime oil change for the original owner']);
    assert.deepEqual(r.dealerAddons, []);
    assert.deepEqual(r.rows, []);
  });
  it('disclaimer lines are dropped, not add-ons', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['Does not include optional accessories of $799 Lifetime Oil', 'Price excludes tax, tags and $995 dealer fee']);
    assert.deepEqual(r.dealerAddons, []);
    assert.ok(r.dropped.filter((d) => d.rule === 'disclaimer').length >= 1);
  });
  it('an accessory package is never a factory option', () => assert.deepEqual(run({ model: 'Tundra', trim: 'SR5' }, ['Carpet Mat Package']).rows, []));
});

describe('rule 5: no trusted trim means no options; trusted = exact CSV trim, or that trim + drivetrain/Hybrid/HEV/CVT/i-FORCE MAX/Natl words', () => {
  const lines = ['4WD', 'Nightshade Package', 'Siri', 'Ruby Flare Pearl'];
  for (const trim of [null, '', 'Trail', 'Hendersonville NC', 'AWD', 'Limited Edition Plus']) {
    it(`trim ${JSON.stringify(trim)} -> empty options`, () => {
      const r = run({ model: 'Tundra', trim }, lines);
      assert.deepEqual(r.rows, []);
      assert.equal(r.trimTrusted, false);
    });
  }
  it('exact CSV trim names, case/spacing-insensitive', () => assert.equal(resolvePolicyTrim(modelPolicyFor(ALLOW, { make: 'Toyota', model: 'Tundra', year: 2026 }), 'platinum  I-FORCE   MAX').trim.label, 'Platinum i-FORCE MAX'));
  it('a trim followed only by drivetrain / Hybrid / HEV / CVT / Natl words is that trim', () => {
    const p = modelPolicyFor(ALLOW, { make: 'Toyota', model: 'Camry', year: 2026 });
    for (const t of ['LE AWD', 'LE Hybrid', 'LE HEV CVT Natl', 'LE Front-Wheel Drive']) assert.equal(resolvePolicyTrim(p, t)?.trim.label, 'LE', t);
    assert.equal(resolvePolicyTrim(p, 'LE Sport Edition'), null);
  });
  it('"Limited i-FORCE MAX" and "Limited" are different trims: never folded when the options differ', () => {
    const p = modelPolicyFor(ALLOW, { make: 'Toyota', model: 'Tundra', year: 2026 });
    assert.equal(resolvePolicyTrim(p, 'Limited').trim.label, 'Limited');
    assert.equal(resolvePolicyTrim(p, 'Limited i-FORCE MAX').trim.label, 'Limited i-FORCE MAX');
    assert.equal(resolvePolicyTrim(p, 'Limited i-FORCE MAX AWD').trim.label, 'Limited i-FORCE MAX'); // most specific, not the "Limited" it contains
    assert.equal(resolvePolicyTrim(p, 'Limited 4WD').trim.label, 'Limited');
  });
  it('"Hybrid XLE" and "XLE" are different trims where the CSV has both', () => {
    const p = modelPolicyFor(ALLOW, { make: 'Toyota', model: 'Highlander', year: 2026 });
    assert.equal(resolvePolicyTrim(p, 'XLE').trim.label, 'XLE');
    assert.equal(resolvePolicyTrim(p, 'Hybrid XLE').trim.label, 'Hybrid XLE');
    assert.equal(resolvePolicyTrim(p, 'XLE Hybrid AWD').trim.label, 'Hybrid XLE');
  });
  it('hybrid-named trim case: the DB model "Highlander Hybrid" + trim "XLE" is the CSV "Hybrid XLE"', () => {
    const r = run({ model: 'Highlander Hybrid', trim: 'XLE' }, ['Nightshade Package']);
    assert.equal(r.trimTrusted, true);
    assert.equal(r.trimVia, 'model-implied');
    const plain = run({ model: 'Highlander', trim: 'XLE' }, ['All-Wheel Drive']);
    assert.equal(plain.trimVia, 'exact');
  });
  it('aliases exist only where the shortened name is not already a trim (bZ, GR) and are listed in the report', () => {
    const report = fs.readFileSync(path.join(repo, 'docs/toyota-2026-2027/POLICY_REPORT.md'), 'utf8');
    const p = modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'bZ', year: 2027 });
    assert.equal(p.length, 2); // "bZ" is both the bZ (bZ4X) and the bZ Woodland spelling
    assert.equal(resolvePolicyTrim(p.find((x) => x.scope.includes('bz bz4x')), 'Limited').trim.label, 'bZ Limited');
    for (const alias of ['| bZ (bZ4X) | limited | bZ Limited |', '| GR Corolla | grmn | GR Corolla GRMN |']) assert.ok(report.includes(alias), alias);
    for (const pol of ALLOW.models.values()) for (const [from] of pol.trimAliases) if (pol.scope.startsWith('toyota|rav4|')) continue; else assert.ok(!pol.trims.has(from), `${pol.scope}: alias "${from}" shadows a real trim`);
  });
  it('the two bZ CSV models sharing one DB spelling are told apart by the trim', () => {
    assert.equal(run({ model: 'bZ', year: 2027, trim: 'Limited' }, []).trim, 'Limited');
    assert.equal(run({ model: 'bZ', year: 2027, trim: 'Limited' }, ['Cold Weather Package']).trimTrusted, true);
    assert.equal(run({ model: 'bZ', year: 2027, trim: 'Woodland Premium' }, []).trimTrusted, true);
  });
});

describe('rule 6: bare Siri / Google / Alexa Built In stay; bare unlock is dropped', () => {
  it('keeps the three, drops unlock', () => {
    const r = run({ model: 'Camry', trim: 'LE' }, ['Siri', 'Google', 'Alexa Built In', 'Unlock']);
    assert.deepEqual(labels(r), ['Alexa Built In', 'Google', 'Siri']);
  });
  it('only with a trusted trim', () => assert.deepEqual(run({ model: 'Camry', trim: null }, ['Siri']).rows, []));
});

describe('rule 7: a policy only applies to the model and year in the CSV', () => {
  const opts = [{ name: 'AWD' }];
  it('other years and uncovered models return no policy at all', () => {
    for (const v of [{ model: 'Camry', year: 2025 }, { model: 'Tundra', year: 2025 }, { model: 'Camry', year: 2027 }, { model: 'Corolla', year: 2026 }, { model: 'Mirai', year: 2026 }, { model: 'Avalon', year: 2026 }, { model: 'Venza', year: 2026 }, { model: 'Camry', year: 2026, make: 'Honda' }]) {
      assert.equal(optionRowsForVehicle(ALLOW, { make: 'Toyota', trim: 'LE', ...v }, opts), null, JSON.stringify(v));
    }
  });
  it('Mirai (one "Not buildable" row) has no policy', () => assert.ok(!Object.keys(loadBundledModelPoliciesRaw()).some((k) => k.includes('mirai'))));
  it('model names resolve (CSV spelling and DB spellings)', () => {
    const cases = [['4Runner', 2026], ['Camry', 2026], ['Corolla Cross', 2026], ['Crown Signia', 2026], ['GR Corolla', 2026], ['GR Supra', 2026], ['Grand Highlander', 2026], ['Highlander', 2026], ['RAV4 Plug-in Hybrid', 2026],
      ['Sequoia', 2026], ['Sienna', 2026], ['Tacoma', 2026], ['Tundra', 2026], ['C-HR', 2027], ['Corolla', 2027], ['Corolla Hatchback', 2027], ['Crown', 2027], ['GR86', 2027], ['Land Cruiser', 2027],
      ['Prius', 2027], ['Prius Plug-in Hybrid', 2027], ['bZ (bZ4X)', 2027], ['bZ4X', 2027], ['bZ', 2027], ['bZ Woodland', 2027], ['Highlander Hybrid', 2026], ['GR 86', 2027], ['Supra', 2026], ['RAV4 Prime', 2026]];
    for (const [model, year] of cases) assert.ok(modelPolicyFor(ALLOW, { make: 'Toyota', model, year }), `${year} ${model}`);
  });
  it('the 2026 RAV4 (non-plug-in) still uses #432\'s policy, not the Toyota CSV', () => {
    const toyota = JSON.parse(fs.readFileSync(path.join(here, '../src/optionPolicies/toyota-2026-2027.json'), 'utf8'));
    assert.ok(!('toyota|rav4|2026' in toyota));
    const r = run({ model: 'RAV4', trim: 'SE' }, ['Weather Package', 'All-Wheel Drive']);
    assert.deepEqual(labels(r), ['All-Wheel Drive', 'Weather Package']);
    assert.equal(run({ model: 'RAV4', trim: 'XLE' }, ['Weather Package']).trimVia, 'alias'); // #432's bare-XLE alias is untouched
  });
});

describe('rule 8: where the CSV disagrees with #432 for the 2026 RAV4, #432 wins and the differences are listed', () => {
  it('the report has the RAV4 section', () => assert.match(fs.readFileSync(path.join(repo, 'docs/toyota-2026-2027/POLICY_REPORT.md'), 'utf8'), /2026 RAV4: this CSV vs PR #432/));
  it('the RAV4 policy file is byte-for-byte the one the RAV4 generator writes', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-rav4-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('generated from the shipped source data', () => {
  it('the committed JSON and report equal what scripts/build-toyota-option-policy.mjs writes', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-toyota-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
  it('the CSV is in docs/toyota-2026-2027', () => assert.ok(fs.existsSync(path.join(repo, 'docs/toyota-2026-2027/toyota_2026_2027_options_by_trim.csv'))));
  it('never touches facet-cache.json', () => {
    const src = fs.readFileSync(path.join(repo, 'scripts/build-toyota-option-policy.mjs'), 'utf8') + fs.readFileSync(path.join(repo, 'scripts/lib/optionPolicyCommon.mjs'), 'utf8');
    assert.ok(!src.includes('facet-cache'));
    assert.ok(!/\bunlink(Sync)?\b|\brm(Sync)?\(/.test(src));
  });
});
