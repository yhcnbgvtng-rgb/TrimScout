// 2026 Toyota RAV4 option normalization (Paul's rules 1-9). Source data: docs/rav4-2026/*.csv -> src/optionPolicies/toyota-rav4-2026.json.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildAllowlist, EMPTY_ALLOWLIST, loadBundledModelPoliciesRaw, loadAllowlistFromEnv, modelPolicyFor, optionRowsForVehicle,
} from '../src/factoryOptionAllowlist.js';
import { normalizeOptionKey, optionRowsFromOptions } from '../src/inventoryOptionRows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const car = (trim, extra = {}) => ({ make: 'Toyota', model: 'RAV4', year: 2026, trim, ...extra });
const run = (trim, names, extra) => optionRowsForVehicle(ALLOW, car(trim, extra), names.map((name) => ({ name })));
const labels = (r) => r.rows.map((x) => x.label).sort();

describe('rule 1: factory options are only paid packages, paid standalone options and paid paints, per trim', () => {
  const offered = {
    LE: ['All-Wheel Drive', 'Ruby Flare Pearl'],
    SE: ['All-Wheel Drive', 'Convenience Package', 'Weather Package', 'Moonroof Package'],
    'XLE Premium': ['All-Wheel Drive', 'Wind Chill Pearl', 'Ruby Flare Pearl', 'Weather Package', 'XLE Driver Assist Package', 'Panoramic Moonroof Package'],
    Woodland: ['Moonroof Package'],
    XSE: ['Storm Cloud with Midnight Black Metallic roof', 'Wind Chill Pearl with Midnight Black Metallic roof', 'Meteor Shower with Midnight Black Metallic roof', 'Weather Package', 'XSE Driver Assist Package', 'JBL Premium Audio Package', 'Panoramic Moonroof Package'],
    Limited: ['Wind Chill Pearl', 'Ruby Flare Pearl', '20-In. Wheel Package', '10-In. Color Head-Up Display (HUD)'],
  };
  for (const [trim, names] of Object.entries(offered)) {
    it(`${trim}: keeps exactly what it offers`, () => assert.deepEqual(labels(run(trim, names)), [...names].sort()));
  }
  it('carries the per-trim prices, and the two Panoramic Moonroof packages are different keys', () => {
    const price = (trim, label) => run(trim, [label]).rows[0].price;
    assert.equal(price('XLE Premium', 'Panoramic Moonroof Package'), 1850);
    assert.equal(price('XSE', 'Panoramic Moonroof Package'), 700);
    assert.equal(price('SE', 'All-Wheel Drive'), 1400);
    assert.equal(price('Limited', '10-In. Color Head-Up Display (HUD)'), 600);
    assert.equal(price('XSE', 'Wind Chill Pearl with Midnight Black Metallic roof'), 975);
  });
  it('a package priced or named in the dealer line still resolves (price/decoration stripped, aliases folded)', () => {
    assert.deepEqual(labels(run('SE', ['Weather Package $375', 'WEATHER PKG'])), ['Weather Package']);
    assert.deepEqual(labels(run('Limited', ['10" Head-Up Display', 'Heads Up Display'])).length, 1);
    assert.deepEqual(labels(run('SE', ['AWD'])), ['All-Wheel Drive']);
  });
  it('a name offered on a different trim is not kept here', () => {
    const r = run('LE', ['Moonroof Package', 'JBL Premium Audio Package', '20-In. Wheel Package']);
    assert.deepEqual(r.rows, []);
    assert.ok(r.dropped.every((d) => d.rule === 'not-offered-on-trim'));
  });
  it('AWD is paid only on LE/SE/XLE Premium; the $1,400 option is not kept elsewhere', () => {
    for (const t of ['LE', 'SE', 'XLE Premium']) assert.equal(run(t, ['AWD']).rows.length, 1, t);
    for (const t of ['Woodland', 'XSE', 'Limited']) assert.equal(run(t, ['AWD']).rows.length, 0, t);
  });
  it('4WD / 4x4 are not AWD', () => assert.deepEqual(run('SE', ['4WD', '4x4']).rows, []));
});

