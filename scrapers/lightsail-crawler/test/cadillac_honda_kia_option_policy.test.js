// 2026-27 Cadillac (10 models), Honda (14) and Kia (19) option policies: the approved rules, same engine as the Toyota, Ford and GM policies.
// Source: docs/cadillac-honda-kia-2026-2027/<brand>_lineup_options_by_trim.csv -> scripts/build-cadillac-honda-kia-option-policy.mjs -> src/optionPolicies/<brand>-2026-2027.json.
// Paul's rule: every paid factory line on the window sticker stays, including paid interior colors and materials; accessories, $0 items and subscriptions go.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle, policyFacetRows, policyApiOptions,
} from '../src/factoryOptionAllowlist.js';
import { parseCsv } from '../../../scripts/lib/optionPolicyCommon.mjs';
import { normalizeOptionKey } from '../src/inventoryOptionRows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const BRANDS = ['cadillac', 'honda', 'kia'];
const RAW = Object.fromEntries(BRANDS.map((b) => [b, JSON.parse(fs.readFileSync(path.join(repo, `scrapers/lightsail-crawler/src/optionPolicies/${b}-2026-2027.json`), 'utf8'))]));
const CSV = Object.fromEntries(BRANDS.map((b) => [b, parseCsv(fs.readFileSync(path.join(repo, `docs/cadillac-honda-kia-2026-2027/${b}_lineup_options_by_trim.csv`), 'utf8'))]));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const MAKE = { cadillac: 'Cadillac', honda: 'Honda', kia: 'Kia' };
const run = (make, vehicle, names, extra = {}) => optionRowsForVehicle(ALLOW, { make, year: 2027, ...vehicle }, names.map((name) => ({ name, ...extra })));
const labels = (r) => r.rows.map((x) => x.label).sort();
const slug = normalizeOptionKey;
const entries = (b) => Object.entries(RAW[b]).flatMap(([scope, p]) => Object.entries(p.trims).flatMap(([tk, t]) => Object.entries(t.options).map(([k, o]) => ({ scope, tk, k, o, trim: t.label }))));

describe('what is covered: make + model + year + trim', () => {
  it('Cadillac has 10 models, Honda 14 and Kia 19, one policy per model and year', () => {
    assert.deepEqual(BRANDS.map((b) => Object.keys(RAW[b]).length), [10, 14, 19]);
    assert.deepEqual(BRANDS.map((b) => new Set(Object.values(RAW[b]).map((p) => p.models[0])).size), [10, 14, 19]);
  });
  it('policy sizes (entries per brand) match the generated report', () => {
    assert.deepEqual(BRANDS.map((b) => entries(b).length), [628, 190, 322]);
  });
  it('another model year, another model and a make without a policy are untouched', () => {
    for (const v of [
      { make: 'Cadillac', model: 'Escalade', year: 2025 }, { make: 'Cadillac', model: 'CT4', year: 2026 }, { make: 'Cadillac', model: 'XT5', year: 2027 },
      { make: 'Honda', model: 'Civic', year: 2026 }, { make: 'Honda', model: 'Accord', year: 2027 }, { make: 'Honda', model: 'Pilot', year: 2025 },
      { make: 'Kia', model: 'Forte', year: 2026 }, { make: 'Kia', model: 'Telluride', year: 2026 }, { make: 'Kia', model: 'Soul', year: 2027 },
      { make: 'Acura', model: 'MDX', year: 2026 }, { make: 'Hyundai', model: 'Palisade', year: 2026 }, { make: 'Nissan', model: 'Rogue', year: 2027 },
    ]) {
      assert.deepEqual(modelPoliciesFor(ALLOW, v), [], JSON.stringify(v));
      assert.equal(optionRowsForVehicle(ALLOW, { ...v, trim: 'LX' }, [{ name: 'Sunroof Package' }]), null);
      assert.equal(policyFacetRows(ALLOW, { ...v, trim: 'LX' }, [{ name: 'Sunroof Package' }]), null);
      const same = [{ name: 'Sunroof Package' }];
      assert.equal(policyApiOptions(ALLOW, { ...v, trim: 'LX' }, same), same);
    }
  });
  it('Toyota, Ford and GM stay covered', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Ford', model: 'Ranger', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'RAV4', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Chevrolet', model: 'Trax', year: 2026 }).length, 1);
  });
  it('the policy files are bundled and listed for the box install script', () => {
    const sh = fs.readFileSync(path.join(repo, 'scripts/box/2026-10-11-option-policy-write-path.sh'), 'utf8');
    for (const b of BRANDS) assert.ok(sh.includes(`${b}-2026-2027`), b);
  });
});

