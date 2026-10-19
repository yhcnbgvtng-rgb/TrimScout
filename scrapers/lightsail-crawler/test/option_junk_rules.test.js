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

// Exact labels measured on box2 (2026-10-18) as $0 junk on tens of thousands of cars, plus date-only strings. Whole-label matches only.
describe('exact junk labels and dates', () => {
  let rules;
  before(() => { rules = compileJunkRules(JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'))); });
  for (const label of ['Exp', 'See onstar', 'See OnStar', 'com or dealer for details', 'title', 'creators', 'artists', 'OPTION PACKAGES', '11/02/2026', '1/2/26', '11-02-2026', '11.02.2026'])
    it(`drops "${label}"`, () => assert.ok(globalJunkRuleFor(label, { name: label }, rules), label));
  it('the exact-label rule is what catches the ones no earlier rule covers', () => {
    for (const label of ['Exp', 'See onstar', 'title', 'creators', 'artists', 'OPTION PACKAGES', '11/02/2026']) assert.equal(globalJunkRuleFor(label, {}, rules), 'exact-junk-labels', label);
  });
  // Real options that merely contain those words or digits must survive.
  for (const label of ['Expedition Package', 'Title Sponsor Edition', 'Artist Series Audio', 'Option Packages Plus', 'Creator Studio Display', '09/30/2026 Apple CarPlay', 'Exp Tow Package', '10-Speed Automatic', 'OnStar Guidance Plan Ready'])
    it(`keeps "${label}"`, () => assert.notEqual(globalJunkRuleFor(label, { name: label, price: 495 }, rules), 'exact-junk-labels', label));
  it('a paid line with a junk label is still junk: the label is the problem, not the price', () => assert.equal(globalJunkRuleFor('Exp', { name: 'Exp', price: 300 }, rules), 'exact-junk-labels'));
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

// ---- dealer-ad-prose / vehicle-spec-not-option / dealer-protection-appearance (2026-10-16.2) --------------------------------------------
// Sized by the read-only box2 report of 2026-10-15 (junk-options-report). The structural "drop code=FEATURE rows" rule is NOT part of this.
const POLICY_DIR = path.join(here, '../src/optionPolicies');
const POLICY_FILES = fs.readdirSync(POLICY_DIR).filter((f) => f.endsWith('.json')).sort();
const POLICY_RAW = Object.fromEntries(POLICY_FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(POLICY_DIR, f), 'utf8'))]));
const ALLOW_ALL = buildAllowlist(null, Object.assign({}, ...Object.values(POLICY_RAW)));
const SHIPPED = compileJunkRules(SHIPPED_RAW);
const NEW_RULES = ['dealer-ad-prose', 'vehicle-spec-not-option', 'dealer-protection-appearance'];

// Every policy entry: its label, aliases and normalized key, with where it lives.
function* policyNames() {
  for (const [file, raw] of Object.entries(POLICY_RAW)) {
    for (const [scope, pol] of Object.entries(raw)) {
      for (const [trimKey, trim] of Object.entries(pol.trims || {})) {
        for (const [optKey, o] of Object.entries(trim.options || {})) {
          for (const name of new Set([o.label, ...(o.aliases || []), optKey].filter(Boolean))) yield { file, scope, pol, trimKey, trim, optKey, o, name };
        }
      }
    }
  }
}
// A vehicle that the policy resolves to the given trim.
const vehicleOf = (e) => { const [make, , year] = e.scope.split('|'); return { make: e.pol.makeName || make, model: e.pol.models[0], year: Number(year), trim: e.trim.label || e.trimKey }; };
const firstEntry = (file, name) => { for (const e of policyNames()) if (e.file === file && e.name.toLowerCase() === name.toLowerCase()) return e; return null; };

describe('the three new rules are in the shipped file and sit after the original seven', () => {
  it('names and order', () => assert.deepEqual(SHIPPED.rules.map((r) => r.name), ['roadside', 'inspection', 'warranty', 'maintenance-service-plan', 'subscription-trial', 'fee-charge', 'standard-or-no-charge', ...NEW_RULES, 'exact-junk-labels']));
  it('compiles with no bad pattern', () => assert.deepEqual(SHIPPED.errors, []));
  it('the 16 policy files are all present (a new policy file must be added to this check)', () => assert.equal(POLICY_FILES.length, 16));
});

const NEW_JUNK = {
  'dealer-ad-prose': ['Priced below KBB Fair Purchase Price!', 'All vehicles are subject to prior sale', 'With our live market pricing philosophy', 'Vehicle Details', 'Road trips used to be stressful',
    'Set it and forget it', 'VISIT US TODAY', 'WHY BUY FROM US', 'January 2017', 'Summary', 'Source: KBB', 'please contact the dealer for more information', 'Local Trade In', 'See toyota.com for details'],
  'vehicle-spec-not-option': ['4D Sport Utility', '4D Crew Cab', '2D Coupe', '10-Speed Automatic', '8-Speed Automatic', 'CVT', 'Jet Black', 'Black Cloth', 'Black Leather', 'Black', 'blackwall', 'AWD', '4WD', '4x4', 'All Wheel Drive', 'FWD', 'Four wheel drive'],
  'dealer-protection-appearance': ['Paint Protection Film', 'Paint Protection', 'Fabric Protection', 'Window Tint ($399)', 'Dealer Accessories include Window Tint', 'VIN Etch', 'Nitrogen Tires', 'Pinstripe', 'LoJack',
    'dealer-installed options', 'New vehicle pricing excludes dealer installed accessories', 'Price includes dealer added accessories', 'All-Weather Floor Liner (LPO)', 'Wheel Locks (Set of 4) (LPO)', 'Rustproofing', 'Undercoating', 'Anti-Theft Etch', 'Theft Deterrent Plan'],
};
// Real equipment and real factory packages that the broader first drafts of these patterns would have hit. None may be dropped.
const NEW_KEEP = ['Lariat Black Appearance Package', 'XLT Sport Appearance Package', 'Black Appearance Package', 'Chrome Appearance Package', 'Appearance Package',
  'Z71 Off-Road & Protection Package', 'Z71 Off-Road and Protection Package', 'Load Area Protection Package', 'Protection Package', 'Interior Protection Package', 'Bed Protection Package', 'Sun Protection Package',
  'Theft Deterrent System (Unauthorized Entry)', 'Theft Deterrent System', 'Electrical Theft Deterrent System', 'Anti-Theft Package', 'Battery Protection Package',
  'Leather', 'Cloth', 'Leather Seats', 'Cloth Seat Trim', 'Leather-Wrapped Steering Wheel', 'Leatherette Seat Trim', 'Heated Seats', 'Power Liftgate', 'Technology Package', 'Safety Connect', 'Driver Assist', 'Convenience Package',
  'Black Roof', 'Black Wheels', 'Black Cloth Seat Trim', 'Jet Black Leather Seats', 'Black Mirror Caps', 'AWD Package', '4WD Package', 'Off-Road Package', 'Trailering Package', 'Tow Package', 'Premium Package', 'Summary Package',
  'Mobile Hotspot', 'Wi-Fi Hotspot Capable', 'Window Sticker', 'Tinted Glass', 'Deep-Tinted Glass', 'Privacy Glass', 'Rust-Resistant Coating Package'];

describe('new rules: what they drop', () => {
  for (const [rule, labels] of Object.entries(NEW_JUNK)) for (const label of labels) it(`${rule}: drops "${label}"`, () => assert.equal(globalJunkRuleFor(label, { name: label }, SHIPPED), rule));
  for (const label of NEW_KEEP) it(`keeps "${label}"`, () => assert.equal(globalJunkRuleFor(label, { name: label, price: 495 }, SHIPPED), null));
  it('an original category still wins over a new one on the same line (rule order is unchanged)', () => {
    assert.equal(globalJunkRuleFor('Roadside Assistance', {}, SHIPPED), 'roadside');
    assert.equal(globalJunkRuleFor('Complimentary Oil Change (dealer-installed)', {}, SHIPPED), 'maintenance-service-plan');
  });
  it('the existing exemptions and the SiriusXM rewrite still behave', () => {
    assert.equal(globalJunkRuleFor('Roadside Assistance Kit', {}, SHIPPED), null);
    assert.deepEqual(optionRowsFromOptions([{ name: 'SiriusXM Trial Subscription' }], { junkRules: SHIPPED }).rows.map((r) => r.label), ['SiriusXM']);
  });
});

describe('new rules vs the 16 model-policy files', () => {
  const touched = new Map(); // "file|rule|name" -> rule
  let checked = 0;
  before(() => {
    for (const e of policyNames()) { checked++; const rule = globalJunkRuleFor(e.name, { name: e.name }, SHIPPED); if (rule) touched.set(`${e.file}|${rule}|${e.name.toLowerCase()}`, rule); }
  });
  it('checks every label, alias and key in all 16 files', () => assert.ok(checked > 25000, String(checked)));
  it('the 7 original rules, dealer-ad-prose and dealer-protection-appearance touch NO policy label', () => {
    const bad = [...touched].filter(([, r]) => r !== 'vehicle-spec-not-option');
    assert.deepEqual(bad, []);
  });
  // The ONLY policy names a new rule matches as bare text. They are paid options for the brand and are spared by the policy vouching
  // (see "survive the real write path" below). If a pattern change touches another policy label, this list changes and the diff is reviewed.
  const EXPECTED_TOUCHED = [
    'audi-2026-2027.json|black',
    'buick-2026-2027.json|awd',
    'cadillac-2026-2027.json|awd',
    'chevrolet-2026-2027.json|4wd', 'chevrolet-2026-2027.json|awd',
    'gmc-2026-2027.json|4wd', 'gmc-2026-2027.json|awd',
    'hyundai-2025-2027.json|awd',
    'kia-2026-2027.json|awd',
    'mercedes-2026-2027.json|black leather',
    'subaru-2026-2027.json|6 speed automatic', 'subaru-2026-2027.json|6-speed automatic',
    'toyota-2026-2027.json|4 wheel drive', 'toyota-2026-2027.json|4-wheel drive', 'toyota-2026-2027.json|4wd', 'toyota-2026-2027.json|4x4', 'toyota-2026-2027.json|8 speed automatic', 'toyota-2026-2027.json|8-speed automatic',
    'toyota-2026-2027.json|all wheel drive', 'toyota-2026-2027.json|all-wheel drive', 'toyota-2026-2027.json|awd', 'toyota-2026-2027.json|four wheel drive',
    'toyota-rav4-2026.json|all wheel drive', 'toyota-rav4-2026.json|all-wheel drive', 'toyota-rav4-2026.json|awd',
  ].sort();
  it('lists exactly the policy labels the vehicle-spec rule touches', () => {
    assert.deepEqual([...touched.keys()].map((k) => { const [f, , n] = k.split('|'); return `${f}|${n}`; }).sort(), EXPECTED_TOUCHED);
  });
});

describe('every policy label survives the real write path (policy cars)', () => {
  before(() => installJunkRulesFromEnv({}, quiet));
  after(() => setJunkRules(null));
  it('no label, alias or key of any trim in any of the 16 files is dropped by a junk rule (and the label is kept)', () => {
    const failures = []; let n = 0;
    for (const e of policyNames()) {
      if (e.name === e.optKey && e.name !== e.o.label && !(e.o.aliases || []).includes(e.name)) continue; // the normalized key is an index entry, not a feed spelling
      n++;
      const r = optionRowsForVehicle(ALLOW_ALL, vehicleOf(e), [{ name: e.name }]);
      if (!r) { failures.push(`${e.file} ${e.scope}: no policy resolved`); continue; }
      const junk = r.dropped.filter((d) => String(d.rule).startsWith('junk:'));
      if (junk.length) failures.push(`${e.file} ${e.scope} ${e.trimKey}: "${e.name}" -> ${junk[0].rule}`);
    }
    assert.ok(n > 15000, String(n));
    assert.deepEqual(failures.slice(0, 20), []);
  });
});

describe('controls: the same words are junk on a car with no policy and kept where the policy sells them', () => {
  before(() => installJunkRulesFromEnv({}, quiet));
  after(() => setJunkRules(null));
  const dropped = (opts, o = {}) => optionRowsFromOptions(opts.map((name) => ({ name })), o).dropped.map((d) => `${d.label}:${d.rule}`);
  const generic = (name) => optionRowsFromOptions([{ name }]).dropped.map((d) => d.rule);
  const CASES = [
    { what: 'Toyota 4Runner 4WD', file: 'toyota-2026-2027.json', name: '4WD', generic: '4WD' },
    { what: 'Toyota Camry AWD', file: 'toyota-2026-2027.json', name: 'AWD', generic: 'AWD' },
    { what: 'Toyota RAV4 All-Wheel Drive', file: 'toyota-rav4-2026.json', name: 'All-Wheel Drive', generic: 'All-Wheel Drive' },
    { what: 'Chevrolet 4WD', file: 'chevrolet-2026-2027.json', name: '4WD', generic: '4WD' },
    { what: 'GMC AWD', file: 'gmc-2026-2027.json', name: 'AWD', generic: 'AWD' },
    { what: 'Buick AWD', file: 'buick-2026-2027.json', name: 'AWD', generic: 'AWD' },
    { what: 'Cadillac AWD', file: 'cadillac-2026-2027.json', name: 'AWD', generic: 'AWD' },
    { what: 'Hyundai AWD', file: 'hyundai-2025-2027.json', name: 'AWD', generic: 'AWD' },
    { what: 'Kia AWD', file: 'kia-2026-2027.json', name: 'AWD', generic: 'AWD' },
    { what: 'Mercedes Black Leather', file: 'mercedes-2026-2027.json', name: 'Black Leather', generic: 'Black Leather' },
    { what: 'Audi Black', file: 'audi-2026-2027.json', name: 'Black', generic: 'Black' },
    { what: 'Subaru BRZ 6-Speed Automatic', file: 'subaru-2026-2027.json', name: '6-Speed Automatic', generic: '6-Speed Automatic' },
    { what: 'Toyota Tacoma 8-Speed Automatic', file: 'toyota-2026-2027.json', name: '8-Speed Automatic', generic: '8-Speed Automatic' },
  ];
  for (const c of CASES) {
    it(`${c.what}: dropped on a car with no policy, kept on the policy car that sells it`, () => {
      assert.deepEqual(generic(c.generic), ['junk:vehicle-spec-not-option']);
      const e = firstEntry(c.file, c.name);
      assert.ok(e, `${c.name} not found in ${c.file}`);
      const r = optionRowsForVehicle(ALLOW_ALL, vehicleOf(e), [{ name: c.name }]);
      assert.deepEqual(r.dropped, []);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0].label, e.o.label);
    });
  }
  it('a policy car that does NOT sell AWD on its trim still loses a bare "AWD" line (as standard-or-unknown, not by the junk list)', () => {
    const e = firstEntry('toyota-2026-2027.json', '4WD');
    const r = optionRowsForVehicle(ALLOW_ALL, { ...vehicleOf(e), trim: e.trim.label || e.trimKey }, [{ name: 'Heated Mirrors Spec' }]);
    assert.equal(r.rows.length, 0);
  });
  it('the vouching is per trim: a junk-list line next to a vouched one is still dropped on the same policy car', () => {
    const e = firstEntry('toyota-2026-2027.json', '4WD');
    const r = optionRowsForVehicle(ALLOW_ALL, vehicleOf(e), [{ name: '4WD' }, { name: 'Priced below KBB Fair Purchase Price!' }, { name: 'Window Tint ($399)' }]);
    assert.deepEqual(r.rows.map((x) => x.label), [e.o.label]);
    assert.deepEqual(r.dropped.map((d) => d.rule).sort(), ['junk:dealer-ad-prose', 'junk:dealer-protection-appearance']);
  });
  it('the rejected broad patterns stay out: a car with no policy keeps its real appearance / protection packages and feature lines', () => {
    const keep = ['Lariat Black Appearance Package', 'Z71 Off-Road & Protection Package', 'Theft Deterrent System (Unauthorized Entry)', 'Leather', 'Cloth', 'Anti-Theft Package'];
    assert.deepEqual(dropped(keep), []);
    assert.deepEqual(optionRowsFromOptions(keep.map((name) => ({ name }))).rows.map((r) => r.label), keep);
  });
});