describe('rule 2: unknown/standard availability, no-cost paint and interiors are removed', () => {
  it('drops standard equipment, no-cost paints and interiors', () => {
    const r = run('XLE Premium', ['Bluetooth', 'Apple CarPlay', 'Ice Cap', 'Midnight Black Metallic', 'Storm Cloud', 'Black SofTex', 'Harvest Beige SofTex', 'Weather Package']);
    assert.deepEqual(labels(r), ['Weather Package']);
    assert.ok(r.dropped.length >= 7);
  });
  it('a paid paint on a trim that does not offer it is dropped (Wind Chill Pearl on LE)', () => assert.deepEqual(run('LE', ['Wind Chill Pearl']).rows, []));
  it('bare Wind Chill Pearl on XSE is not guessed to be the $975 two-tone', () => assert.deepEqual(run('XSE', ['Wind Chill Pearl']).rows, []));
  it('standard features on a trim that offers the package elsewhere are not options', () => {
    assert.deepEqual(run('Limited', ['Heated Steering Wheel', 'Rain Sensing Wipers', 'Power Liftgate']).rows, []);
  });
});

describe('rule 3: packages only, never expanded into features', () => {
  it('a package yields one row, no feature rows', () => {
    const r = run('XLE Premium', ['XLE Driver Assist Package']);
    assert.deepEqual(r.rows.map((x) => x.key), ['xle driver assist package']);
    for (const f of ['front cross traffic alert', 'lane change assist', 'traffic jam assist', 'driver monitor']) assert.ok(!r.rows.some((x) => x.key === f));
  });
  it('every emitted row is a package, option or paint (or a rule-7 bare name), never a feature', () => {
    const r = run('XSE', ['Weather Package', 'Heated Steering Wheel', 'Rain-Sensing Wipers', 'Advanced Park', 'JBL 9-speaker audio']);
    assert.ok(r.rows.every((x) => ['package', 'option', 'paint', 'bare'].includes(x.kind)));
    assert.deepEqual(labels(r), ['JBL Premium Audio Package', 'Weather Package', 'XSE Driver Assist Package']);
  });
});

describe('rule 4: feature lines roll up to a package only when the trim offers it and the line matches its contents', () => {
  const roll = (trim, line) => run(trim, [line]).rows.map((x) => `${x.label}/${x.via}`);
  it('rolls up each package\'s content lines on a trim that offers the package', () => {
    assert.deepEqual(roll('SE', 'Height-adjustable power liftgate with jam protection'), ['Convenience Package/rolled_up']);
    assert.deepEqual(roll('SE', 'Heated Leather Steering Wheel'), ['Weather Package/rolled_up']);
    assert.deepEqual(roll('XSE', 'Rain-sensing variable intermittent windshield wipers with de-icer function'), ['Weather Package/rolled_up']);
    assert.deepEqual(roll('Woodland', 'Power tilt/slide moonroof with one-touch open/close'), ['Moonroof Package/rolled_up']);
    assert.deepEqual(roll('XLE Premium', 'Panoramic glass roof with front power tilt/slide moonroof'), ['Panoramic Moonroof Package/rolled_up']);
    assert.deepEqual(roll('XLE Premium', 'Lane Change Assist (LCA)'), ['XLE Driver Assist Package/rolled_up']);
    assert.deepEqual(roll('XSE', 'Advanced Park'), ['XSE Driver Assist Package/rolled_up']);
    assert.deepEqual(roll('XSE', 'JBL 9-speaker Premium Audio system including subwoofer'), ['JBL Premium Audio Package/rolled_up']);
    assert.deepEqual(roll('Limited', '20-in. wheels with 235/50R20 All-Season tires'), ['20-In. Wheel Package/rolled_up']);
  });
  it('drops the same line on a trim that does not offer that package', () => {
    assert.deepEqual(roll('LE', 'Heated Steering Wheel'), []);
    assert.deepEqual(roll('XLE Premium', 'Advanced Park'), []);
    assert.deepEqual(roll('Limited', 'JBL 9-speaker Premium Audio system'), []);
    assert.deepEqual(roll('XSE', 'Lane Change Assist'), []); // XLE Driver Assist content; the XSE package is a different one
  });
  it('drops a line that is not in the package contents (standard TSS features, generic premium audio, parking sensors)', () => {
    assert.deepEqual(roll('XLE Premium', 'Lane Departure Alert'), []);
    assert.deepEqual(roll('XLE Premium', 'Lane Tracing Assist'), []);
    assert.deepEqual(roll('XSE', 'Premium Audio'), []);
    assert.deepEqual(roll('XSE', 'Front and Rear Parking Sensors'), []);
    assert.deepEqual(roll('XLE Premium', 'Panoramic View Monitor'), []);
  });
  it('a plain "moonroof" line on a panoramic-only trim is not guessed', () => assert.deepEqual(roll('XSE', 'Moonroof'), []));
  it('several lines of one package make one row', () => {
    const r = run('XLE Premium', ['Front Cross-Traffic Alert', 'Traffic Jam Assist', 'Driver Monitor', 'XLE Driver Assist Package']);
    assert.deepEqual(r.rows.map((x) => x.label), ['XLE Driver Assist Package']);
  });
});