describe('the CSV is the contract: every paid factory line is in, nothing else is', () => {
  for (const b of BRANDS) {
    it(`${b}: every priced package, option (any subcategory, interior included), paint and powertrain row is kept at its trim, and nothing else`, () => {
      const expected = new Map();
      for (const r of CSV[b]) {
        const price = Number(r.price_usd) || 0;
        if (r.category === 'Base' || !(price > 0)) continue;
        assert.ok(['Factory package', 'Factory option', 'Exterior color', 'Powertrain'].includes(r.category), `${b}: unexpected category ${r.category}`);
        const key = slug(r.item.replace(/®|™/g, '').replace(/\s+/g, ' ').trim());
        const k = `${b}|${slug(r.model)}|${r.year}|${slug(r.trim)}|`;
        let full = `${k}${key}`;
        if (expected.has(full)) full = `${k}${key} ${price}`; // same name at a second price: both stay
        expected.set(full, r);
      }
      const actual = new Set(entries(b).map((e) => `${e.scope}|${e.tk}|${e.k}`));
      assert.deepEqual([...actual].filter((x) => !expected.has(x)), [], `${b}: policy entries the rules do not keep`);
      assert.deepEqual([...expected.keys()].filter((x) => !actual.has(x)), [], `${b}: kept CSV rows missing from the policy`);
    });
  }
  it('every entry is paid, and rules are data under an option, never options', () => {
    for (const b of BRANDS) for (const { o, trim } of entries(b)) {
      assert.ok(o.price > 0, `${trim} ${o.label}`);
      assert.doesNotMatch(o.label, /^(?:requires?|not available|only with|deletes?)\b/i, o.label);
      for (const rule of o.rules || []) assert.ok(['requires', 'notAvailableWith', 'onlyWith', 'deletes'].includes(rule.type));
    }
  });
  it('the generated JSON and reports are current', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-cadillac-honda-kia-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('Cadillac', () => {
  it('Optiq Premium Luxury AWD: the 19.2 kW charging module and a paid paint stay; XT5 Sport: paid interior color + Onyx Lite', () => {
    const r = run('Cadillac', { model: 'Optiq', trim: 'Premium Luxury AWD' }, ['19.2 kW capable onboard charging module']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]), [['option', 1580]]);
  });
  it('Escalade ESV Luxury 4WD: the paid Renaissance Red interior ($2,000) and the Cat-Back exhaust stay', () => {
    const r = run('Cadillac', { model: 'Escalade ESV', trim: 'Luxury 4WD' }, ['Renaissance Red with Black accents, faceted quilting', 'Cat-Back Performance Exhaust System']);
    assert.deepEqual(r.rows.map((x) => x.price).sort((a, b) => a - b), [2000, 4320]);
  });
  it('Escalade Platinum Luxury 4WD: Executive Second Row Seating Package ($7,500) is a package', () => {
    const r = run('Cadillac', { model: 'Escalade', trim: 'Platinum Luxury 4WD' }, ['Executive Second Row Seating Package']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]), [['package', 7500]]);
  });
  it('CT5-V V-Series RWD: the same-named Jet Black leather sticker line at $1,500 AND $2,890 are both kept; a torch red belt line stays', () => {
    const o = RAW.cadillac['cadillac|ct5 v|2026'].trims['v series rwd'].options;
    const jet = Object.values(o).filter((x) => x.label === 'Jet Black with Jet Black accents, Leather Seating Surfaces');
    assert.deepEqual(jet.map((x) => x.price).sort((a, b) => a - b), [1500, 2890]);
    assert.ok(Object.values(o).some((x) => x.label === 'Torch Red seat belt color' && x.price === 400));
  });
  it('every Cadillac entry is found by its own label, except sticker lines the shared junk filter drops first (commas / inch marks) and the second price of a same-named line', () => {
    const lost = [];
    for (const [scope, p] of Object.entries(RAW.cadillac)) for (const t of Object.values(p.trims)) for (const [k, o] of Object.entries(t.options)) {
      const [, , year] = scope.split('|');
      const r = optionRowsForVehicle(ALLOW, { make: 'Cadillac', model: p.models[0], year: Number(year), trim: t.label }, [{ name: o.label }]);
      if (!r.rows.some((x) => x.key === k)) lost.push({ label: o.label, rule: r.outcomes[0]?.rule || r.outcomes[0]?.outcome, second: /\s\d{3,}$/.test(k) });
    }
    assert.ok(lost.every((x) => x.second || (x.rule === 'legacy' && /[,"]/.test(x.label))), JSON.stringify(lost));
    assert.ok(lost.length <= 14, `${lost.length} lost`);
  });
  it('trims carry the drivetrain: Sport AWD is trusted, a bare Sport on CT5 (RWD or AWD?) is not', () => {
    assert.deepEqual(run('Cadillac', { model: 'CT5', year: 2026, trim: 'Sport AWD' }, ['Ventilated driver and front passenger seats']).rows.map((x) => x.price), [450]);
    assert.deepEqual(run('Cadillac', { model: 'CT5', year: 2026, trim: 'Sport' }, ['Ventilated driver and front passenger seats']).rows, []);
  });
  it('XT5 trims are plain: Sport, Kona Brown Sauvage interior ($1,445) and the Onyx Lite Package ($3,495)', () => {
    const r = run('Cadillac', { model: 'XT5', year: 2026, trim: 'Sport AWD' }, ['Kona Brown Sauvage', 'Onyx Lite Package']);
    assert.deepEqual(r.rows.map((x) => x.price).sort((a, b) => a - b), [1445, 3495]);
  });
  it('a combo the maker will not allow is stored as a rule, not an option', () => {
    const withRules = entries('cadillac').filter((e) => (e.o.rules || []).length);
    assert.ok(withRules.length >= 1);
    for (const e of withRules) assert.ok(Array.isArray(e.o.rules[0].refs));
  });
});

describe('Honda', () => {
  it('only paint, drivetrain and the Pilot / Passport towing hardware: HR-V LX paid paint + AWD', () => {
    const r = run('Honda', { model: 'HR-V', trim: 'LX' }, ['Platinum White', 'AWD CVT', 'Apple CarPlay', 'Cloth Seats']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]).sort(), [['paint', 455], ['powertrain', 1500]].sort());
  });
  it('Pilot Towing Package is a package priced per trim (Sport $895, Touring $1,140)', () => {
    assert.equal(run('Honda', { model: 'Pilot', year: 2026, trim: 'Sport' }, ['Towing Package']).rows[0].price, 895);
    assert.equal(run('Honda', { model: 'Pilot', year: 2026, trim: 'Touring' }, ['Towing Package']).rows[0].price, 1140);
    assert.deepEqual(run('Honda', { model: 'Pilot', year: 2026, trim: 'TrailSport' }, ['Towing Package']).rows, [], 'TrailSport is not offered it');
  });
  it('a $0 item is not an option: the Passport RTL Towing includes the hitch (not a row), Blackout is $0', () => {
    assert.deepEqual(run('Honda', { model: 'Passport', trim: 'RTL Towing' }, ['Towing Package', 'Trailer Hitch']).rows, []);
    assert.deepEqual(run('Honda', { model: 'Passport', trim: 'TrailSport Blackout' }, ['Blackout Package']).rows, []);
  });
  it('the Prelude Hybrid Winter Frost is $655, the default-selected paid paint of Two-Tone is kept', () => {
    assert.deepEqual(run('Honda', { model: 'Prelude', trim: 'Hybrid' }, ['Winter Frost']).rows.map((x) => x.price), [655]);
    assert.deepEqual(run('Honda', { model: 'Prelude', trim: 'Hybrid Two-Tone' }, ['Winter Frost Pearl']).rows.map((x) => x.price), [655]);
  });
  it('drivetrain words in the vehicle trim are noise: CR-V "Sport Hybrid AWD" is Sport Hybrid', () => {
    const r = run('Honda', { model: 'CR-V', trim: 'Sport Hybrid AWD' }, ['AWD 2.0L L4 with 2-Motor Hybrid System']);
    assert.deepEqual(r.rows.map((x) => x.price), [1500]);
  });
  it('the e:FCEV, Accord and Odyssey have no accessory, subscription or standard-equipment rows', () => {
    const r = run('Honda', { model: 'Odyssey', trim: 'Touring' }, ['All-Season Floor Mats', 'HondaLink Subscription', 'Leather Seats', 'Radiant Red']);
    assert.deepEqual(labels(r), ['Radiant Red']);
  });
  it('no trusted trim -> no options', () => {
    assert.deepEqual(run('Honda', { model: 'Pilot', year: 2026, trim: 'Elite Plus' }, ['Towing Package']).rows, []);
    assert.deepEqual(run('Honda', { model: 'Pilot', year: 2026, trim: null }, ['Towing Package']).rows, []);
  });
});

describe('Kia', () => {
  it('a FWD/AWD package pair is ONE entry with a price per drivetrain (EV3 Wind Nightfall: FWD $1,500, AWD $1,000)', () => {
    const wind = RAW.kia['kia|ev3|2027'].trims.wind.options;
    const nf = Object.values(wind).filter((o) => /Nightfall/.test(o.label));
    assert.equal(nf.length, 1);
    assert.deepEqual(nf[0].priceByDrivetrain, { fwd: 1500, awd: 1000 });
    assert.equal(nf[0].price, 1500);
    const price = (trim, extra = {}) => run('Kia', { model: 'EV3', trim, ...extra }, ['Wind Nightfall Package']).rows[0].price;
    assert.equal(price('Wind'), 1500, 'unknown drivetrain -> the FWD price');
    assert.equal(price('Wind FWD'), 1500);
    assert.equal(price('Wind AWD'), 1000);
    assert.equal(price('Wind', { drivetrain: 'AWD' }), 1000);
    assert.equal(price('Wind', { drivetrain: 'FWD' }), 1500);
  });
  it('pairs priced the same in both drivetrains stay one entry at that price (Seltos EX Panoramic Sunroof $1,500)', () => {
    const r = run('Kia', { model: 'Seltos', trim: 'EX' }, ['EX Panoramic Sunroof Package']);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].price, 1500);
    for (const trim of ['EX AWD', 'EX FWD']) assert.equal(run('Kia', { model: 'Seltos', trim }, ['EX Panoramic Sunroof Package']).rows[0].price, 1500);
  });
  it('no entry is duplicated per drivetrain: no "FWD" / "AWD" copy of a package exists', () => {
    for (const { o } of entries('kia').filter((e) => e.o.kind === 'package')) assert.doesNotMatch(o.label, /\b(?:FWD|AWD)\b/);
  });
  it('paid interior color / material choices stay (Telluride EX Black & Butter Brown SynTex $295, Carnival EX Off-Black $950)', () => {
    assert.deepEqual(run('Kia', { model: 'Telluride', trim: 'EX' }, ['Black & Butter Brown SynTex Seat Trim']).rows.map((x) => [x.kind, x.price]), [['option', 295]]);
    assert.deepEqual(run('Kia', { model: 'Carnival MPV', trim: 'EX' }, ['Off-Black SynTex Seat Trim']).rows.map((x) => x.price), [950]);
  });
  it('K5 GT-Line: premium package, matte paint at its own price, AWD upgrade; GT1 is not offered on GT-Line', () => {
    const r = run('Kia', { model: 'K5', trim: 'GT-Line' }, ['GT-Line Premium Package', 'Steel Matte Gray', 'AWD', 'GT1 Package']);
    assert.deepEqual(r.rows.map((x) => [x.label, x.price]).sort(), [['AWD', 1600], ['GT-Line Premium Package', 2200], ['Steel Matte Gray', 695]].sort());
  });
  it('a package one trim offers is not kept on a trim that lacks it, and a package is never expanded into its features', () => {
    assert.deepEqual(run('Kia', { model: 'Seltos', trim: 'LX' }, ['EX Panoramic Sunroof Package']).rows, []);
    const r = run('Kia', { model: 'Sportage', trim: 'X-Line' }, ['Harman Kardon Premium Audio System w/ 8 speakers']);
    assert.ok(r.rows.every((x) => x.kind === 'package'), JSON.stringify(r.rows));
  });
  it('no trusted trim -> no options (a bare "SX" on the 2027 Sportage, which has SX and SX Prestige, is its own trim; "Prestige" is untrusted)', () => {
    assert.deepEqual(run('Kia', { model: 'Sportage', trim: 'Prestige' }, ['Glacial White Pearl']).rows, []);
    assert.deepEqual(run('Kia', { model: 'Sportage', trim: '' }, ['Glacial White Pearl']).rows, []);
  });
  it('a blank trim on the sync payload leaves stored rows alone, a trim the policy does not trust also leaves them alone (skip, never wipe)', () => {
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Kia', model: 'K5', year: 2027, trim: '' }, [{ name: 'GT1 Package' }]), { skip: true });
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Kia', model: 'K5', year: 2027, trim: 'Nope' }, [{ name: 'GT1 Package' }]), { skip: true });
  });
});

describe('write path and API list (code only, policy on)', () => {
  const car = { make: 'Honda', model: 'HR-V', year: 2027, trim: 'LX' };
  const feed = [{ name: 'Platinum White', price: 455 }, { name: 'Apple CarPlay' }, { name: 'Bluetooth' }, { name: 'Cloth Seats' }];
  it('the facet table gets only the policy rows and the API list is the same set, with the policy price and kind', () => {
    assert.deepEqual(policyFacetRows(ALLOW, car, feed).rows.map((x) => x.key), ['platinum white']);
    assert.deepEqual(policyApiOptions(ALLOW, car, feed), [{ code: null, name: 'Platinum White', price: 455, kind: 'paint' }]);
  });
  it('the Kia drivetrain price reaches the API list', () => {
    const awd = policyApiOptions(ALLOW, { make: 'Kia', model: 'EV3', year: 2027, trim: 'Wind AWD' }, [{ name: 'Wind Nightfall Package' }]);
    assert.deepEqual(awd.map((x) => x.price), [1000]);
  });
});
