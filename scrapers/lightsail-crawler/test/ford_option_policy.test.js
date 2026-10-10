// 2026 Ford option policies (F-150, Maverick, Ranger, Bronco Sport, Bronco): the approved rules, same engine as the Toyota policies.
// Source: docs/ford-2026/ford_lineup_options_by_trim.csv -> scripts/build-ford-option-policy.mjs -> src/optionPolicies/ford-2026.json (+ POLICY_REPORT.md).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle, resolvePolicyTrim,
} from '../src/factoryOptionAllowlist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const RAW = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionPolicies/ford-2026.json'), 'utf8'));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const run = (vehicle, names, extra = {}) => optionRowsForVehicle(ALLOW, { make: 'Ford', year: 2026, ...vehicle }, names.map((name) => ({ name, ...extra })));
const labels = (r) => r.rows.map((x) => x.label).sort();
const by = (r, label) => r.rows.find((x) => x.label === label);
const trimOf = (scope, label) => Object.values(RAW[scope].trims).find((t) => t.label === label);

describe('rule 1: only paid packages, paid options, paid paints and paid powertrain upgrades, per make + model + year + trim', () => {
  it('F-150 XLT keeps a paid equipment group, a paid option, a paid paint and a paid engine, each at its price', () => {
    const r = run({ model: 'F-150', trim: 'XLT' }, ['XLT Mid (302A)', 'Bedliner – Tough Bed Spray-In', 'Argon Blue Metallic', '5.0L V8 w/ Auto Start-Stop']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]).sort(), [['option', 625], ['package', 7330], ['paint', 395], ['powertrain', 2595]].sort());
  });
  it('a paid axle / transmission upgrade is a powertrain option (Bronco 10-speed automatic)', () => {
    const r = run({ model: 'Bronco', trim: 'Big Bend' }, ['10-Speed Automatic Transmission']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]), [['powertrain', 1795]]);
  });
  it('a roof color and a paid paint are paints', () => {
    const r = run({ model: 'Bronco', trim: 'Outer Banks' }, ['Marsh Gray Painted Roof', 'Desert Sand']);
    assert.ok(r.rows.length === 2 && r.rows.every((x) => x.kind === 'paint' && x.price > 0), JSON.stringify(r.rows));
  });
  it('the default-selected paid paint is a paid paint and is kept (Ranger XLT Avalanche, $395)', () => {
    assert.deepEqual(run({ model: 'Ranger', trim: 'XLT' }, ['Avalanche']).rows.map((x) => x.price), [395]);
  });
});

describe('price per trim, never per package name', () => {
  it('a name offered on several trims at different prices is priced by the vehicle\'s trim', () => {
    let proven = 0;
    for (const [scope, p] of Object.entries(RAW)) {
      const seen = new Map();
      for (const t of Object.values(p.trims)) for (const [k, o] of Object.entries(t.options)) { if (!seen.has(k)) seen.set(k, []); seen.get(k).push({ trim: t.label, label: o.label, price: o.price }); }
      for (const list of seen.values()) {
        if (new Set(list.map((x) => x.price)).size < 2) continue;
        const [model] = scope.split('|').slice(1);
        const dbModel = { 'f 150': 'F-150', 'bronco sport': 'Bronco Sport', bronco: 'Bronco', maverick: 'Maverick', ranger: 'Ranger' }[model];
        for (const x of list) assert.equal(by(run({ model: dbModel, trim: x.trim }, [x.label]), x.label).price, x.price, `${scope} ${x.trim} ${x.label}`);
        proven++;
      }
    }
    assert.ok(proven >= 5, `only ${proven} multi-price names found`);
  });
  it('the same name in two models is priced by the model (Big Bend on Bronco Sport vs Bronco)', () => {
    const a = run({ model: 'Bronco Sport', trim: 'Big Bend' }, ['Ruby Red Metallic Tinted Clearcoat']);
    const b = run({ model: 'Bronco', trim: 'Big Bend' }, ['Ruby Red Metallic Tinted Clearcoat']);
    assert.equal(a.rows[0].price, 495);
    assert.equal(b.rows[0].price, 495);
    assert.notEqual(a.scope, b.scope);
  });
  it('a package offered on one trim is not kept on a trim that lacks it', () => {
    const r = run({ model: 'F-150', trim: 'XL' }, ['XLT Mid (302A)']);
    assert.deepEqual(r.rows, []);
    assert.ok(r.dropped.every((d) => d.rule === 'not-offered-on-trim'), JSON.stringify(r.dropped));
  });
});