describe('rule 5: dealer/port add-ons and unlisted products go to dealer_addons, not options', () => {
  it('configurator accessories are dealer add-ons', () => {
    const r = run('SE', ['Tow Hitch Receiver', 'Mudguards', 'Protection Plus Package', 'All-Weather Floor Liners', 'Illumination Package', 'Weather Package']);
    assert.deepEqual(labels(r), ['Weather Package']);
    assert.equal(r.dealerAddons.length, 5);
  });
  it('products on neither list (nitrogen tires, VIN etch, appearance package) are dealer add-ons too', () => {
    const r = run('XSE', ['Nitrogen Filled Tires', 'VIN Etch', 'Appearance Package']);
    assert.deepEqual(r.rows, []);
    assert.deepEqual(r.dealerAddons.map((x) => x.key).sort(), ['appearance package', 'nitrogen filled tires', 'vin etch']);
  });
  it('"All-Weather Liner Package" (accessory) is not the factory "Weather Package"', () => {
    const r = run('SE', ['All-Weather Liner Package']);
    assert.deepEqual(r.rows, []);
    assert.equal(r.dealerAddons.length, 1);
  });
  it('add-ons are kept even when the trim is unknown (they are not trim-dependent)', () => assert.equal(run(null, ['Tow Hitch Receiver']).dealerAddons.length, 1));
  it('add-ons carry no factory price/kind: they never appear in rows', () => assert.ok(run('Limited', ['Roof Cargo Basket']).rows.length === 0));
});

describe('rule 6: no trim, or an untrusted trim, means no factory options', () => {
  const lines = ['Weather Package', 'Moonroof Package', 'AWD', 'Heated Steering Wheel', 'Siri', 'Ruby Flare Pearl'];
  for (const trim of [null, '', undefined, 'Trail', 'XLE', 'Hybrid XSE Premium Plus', '   ']) {
    it(`trim ${JSON.stringify(trim)} -> empty options`, () => {
      const r = run(trim, lines);
      assert.deepEqual(r.rows, []);
      assert.equal(r.trimTrusted, false);
      assert.ok(r.dropped.every((d) => d.rule === 'no-trusted-trim'));
    });
  }
  it('a trusted trim is matched case/spacing-insensitively and nothing else', () => {
    assert.equal(run('xle   premium', ['Weather Package']).rows.length, 1);
    assert.equal(run('XLE Premium', ['Weather Package']).trimTrusted, true);
  });
});

describe('rule 7: bare Siri / Google / Unlock / Alexa Built In stay as they are', () => {
  it('kept verbatim on a trusted trim, next to the real options', () => {
    const r = run('SE', ['Siri', 'Google', 'Unlock', 'Alexa Built In', 'Weather Package']);
    assert.deepEqual(labels(r), ['Alexa Built In', 'Google', 'Siri', 'Unlock', 'Weather Package']);
    assert.ok(r.rows.filter((x) => x.kind === 'bare').every((x) => x.via === 'kept'));
  });
  it('only the bare strings: longer variants are not bare names', () => assert.deepEqual(run('SE', ['Siri Eyes Free Wireless Charging Dock']).rows, []));
  it('with no trusted trim the row is empty (rule 6 wins)', () => assert.deepEqual(run(null, ['Siri']).rows, []));
});

