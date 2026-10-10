// 2026 Toyota RAV4 option normalization (Paul's rules 1-9). Source data: docs/rav4-2026/*.csv -> src/optionPolicies/toyota-rav4-2026.json.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildAllowlist, EMPTY_ALLOWLIST, loadAllowlistFromEnv, modelPolicyFor, optionRowsForVehicle,
} from '../src/factoryOptionAllowlist.js';
import { normalizeOptionKey, optionRowsFromOptions } from '../src/inventoryOptionRows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// The 2026 RAV4 policy on its own: these tests are about it, and the Toyota policies stacked on top (PR: toyota-2026-2027) cover other models.
const RAV4_RAW = JSON.parse(fs.readFileSync(path.join(here, '../src/optionPolicies/toyota-rav4-2026.json'), 'utf8'));
const ALLOW = buildAllowlist(null, RAV4_RAW);
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

describe('dealer add-ons are whole product names only; disclaimers are dropped', () => {
  const addon = (name) => run('XLE Premium', [name]);
  it('PermaPlate, a Lifetime Oil package or plan, nitrogen, VIN etch (and spacing / price decoration variants) are dealer add-ons', () => {
    for (const name of ['PermaPlate', '$895 PermaPlate', 'Perma Plate Paint Protection', 'Lifetime Oil Package', 'Lifetime Oil Change Plan', 'Oil Change Plan', 'Nitrogen', 'Nitrogen Filled Tires', 'Nitrogen Fill', 'VIN Etch', 'VIN Etching', 'Vin Etch Protection', 'Appearance Package', 'Paint Protection', 'Fabric Guard', 'Window Tint', 'Mud Guards', 'Toyota Mudguards Set', 'Protection Plus Package', 'Protection Package - Chrome Body Side', 'Carpet Floor Mats/Cargo Mat', 'Low Profile Cross Bars (TMS)', 'Body Side Moldings', 'Blackout Emblem Overlays', 'All Weather Floor Liner and Cargo Tray']) {
      const r = addon(name);
      assert.equal(r.dealerAddons.length, 1, name);
      assert.deepEqual(r.rows, [], name);
    }
  });
  it('the configurator Accessory list is still matched by its exact names', () => {
    for (const name of ['Tow Hitch Receiver', 'Mudguards', 'Roof Cargo Basket', 'Illuminated Door Sills', 'All-Weather Floor Liners']) assert.equal(addon(name).dealerAddons.length, 1, name);
  });
  it('a product word inside a longer line is NOT enough (no loose matching)', () => {
    for (const name of ['Does not include optional accessories of $799 Lifetime Oil', 'Nitrogen-filled tires and road hazard coverage included for 5 years', 'Includes PermaPlate paint and interior protection', 'Complimentary lifetime oil change for the first owner', 'Vehicles may have different accessories than seen in photos', 'Illuminated entry', 'Accessories available at your dealer']) {
      assert.equal(addon(name).dealerAddons.length, 0, name);
    }
  });
  it('lines starting with disclaimer wording are dropped as disclaimers, even when they name a product', () => {
    for (const name of ['Does not include optional accessories of $799 Lifetime Oil', "Doesn't include dealer installed options", 'Price excludes tax, tag and PermaPlate', 'Prices exclude Nitrogen', 'Excludes VIN Etch', 'Not including destination', 'Plus tax, title and license', 'Plus $895 PermaPlate']) {
      const r = addon(name);
      assert.deepEqual(r.rows, [], name);
      assert.deepEqual(r.dealerAddons, [], name);
      assert.equal(r.dropped.length, 1, `${name}: dropped (by this rule, or by an older junk rule that already caught it)`);
    }
  });
  it('the disclaimer rule itself (lines the older junk rules do not already catch)', () => {
    for (const name of ['Does not include optional accessories of $799 Lifetime Oil', 'Prices exclude Nitrogen', 'Excludes VIN Etch', 'Not including destination']) assert.ok(addon(name).dropped.some((d) => d.rule === 'disclaimer'), name);
  });
  it('"plus" is only a disclaimer at the START of a line: "Premium Plus Package" and "Protection Plus Package" are not', () => {
    assert.ok(!addon('Protection Plus Package').dropped.some((d) => d.rule === 'disclaimer'));
    assert.equal(addon('Protection Plus Package').dealerAddons.length, 1);
  });
  it('factory options with the same words still win: the exact Weather Package is not an add-on', () => assert.deepEqual(labels(run('SE', ['Weather Package'])), ['Weather Package']));
});