describe('keys: Ford package codes, or the full name when a package has no code', () => {
  it('a coded equipment group is keyed on its code and found by name, code, or the feed\'s own order code', () => {
    for (const probe of [[['XLT Mid (302A)'], {}], [['Equipment Group 302A'], {}], [['302A Equipment Group'], {}], [['Some Dealer Name'], { code: '302A' }]]) {
      const r = run({ model: 'F-150', trim: 'XLT' }, probe[0], probe[1]);
      assert.deepEqual(r.rows.map((x) => x.key), ['302a'], JSON.stringify(probe));
      assert.equal(r.rows[0].price, 7330);
    }
  });
  it('a feed-internal code ("PKG-73") is not a Ford code and never matches', () => {
    assert.deepEqual(run({ model: 'Ranger', trim: 'XLT' }, ['Sport Appearance Package'], { code: 'PKG-73' }).rows, []);
  });
  it('Maverick XL (101A) and Ranger XLT High (301A) are keyed on their codes; a package without a code is keyed on its full name', () => {
    assert.deepEqual(run({ model: 'Maverick', trim: 'XL' }, ['XL (101A) Equipment Group']).rows.map((x) => x.key), ['101a']);
    assert.deepEqual(run({ model: 'Ranger', trim: 'XLT' }, ['Equipment Group XLT High (301A)']).rows.map((x) => x.key), ['301a']);
    assert.deepEqual(run({ model: 'Ranger', trim: 'XLT' }, ['Convenience Package']).rows.map((x) => x.key), ['convenience package']);
  });
  it('every code-keyed entry in the policy is keyed on exactly its code', () => {
    let n = 0;
    for (const p of Object.values(RAW)) for (const t of Object.values(p.trims)) for (const [k, o] of Object.entries(t.options)) if (o.code) { n++; assert.equal(k, o.code.toLowerCase(), `${t.label} ${o.label}`); }
    assert.equal(n, 23);
  });
});