describe('rule 8: plugged in through factoryOptionAllowlist.js, RAV4 only, keys from normalizeOptionKey()', () => {
  it('every policy key and alias is normalizeOptionKey output', () => {
    const raw = loadBundledModelPoliciesRaw();
    for (const p of Object.values(raw)) for (const t of Object.values(p.trims)) for (const [k, o] of Object.entries(t.options)) {
      assert.equal(normalizeOptionKey(k), k);
      for (const a of o.aliases) assert.equal(normalizeOptionKey(a), a);
    }
  });
  it('matches only 2026 Toyota RAV4 / RAV4 Hybrid', () => {
    assert.ok(modelPolicyFor(ALLOW, car('SE')));
    assert.ok(modelPolicyFor(ALLOW, car('SE', { model: 'RAV4 Hybrid' })));
    assert.equal(modelPolicyFor(ALLOW, car('SE', { year: 2025 })), null);
    assert.equal(modelPolicyFor(ALLOW, car('SE', { make: 'Honda' })), null);
    assert.equal(modelPolicyFor(ALLOW, car('SE', { model: 'Highlander' })), null);
    assert.equal(modelPolicyFor(ALLOW, car('SE', { model: 'RAV4 Prime' })), null);
  });
  it('other Toyota models and years are untouched: no policy result at all, and the generic path is unchanged', () => {
    const opts = [{ name: 'Weather Package' }, { name: 'Tow Hitch Receiver' }, { name: 'Bluetooth' }];
    for (const v of [car('SE', { model: 'Camry' }), car('SE', { model: 'Highlander' }), car('SE', { year: 2025 })]) assert.equal(optionRowsForVehicle(ALLOW, v, opts), null);
    assert.equal(optionRowsFromOptions(opts).rows.length, 3); // pass-through exactly as before
  });
  it('ships off: nothing loaded without OPTION_MODEL_POLICY_PATH, so no behavior change until it is set', () => {
    assert.deepEqual(loadAllowlistFromEnv({}), { allowlist: EMPTY_ALLOWLIST, error: null });
    assert.equal(optionRowsForVehicle(EMPTY_ALLOWLIST, car('SE'), [{ name: 'Weather Package' }]), null);
  });
  it('loads from OPTION_MODEL_POLICY_PATH without needing a make allowlist, and degrades on a bad file', () => {
    const file = path.join(here, '../src/optionPolicies/toyota-rav4-2026.json');
    const ok = loadAllowlistFromEnv({ OPTION_MODEL_POLICY_PATH: file });
    assert.equal(ok.error, null);
    assert.ok(modelPolicyFor(ok.allowlist, car('SE')));
    const bad = loadAllowlistFromEnv({ OPTION_MODEL_POLICY_PATH: '/nonexistent/x.json' });
    assert.equal(bad.allowlist, EMPTY_ALLOWLIST);
    assert.match(bad.error, /nonexistent/);
  });
  it('existing generic junk rules still run first', () => assert.deepEqual(run('SE', ['See toyota', '5 in']).rows, []));
  it('never deletes facet-cache.json: the new code neither names it nor removes files', () => {
    const src = fs.readFileSync(path.join(here, '../src/factoryOptionAllowlist.js'), 'utf8') + fs.readFileSync(path.join(here, '../../../scripts/build-rav4-option-policy.mjs'), 'utf8');
    assert.ok(!src.includes('facet-cache'));
    assert.ok(!/\bunlink(Sync)?\b|\brm(Sync)?\(|\brmdir/.test(src));
  });
});

describe('rule 9: the policy is generated from the shipped source data', () => {
  it('the committed JSON equals what scripts/build-rav4-option-policy.mjs writes', () => {
    execFileSync('node', [path.join(here, '../../../scripts/build-rav4-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
  it('the source files are in docs/rav4-2026', () => {
    for (const f of ['rav4_2026_vocabulary.md', 'rav4_option_normalization.csv', 'rav4_2026_options_by_trim.csv']) assert.ok(fs.existsSync(path.join(here, '../../../docs/rav4-2026', f)), f);
  });
  it('covers all six trims', () => {
    const p = Object.values(loadBundledModelPoliciesRaw())[0];
    assert.deepEqual(Object.values(p.trims).map((t) => t.label), ['LE', 'SE', 'XLE Premium', 'Woodland', 'XSE', 'Limited']);
  });
});
