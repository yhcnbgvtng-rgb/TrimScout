// The global, data-driven junk list (src/optionJunkRules.json) applied at write time to every car's options, policy or not.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionRowsFromOptions, compileJunkRules, setJunkRules, getJunkRules, globalJunkRuleFor } from '../src/inventoryOptionRows.js';
import { buildAllowlist, loadJunkRulesFromEnv, installJunkRulesFromEnv, optionRowsForVehicle, policyFacetRows, policyApiOptions } from '../src/factoryOptionAllowlist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES_FILE = path.join(here, '../src/optionJunkRules.json');
const RAV4_RAW = JSON.parse(fs.readFileSync(path.join(here, '../src/optionPolicies/toyota-rav4-2026.json'), 'utf8'));
const ALLOW = buildAllowlist(null, RAV4_RAW);
const quiet = { warn() {} };

// The RAV4 filter's junk (docs/toyota-2026-2027/BEFORE_AFTER_2026-10-09.md) plus one example per category.
const JUNK = {
  roadside: ['Roadside Assistance', '* Roadside Assistance for 7 Year / 100', '1yr Roadside Assistance'],
  inspection: ['Multipoint Point Inspection', '* Multipoint Point Inspection', '160-point inspection', 'Certified Pre-Owned Inspection'],
  warranty: ['Powertrain Limited Warranty', 'Extended Service Coverage'],
  'maintenance-service-plan': ['ToyotaCare Plus Maintenance Plan', 'Complimentary Scheduled Maintenance', 'Prepaid Service Plan', 'Free Oil Changes'],
  'subscription-trial': ['SiriusXM 3 Month Trial Subscription', 'Connected Services Subscription', 'Complimentary 1 Year of Remote Connect'],
  'fee-charge': ['Destination Charge', 'Dealer Handling Fee', 'Market Adjustment'],
  'standard-or-no-charge': ['Standard', 'Included', 'Back-up camera at no additional cost', 'Standard on all trims'],
};
// Real options that share words or letters with the junk. None may be dropped.
const KEEP = ['Weather Package', 'Panoramic Moonroof Package', 'Blind Spot Monitor', '3-Point Seat Belts', '5-point harness', 'Tow Hitch Receiver', 'Trailer Sway Control',
  'Maintenance-Free Battery', 'Wireless Charging Pad', 'Fast Charge Port', 'Coffee Cup Holders', 'Premium Audio', 'Trail Package', 'JBL Premium Audio Package', 'Illuminated Door Sills'];