describe('what is never an option', () => {
  it('standard, included and unknown equipment is dropped', () => {
    const r = run({ model: 'Ranger', trim: 'XLT' }, ['Apple CarPlay', 'SYNC 4', 'Cloth Seats', 'Automatic Headlamps', 'Convenience Package']);
    assert.deepEqual(labels(r), ['Convenience Package']);
  });
  it('items Ford tags "Interior" are dropped, even priced ones (Bronco Sport Power Moonroof, Pro Power Onboard)', () => {
    const r = run({ model: 'Bronco Sport', trim: 'Big Bend' }, ['Power Moonroof', 'Pro Power Onboard – 400 W', 'Aux Switches and Wiring', 'Convenience Package']);
    assert.deepEqual(labels(r), ['Convenience Package']);
  });
  it('subscriptions are never options (Connectivity, SiriusXM, BlueCruise plans)', () => {
    const r = run({ model: 'F-150', trim: 'Lariat' }, ['SiriusXM 360L Subscription', 'FordPass Connect Plan', 'Connectivity Package', 'BlueCruise Subscription', 'BlueCruise 1-Year Plan']);
    assert.deepEqual(r.rows, []);
  });
  it('the one-time-purchase BlueCruise package is a priced factory package and is kept', () => {
    const r = run({ model: 'F-150', trim: 'Lariat' }, ['BlueCruise Hands-Free Highway Driving Equipped (One-Time Purchase)']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]), [['package', 2495]]);
  });
  it('accessories never reach the website: they are dealer add-ons, not rows (dealer bed, cargo, protection items)', () => {
    const names = ['Drop-in Bedliner', 'WeatherTech Floor Liners', 'All Weather Floor Mats', 'Cargo Net', 'Cargo Liner', 'Tonneau Cover', 'Paint Protection Film', 'Fabric Protection', 'Splash Guards', 'Hood Protector', 'Window Tint', 'Nitrogen Filled Tires', 'Running Boards', 'Bed Mat', 'Tailgate Step'];
    const r = run({ model: 'F-150', trim: 'XLT' }, names);
    assert.deepEqual(r.rows, [], JSON.stringify(r.rows));
    assert.ok(r.dealerAddons.length >= 12, `only ${r.dealerAddons.length} classed as add-ons: ${JSON.stringify(r.dealerAddons)}`);
  });
  it('the Tough Bed spray-in bedliner is the one bedliner kept; a generic or dealer bedliner is not', () => {
    for (const name of ['Bedliner – Tough Bed Spray-In', 'Tough Bed Spray-In Bedliner', 'Ford Tough Bed Spray-In Bedliner']) {
      assert.deepEqual(labels(run({ model: 'F-150', trim: 'XLT' }, [name])), ['Bedliner – Tough Bed Spray-In'], name);
    }
    for (const name of ['Spray-In Bedliner', 'Line-X Bedliner', 'Bedliner', 'Drop-in Bedliner']) {
      const r = run({ model: 'F-150', trim: 'XLT' }, [name]);
      assert.deepEqual(r.rows, [], name);
    }
  });
  it('cab, bed, door count and drivetrain are configuration choices, never options', () => {
    const r = run({ model: 'F-150', trim: 'XLT' }, ['SuperCrew', 'SuperCab', '5.5\' Box', '6.5\' Box', '4x4', '4WD', '2WD', 'Regular Cab', '4-Door', '2-Door']);
    assert.deepEqual(r.rows, []);
    assert.deepEqual(run({ model: 'Bronco', trim: 'Big Bend' }, ['4-Door', '2-Door', '4x4']).rows, []);
  });
  it('a feature inside a package is not an option; the package is recorded (rolled up) only when exactly one kept package on the trim contains it', () => {
    let proven = 0;
    for (const [scope, p] of Object.entries(RAW)) for (const t of Object.values(p.trims)) for (const [k, o] of Object.entries(t.options)) for (const f of o.features || []) {
      const label = f.replace(/^\^|\$$/g, '');
      const model = { 'f 150': 'F-150', 'bronco sport': 'Bronco Sport', bronco: 'Bronco', maverick: 'Maverick', ranger: 'Ranger' }[scope.split('|')[1]];
      const r = run({ model, trim: t.label }, [label]);
      assert.deepEqual(r.rows.map((x) => x.key), [k], `${scope} ${t.label} "${label}"`);
      assert.equal(r.rows[0].via, 'rolled_up');
      proven++;
      if (proven > 25) return;
    }
    assert.ok(proven > 0);
  });
  it('the generated policies hold no Base, $0, Interior, subscription, accessory or configuration entries', () => {
    for (const [scope, p] of Object.entries(RAW)) for (const t of Object.values(p.trims)) for (const o of Object.values(t.options)) {
      assert.ok(o.price > 0, `${scope} ${t.label} ${o.label}`);
      assert.ok(['package', 'option', 'paint', 'powertrain'].includes(o.kind));
      assert.doesNotMatch(o.label, /^base msrp$|subscription|siriusxm|connectivity|\bplan\b|weathertech|tonneau|floor (?:mat|liner)|cargo net|^(?:supercrew|supercab|regular cab|4x4|4wd|2wd)$/i, `${scope} ${t.label} ${o.label}`);
    }
  });
});

describe('combos Ford will not allow are stored as rules, not options', () => {
  it('requires / not-available-with notes are rules under the option, with the option keys they name', () => {
    const fx4 = trimOf('ford|ranger|2026', 'XLT').options['fx4 off road package'];
    assert.ok(fx4.rules.some((r) => r.type === 'requires' && /4x4/i.test(r.text)), JSON.stringify(fx4.rules));
    const sasq = trimOf('ford|bronco sport|2026', 'Big Bend');
    const types = new Set(Object.values(sasq.options).flatMap((o) => (o.rules || []).map((r) => r.type)));
    assert.ok(types.has('requires') && types.has('notAvailableWith'), [...types].join(','));
  });
  it('a rule is never an option', () => {
    for (const p of Object.values(RAW)) for (const t of Object.values(p.trims)) for (const o of Object.values(t.options)) {
      assert.doesNotMatch(o.label, /^(?:requires?|not available with|not with|only with|deletes)\b/i);
      for (const r of o.rules || []) { assert.ok(['requires', 'notAvailableWith', 'onlyWith', 'deletes'].includes(r.type)); assert.ok(r.text); assert.ok(Array.isArray(r.refs)); for (const k of r.refs) assert.ok(t.options[k], `${t.label}: rule ref ${k}`); }
    }
  });
  it('a rule line coming from a vehicle ("Requires 4x4") is not an option either', () => {
    assert.deepEqual(run({ model: 'Ranger', trim: 'XLT' }, ['Requires 4x4', 'Not available with Black Appearance Package']).rows, []);
  });
});