describe('a bare "XLE" and its shorthand are XLE Premium (the 2026 RAV4 has no plain XLE)', () => {
  const lines = ['Panoramic Moonroof Package', 'Weather Package', 'All-Wheel Drive', 'Wind Chill Pearl', 'Premium Audio'];
  const want = labels(run('XLE Premium', lines));
  for (const trim of ['XLE', 'xle', ' XLE ', 'XLE Prem', 'XLE Prem.', 'XLE Premium', 'XLE Premium AWD', 'XLE Premium Hybrid', 'XLE Premium Hybrid AWD', 'XLE Prem AWD', 'XLE AWD', 'XLE Hybrid', 'XLE Premium Pkg', 'XLE Premium Package', 'XLE-Premium']) {
    it(`${JSON.stringify(trim)} -> the XLE Premium call`, () => {
      const r = run(trim, lines);
      assert.equal(r.trimTrusted, true);
      assert.deepEqual(labels(r), want);
      assert.ok(want.length >= 3, 'sanity: XLE Premium really keeps these');
    });
  }
  it('says whether the trim was matched exactly or folded in (for reporting)', () => {
    assert.equal(run('XLE Premium', lines).trimVia, 'exact');
    assert.equal(run('XLE', lines).trimVia, 'alias');
    assert.equal(run('XLE Prem AWD', lines).trimVia, 'alias');
    assert.equal(run('Trail', lines).trimVia, null);
  });
  it('the options kept under XLE are priced as XLE Premium (not the other trims)', () => {
    assert.equal(run('XLE', ['Panoramic Moonroof Package']).rows[0].price, 1850);
  });
  it('only the XLE shorthand moves: every other trim string keeps its old call', () => {
    for (const trim of ['LE', 'SE', 'Woodland', 'XSE', 'Limited']) assert.equal(run(trim, lines).trimVia, 'exact');
    for (const trim of ['Prem', 'Premium', 'XLE Premium Plus', 'XLE Limited', 'XLE Sport', 'Trail', 'Adventure', 'AWD', 'Base']) assert.equal(run(trim, lines).trimTrusted, false, trim);
  });
  it('another year or model with an "XLE" trim is untouched (no policy at all)', () => {
    assert.equal(optionRowsForVehicle(ALLOW, car('XLE', { year: 2025 }), [{ name: 'Weather Package' }]), null);
    assert.equal(optionRowsForVehicle(ALLOW, car('XLE', { model: 'Camry' }), [{ name: 'Weather Package' }]), null);
  });
});