describe('the shipped list', () => {
  let rules;
  before(() => { rules = compileJunkRules(JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'))); });
  it('compiles with no bad pattern', () => { assert.deepEqual(rules.errors, []); assert.ok(rules.rules.length >= 7); assert.ok(rules.version); });
  for (const [rule, labels] of Object.entries(JUNK)) {
    for (const label of labels) it(`${rule}: drops "${label}"`, () => assert.equal(globalJunkRuleFor(label, { name: label }, rules), rule));
  }
  for (const label of KEEP) it(`keeps "${label}"`, () => assert.equal(globalJunkRuleFor(label, { name: label, price: 495 }, rules), null));
  it('every junk label is in exactly the category listed (a pattern change that re-files one is visible here)', () => {
    for (const [rule, labels] of Object.entries(JUNK)) for (const l of labels) assert.equal(globalJunkRuleFor(l, {}, rules), rule, l);
  });
});

// The shipped file has zeroPrice OFF until it is measured on live data (2026-10-16); these tests switch it on in a copy.
const SHIPPED_RAW = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
const ZERO_ON = compileJunkRules({ ...SHIPPED_RAW, zeroPrice: { ...SHIPPED_RAW.zeroPrice, enabled: true } });

describe('zero price', () => {
  it('the shipped file ships it OFF: a $0 line is kept until the switch is turned on', () => {
    assert.equal(SHIPPED_RAW.zeroPrice.enabled, false);
    assert.equal(globalJunkRuleFor('Rear Spoiler', { price: 0 }, compileJunkRules(SHIPPED_RAW)), null);
  });
  const rules = ZERO_ON;
  const z = (o) => globalJunkRuleFor(o.name, o, rules);
  it('an explicit $0 is dropped (number and string forms)', () => { for (const price of [0, '0', '$0', '0.00']) assert.equal(z({ name: 'Rear Spoiler', price }), 'zero-price', String(price)); });
  it('a missing or null price is unknown, not free: kept', () => { assert.equal(z({ name: 'Rear Spoiler' }), null); assert.equal(z({ name: 'Rear Spoiler', price: null }), null); });
  it('a paid line is kept', () => assert.equal(z({ name: 'Rear Spoiler', price: 350 }), null));
  it('description features carry price 0 as "unknown, not free" (code FEATURE): kept', () => assert.equal(z({ code: 'FEATURE', name: 'Heated Seats', price: 0 }), null));
  it('the switch is data: turned off in the file, a $0 line is kept', () => {
    const off = compileJunkRules({ rules: [], zeroPrice: { enabled: false } });
    assert.equal(globalJunkRuleFor('Rear Spoiler', { price: 0 }, off), null);
  });
});

describe('optionRowsFromOptions with the list installed', () => {
  before(() => installJunkRulesFromEnv({}, quiet));
  after(() => setJunkRules(null));
  const names = (opts, o) => optionRowsFromOptions(opts, o).rows.map((r) => r.label);

  it('drops the RAV4 junk on a car with NO policy and keeps the controls', () => {
    const r = optionRowsFromOptions([
      { name: 'Roadside Assistance' }, { name: 'Roadside Assistance for 7 Year / 100' }, { name: 'Multipoint Point Inspection' },
      { name: 'Weather Package', price: 375 }, { name: 'Blind Spot Monitor' },
    ]);
    assert.deepEqual(r.rows.map((x) => x.label), ['Weather Package', 'Blind Spot Monitor']);
    assert.equal(r.junkDropped, 3);
    assert.deepEqual(r.dropped.map((d) => d.rule), ['junk:roadside', 'junk:roadside', 'junk:inspection']);
  });
  it('a $0 line goes, an unpriced line stays, a paid line stays', () => {
    assert.deepEqual(names([{ name: 'Rear Spoiler', price: 0 }, { name: 'Roof Rails' }, { name: 'Running Boards', price: 600 }], { junkRules: ZERO_ON }), ['Roof Rails', 'Running Boards']);
  });
  it('a make-allowlist option is vouched for and survives even at $0', () => {
    const resolveKey = (k) => (k === 'rear spoiler' ? { key: k, label: 'Rear Spoiler' } : null);
    assert.deepEqual(names([{ name: 'Rear Spoiler', price: 0 }], { resolveKey, junkRules: ZERO_ON }), ['Rear Spoiler']);
  });
  it('is the same per-option on a list split from one joined string, and the price is not copied onto the parts', () => {
    assert.deepEqual(names([{ name: 'Roof Rails; Roadside Assistance; Rear Spoiler', price: 0 }], { junkRules: ZERO_ON }), ['Roof Rails', 'Rear Spoiler']);
  });
  it('nothing installed means nothing changes (junkRules: null)', () => {
    assert.deepEqual(names([{ name: 'Roadside Assistance' }, { name: 'Rear Spoiler', price: 0 }], { junkRules: null }), ['Roadside Assistance', 'Rear Spoiler']);
  });
});

describe('before anything is installed the module behaves exactly as it did', () => {
  it('no list by default', () => { assert.equal(getJunkRules(), null); assert.deepEqual(optionRowsFromOptions([{ name: 'Roadside Assistance' }]).rows.map((r) => r.label), ['Roadside Assistance']); });
});

describe('model-policy cars: the global list never removes a vouched (paid sticker) line', () => {
  before(() => installJunkRulesFromEnv({}, quiet));
  after(() => setJunkRules(null));
  const car = (trim) => ({ make: 'Toyota', model: 'RAV4', year: 2026, trim });
  const run = (trim, opts) => optionRowsForVehicle(ALLOW, car(trim), opts);
  it('the 11-line RAV4 shape: junk named by rule, Weather Package kept', () => {
    const r = run('SE', [{ name: 'Weather Package', price: 375 }, { name: 'Roadside Assistance' }, { name: 'Multipoint Point Inspection' }, { name: 'Roadside Assistance for 7 Year / 100' }]);
    assert.deepEqual(r.rows.map((x) => x.label), ['Weather Package']);
    assert.deepEqual(r.dropped.map((d) => d.rule).sort(), ['junk:inspection', 'junk:roadside', 'junk:roadside']);
  });
  it('a paid policy package whose feed line says $0 is NOT removed (the policy vouches for it)', () => {
    assert.deepEqual(run('SE', [{ name: 'Weather Package', price: 0 }]).rows.map((x) => x.label), ['Weather Package']);
  });
  it('a policy package with a junk-looking word in a decorated name is still matched by the policy', () => {
    assert.deepEqual(run('SE', [{ name: 'Weather Package $375 (CY)', price: 0 }]).rows.map((x) => x.label), ['Weather Package']);
  });
  it('an untrusted trim vouches for nothing and stays skipped by the sync (stored rows kept)', () => {
    assert.deepEqual(policyFacetRows(ALLOW, car('Trail'), [{ name: 'Weather Package' }]), { skip: true });
  });
  it('the /api/inventory list and the facet rows agree (same engine, same input)', () => {
    const opts = [{ name: 'Weather Package', price: 375 }, { name: 'Roadside Assistance' }];
    assert.deepEqual(policyApiOptions(ALLOW, car('SE'), opts).map((o) => o.name), ['Weather Package']);
    assert.deepEqual(policyFacetRows(ALLOW, car('SE'), opts).rows.map((r) => r.label), ['Weather Package']);
  });
  it('a car with no policy gets the global list too (and its API list is untouched)', () => {
    const honda = { make: 'Honda', model: 'Civic', year: 2026, trim: 'LX' };
    const opts = [{ name: 'Roadside Assistance' }, { name: 'Sunroof' }];
    assert.equal(policyFacetRows(ALLOW, honda, opts), null);
    assert.deepEqual(optionRowsFromOptions(opts).rows.map((r) => r.label), ['Sunroof']);
    assert.equal(policyApiOptions(ALLOW, honda, opts), opts);
  });
});

describe('the list is data: change the file, change the behaviour, no code', () => {
  it('a custom pattern list replaces the shipped one', () => {
    const c = compileJunkRules({ version: 't', rules: [{ name: 'custom', patterns: ['\\bpin\\s*stripe'] }] });
    assert.deepEqual(optionRowsFromOptions([{ name: 'Pin Stripe Kit' }, { name: 'Roadside Assistance' }], { junkRules: c }).rows.map((r) => r.label), ['Roadside Assistance']);
  });
  it('a bad pattern is skipped and reported, the rest still load', () => {
    const c = compileJunkRules({ rules: [{ name: 'a', patterns: ['(', 'ok'] }] });
    assert.equal(c.errors.length, 1);
    assert.equal(c.rules[0].res.length, 1);
  });
  it('OPTION_JUNK_RULES_PATH points at another file; OPTION_JUNK_RULES=off turns it off; a missing file returns null and never throws', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junk-'));
    const f = path.join(dir, 'r.json');
    fs.writeFileSync(f, JSON.stringify({ version: 'x', rules: [{ name: 'only', patterns: ['zzz'] }] }));
    assert.equal(loadJunkRulesFromEnv({ OPTION_JUNK_RULES_PATH: f }, quiet).version, 'x');
    assert.equal(loadJunkRulesFromEnv({ OPTION_JUNK_RULES: 'off' }, quiet), null);
    assert.equal(loadJunkRulesFromEnv({ OPTION_JUNK_RULES_PATH: path.join(dir, 'nope.json') }, quiet), null);
    fs.writeFileSync(f, '{not json');
    assert.equal(loadJunkRulesFromEnv({ OPTION_JUNK_RULES_PATH: f }, quiet), null);
  });
  it('the server installs the list at boot, and the generic path is still optionRowsFromOptions', () => {
    const src = fs.readFileSync(path.join(here, '../src/deals_api_server.js'), 'utf8');
    assert.match(src, /installJunkRulesFromEnv\(\)/);
    assert.match(src, /pol \|\| optionRowsFromOptions\(v\.options/);
  });
});

describe('exemptions: real equipment that looks like a category', () => {
  const rules = compileJunkRules(JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')));
  const kept = (names, o = {}) => optionRowsFromOptions(names.map((name) => ({ name })), { junkRules: rules, ...o }).rows.map((r) => r.label);
  it('"Roadside Assistance Kit" (a physical kit) is kept; the plan lines beside it are still dropped', () => {
    assert.deepEqual(kept(['Roadside Assistance Kit', '* Roadside Assistance', 'Roadside Assistance for 7 Year / 100', '1yr Roadside Assistance']), ['Roadside Assistance Kit']);
    assert.equal(globalJunkRuleFor('* Roadside Assistance Kit', {}, rules), null);
  });
  it('"scheduled maintenance indicators" (an instrument-cluster feature) is kept; maintenance plans are still dropped', () => {
    assert.deepEqual(kept(['shift-position and scheduled maintenance indicators', 'Complimentary Scheduled Maintenance', 'Prepaid Service Plan', 'Fresh Oil Change']), ['shift-position and scheduled maintenance indicators']);
  });
  it('an exemption is exact: it does not shelter a neighbouring plan line', () => {
    assert.equal(globalJunkRuleFor('Roadside Assistance for 7 Years', {}, rules), 'roadside');
    assert.equal(globalJunkRuleFor('Scheduled Maintenance Plan', {}, rules), 'maintenance-service-plan');
  });
  it('with no list installed the module is unchanged: the kit is kept and the plan too (nothing drops either)', () => {
    assert.deepEqual(optionRowsFromOptions([{ name: 'Roadside Assistance Kit' }, { name: 'Roadside Assistance' }], { junkRules: null }).rows.map((r) => r.label), ['Roadside Assistance Kit', 'Roadside Assistance']);
  });
  it('exemptions and rewrites are data: a custom file can add one', () => {
    const c = compileJunkRules({ rules: [{ name: 'roadside', patterns: ['roadside'] }], exemptions: [{ name: 'x', patterns: ['roadside flare'] }], rewrites: [{ name: 'r', pattern: '^foo', to: 'Bar' }, { name: 'bad', pattern: '(', to: 'x' }] });
    assert.equal(c.errors.length, 1);
    assert.deepEqual(optionRowsFromOptions([{ name: 'Roadside Flare Set' }, { name: 'Roadside Plan' }, { name: 'Foo Package' }], { junkRules: c }).rows.map((r) => r.label), ['Roadside Flare Set', 'Bar']);
  });
});

describe('SiriusXM trial-subscription lines become "SiriusXM"', () => {
  const rules = compileJunkRules(JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')));
  const TRIAL = ['SiriusXM with 360L Trial Subscription', 'SiriusXM Trial Subscription', 'SiriusXM® 3-month trial subscription', 'SiriusXM with 360L and 1 Year Trial Subscription',
    'SiriusXM satellite radio system (3-month trial subscription)', '3 month Sirius trial subscription', 'SiriusXM Trial Subscription With your trial subscription', '* SiriusXM 3 Month Trial Subscription'];
  for (const label of TRIAL) it(`"${label}" -> SiriusXM`, () => {
    const r = optionRowsFromOptions([{ name: label }], { junkRules: rules });
    assert.deepEqual(r.rows.map((x) => [x.key, x.label]), [['siriusxm', 'SiriusXM']]);
    assert.equal(r.junkDropped, 0);
    assert.deepEqual(r.repaired.map((x) => x.to), ['SiriusXM']);
  });
  it('introductory / "1 Year Subscription" wording is the same option; paid extras are NOT rewritten and stay junk', () => {
    assert.deepEqual(optionRowsFromOptions([{ name: '3-month SiriusXM introductory subscription**' }, { name: 'SiriusXM Satellite Radio w/1 Year Subscription' }], { junkRules: rules }).rows.map((r) => r.label), ['SiriusXM']);
    const paidExtras = optionRowsFromOptions([{ name: '33 Month SiriusXM Extended Service Subscription', price: 495 }, { name: 'SiriusXM 3 Year Traffic and Travel Link Subscription' }], { junkRules: rules });
    assert.deepEqual(paidExtras.rows, []);
    assert.deepEqual(paidExtras.dropped.map((d) => d.rule), ['junk:warranty', 'junk:subscription-trial']);
  });
  it('many spellings on one car are ONE option', () => assert.equal(optionRowsFromOptions(TRIAL.map((name) => ({ name })), { junkRules: rules }).rows.length, 1));
  it('a car that lists the plain option too still has one row, and keeps the first code', () => {
    assert.deepEqual(optionRowsFromOptions([{ name: 'SiriusXM Trial Subscription', code: 'X1' }, { name: 'SiriusXM' }], { junkRules: rules }).rows, [{ key: 'siriusxm', label: 'SiriusXM', code: 'X1' }]);
  });
  it('other SiriusXM lines and other trials are untouched: the plain option stays as written, a connected-services trial is still dropped', () => {
    assert.deepEqual(optionRowsFromOptions([{ name: 'SiriusXM Satellite Radio' }, { name: 'SiriusXM w/360L' }, { name: 'vehicle connect services (1-year trial)' }, { name: 'Free trial of Connected Services' }], { junkRules: rules }).rows.map((r) => r.label), ['SiriusXM Satellite Radio', 'SiriusXM w/360L']);
  });
  it('with no list installed nothing is rewritten (the legacy deny rule still drops the trial line, as before)', () => {
    assert.deepEqual(optionRowsFromOptions([{ name: 'SiriusXM Trial Subscription' }], { junkRules: null }).rows, []);
  });
  it('on a model-policy car the rewritten "SiriusXM" is judged by the policy like any other line (never by the trial wording)', () => {
    const RAV4 = buildAllowlist(null, JSON.parse(fs.readFileSync(path.join(here, '../src/optionPolicies/toyota-rav4-2026.json'), 'utf8')));
    setJunkRules(rules);
    try {
      const r = optionRowsForVehicle(RAV4, { make: 'Toyota', model: 'RAV4', year: 2026, trim: 'SE' }, [{ name: 'SiriusXM Trial Subscription' }, { name: 'Weather Package', price: 375 }]);
      assert.deepEqual(r.rows.map((x) => x.label), ['Weather Package']);
      assert.ok(r.dropped.some((d) => d.label === 'SiriusXM' && d.rule === 'standard-or-unknown'));
    } finally { setJunkRules(null); }
  });
});