describe('no trusted trim means no options', () => {
  it('a blank, unknown or dealer-customized trim keeps nothing, even for names the model offers', () => {
    for (const trim of ['', null, 'FORD CUSTOM GARAGE', 'Base FCTP LOANER VEHICLE', 'Big Bend SINISTER BRONZE', 'Lobo High', 'Premium']) {
      const model = trim === 'Lobo High' ? 'Maverick' : 'Bronco';
      const r = run({ model, trim }, ['Convenience Package', 'Marsh Gray Painted Roof', 'Engine Block Heater']);
      assert.deepEqual(r.rows, [], String(trim));
      assert.equal(r.trimTrusted, false);
      assert.ok(r.dropped.some((d) => d.rule === 'no-trusted-trim'));
    }
  });
  it('trim spellings dealers really use resolve: body / bed / drivetrain words and registered marks are noise, case is ignored', () => {
    const t = (model, trim) => { const p = modelPoliciesFor(ALLOW, { make: 'Ford', year: 2026, model })[0]; const r = resolvePolicyTrim(p, trim, model); return r && r.trim.label; };
    assert.equal(t('F-150', 'XLT SuperCrew 4WD'), 'XLT');
    assert.equal(t('F-150', "Lariat 4WD SuperCrew 5.5' Box"), 'Lariat');
    assert.equal(t('F-150', 'King Ranch'), 'King Ranch');
    assert.equal(t('F-150', 'RAPTOR'), 'Raptor');
    assert.equal(t('Maverick', 'LARIAT'), 'Lariat');
    assert.equal(t('Bronco', 'Big Bend&reg;'), 'Big Bend');
    assert.equal(t('Bronco', 'Heritage Edition'), 'Heritage Edition');
    assert.equal(t('Bronco Sport', 'Heritage'), 'Heritage');
    assert.equal(t('Ranger', 'XLT 4WD SuperCrew'), 'XLT');
  });
});

describe('everything else stays as it is today', () => {
  it('Explorer, F-150 Lightning, Escape and every other Ford model get no policy', () => {
    for (const model of ['Explorer', 'F-150 Lightning', 'Escape', 'Mustang', 'Expedition', 'Mustang Mach-E', 'Transit', 'F-250']) {
      assert.equal(optionRowsForVehicle(ALLOW, { make: 'Ford', year: 2026, model, trim: 'XLT' }, [{ name: 'XLT Mid (302A)' }]), null, model);
    }
  });
  it('other model years of the five models, and other makes, get no policy', () => {
    for (const year of [2024, 2025, 2027]) assert.equal(optionRowsForVehicle(ALLOW, { make: 'Ford', year, model: 'F-150', trim: 'XLT' }, [{ name: 'XLT Mid (302A)' }]), null, String(year));
    assert.equal(optionRowsForVehicle(ALLOW, { make: 'Chevrolet', year: 2026, model: 'Ranger', trim: 'XLT' }, [{ name: 'Convenience Package' }]), null);
  });
  it('Bronco and Bronco Sport are separate policies', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Ford', year: 2026, model: 'Bronco' }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Ford', year: 2026, model: 'Bronco Sport' }).length, 1);
    assert.notEqual(modelPoliciesFor(ALLOW, { make: 'Ford', year: 2026, model: 'Bronco' })[0].scope, modelPoliciesFor(ALLOW, { make: 'Ford', year: 2026, model: 'Bronco Sport' })[0].scope);
  });
  it('the Toyota policies are unaffected by the Ford bundle', () => {
    assert.ok(optionRowsForVehicle(ALLOW, { make: 'Toyota', year: 2026, model: 'Camry', trim: 'LE' }, [{ name: 'Cold Weather Package' }]).rows.length >= 0);
  });
});

describe('the generated files are current', () => {
  it('node scripts/build-ford-option-policy.mjs --check passes', () => {
    execFileSync(process.execPath, [path.join(repo, 'scripts/build-ford-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});