describe('a trim followed only by drivetrain / Hybrid / HEV / CVT / Natl words is that trim', () => {
  const lines = ['Weather Package', 'Moonroof Package', 'All-Wheel Drive'];
  const cases = {
    'XLE Premium AWD Natl': 'XLE Premium', 'LE AWD HYBRID': 'LE', 'Woodland AWD': 'Woodland', 'XLE Premium Front-Wheel Drive': 'XLE Premium',
    'LE AWD': 'LE', 'SE AWD': 'SE', 'XSE Hybrid': 'XSE', 'Limited AWD': 'Limited', 'Limited Hybrid': 'Limited', 'SE Hybrid': 'SE', 'LE AWD Natl': 'LE',
    'XSE HEV': 'XSE', 'Limited CVT': 'Limited', 'SE ECVT AWD': 'SE', 'LE All Wheel Drive': 'LE', 'XLE Premium Hybrid AWD Natl': 'XLE Premium',
    'Hybrid XSE': 'XSE', 'XLE AWD Natl': 'XLE Premium', 'Woodland Hybrid': 'Woodland', 'le awd hybrid': 'LE',
  };
  for (const [trim, want] of Object.entries(cases)) {
    it(`${JSON.stringify(trim)} is ${want}`, () => {
      const r = run(trim, lines);
      assert.equal(r.trimTrusted, true);
      assert.deepEqual(labels(r), labels(run(want, lines)));
    });
  }
  it('anything else in the string keeps it untrusted, and so does nothing left once the drivetrain words are removed', () => {
    for (const trim of ['AWD', 'AWD HYBRID AWD', 'FWD', 'All Wheel Drive CVT', 'Hybrid', 'Natl', 'LE Hybrid *1-OWNER! NEARLY', 'Hendersonville NC', 'XLE Premium Plus AWD', 'XSE Premium AWD', 'Limited Edition AWD', 'LE SE AWD']) assert.equal(run(trim, lines).trimTrusted, false, trim);
  });
  it('the trim a shorthand string resolves to is reported (exact vs folded into XLE Premium)', () => {
    assert.equal(run('LE AWD HYBRID', lines).trimVia, 'exact');
    assert.equal(run('XLE AWD Natl', lines).trimVia, 'alias');
  });
});

describe('rule 6: no trim, or an untrusted trim, means no factory options', () => {
  const lines = ['Weather Package', 'Moonroof Package', 'AWD', 'Heated Steering Wheel', 'Siri', 'Ruby Flare Pearl'];
  for (const trim of [null, '', undefined, 'Trail', 'Hybrid XSE Premium Plus', 'XLE Premium Plus', 'XSE Premium', 'XLE Sport', 'AWD', 'AWD HYBRID AWD', 'FWD', 'All Wheel Drive CVT', 'Base', 'Inventory', 'Hendersonville NC', 'LE Hybrid *1-OWNER! NEARLY', 'LE AWD Certified', 'Sport AWD', '   ']) {
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

describe('rule 7: bare Siri / Google / Alexa Built In stay as they are (bare "unlock" does not)', () => {
  it('kept verbatim on a trusted trim, next to the real options', () => {
    const r = run('SE', ['Siri', 'Google', 'Alexa Built In', 'Weather Package']);
    assert.deepEqual(labels(r), ['Alexa Built In', 'Google', 'Siri', 'Weather Package']);
    assert.ok(r.rows.filter((x) => x.kind === 'bare').every((x) => x.via === 'kept'));
  });
  it('bare "unlock" is a fragment of the standard remote keyless entry line: dropped, never kept', () => {
    for (const trim of ['LE', 'SE', 'XLE Premium', 'Woodland', 'XSE', 'Limited']) {
      const r = run(trim, ['unlock', 'Unlock', 'remote keyless entry system with lock', 'unlock and panic functions']);
      assert.deepEqual(r.rows, [], trim);
      assert.equal(r.dealerAddons.length, 0);
      assert.ok(r.dropped.some((d) => d.label.toLowerCase() === 'unlock' && d.rule === 'standard-or-unknown'), trim);
    }
    assert.ok(!RAV4_RAW['toyota|rav4|2026'].keepBare.includes('unlock'));
  });
  it('only the bare strings: longer variants are not bare names', () => assert.deepEqual(run('SE', ['Siri Eyes Free Wireless Charging Dock']).rows, []));
  it('with no trusted trim the row is empty (rule 6 wins)', () => assert.deepEqual(run(null, ['Siri']).rows, []));
});

describe('rule 8: plugged in through factoryOptionAllowlist.js, RAV4 only, keys from normalizeOptionKey()', () => {
  it('every policy key and alias is normalizeOptionKey output', () => {
    const raw = RAV4_RAW;
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
    const p = Object.values(RAV4_RAW)[0];
    assert.deepEqual(Object.values(p.trims).map((t) => t.label), ['LE', 'SE', 'XLE Premium', 'Woodland', 'XSE', 'Limited']);
  });
});
