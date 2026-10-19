// The nightly sync's option decision (src/syncOptionClean.js): junk list + model policies for BOTH the stored rows and options_json, exact-junk labels
// dropped even on cars the policy cannot read, paid sticker lines kept. Pure logic here; the real handler is exercised in deals_bulk_handler.test.js.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setJunkRules, compileJunkRules } from '../src/inventoryOptionRows.js';
import { loadSyncAllowlist, loadAllowlistFromEnv, EMPTY_ALLOWLIST, installJunkRulesFromEnv, BUNDLED_MODEL_POLICY_PATHS } from '../src/factoryOptionAllowlist.js';
import { isExactJunkLabel, stripExactJunk, isPaidOption, cleanOptionsForWrite, staleExactJunkKeys, keepPaidStoredRows, EXACT_JUNK_RULE } from '../src/syncOptionClean.js';

const { allowlist: ALLOW } = loadSyncAllowlist({});
const RULES = JSON.parse(fs.readFileSync(new URL('../src/optionJunkRules.json', import.meta.url), 'utf8'));
const F150 = { make: 'Ford', model: 'F-150', year: 2026, trim: 'XLT' };
const LINES = () => [
  { name: 'XLT Black Appearance Package', code: 'X1', price: 920 },
  { name: 'OPTION PACKAGES' }, { name: 'Exp' }, { name: 'Title' }, { name: 'Creators' }, { name: 'Artists' }, { name: '09/30/2026' },
  { name: 'Roadside Assistance' }, { name: 'Cruise Control' },
];
const names = (l) => l.map((o) => o.name);

describe('exact-junk labels', () => {
  before(() => installJunkRulesFromEnv({}, { warn() {} }));
  after(() => setJunkRules(null));

  it('are matched whole, ignoring case and punctuation, and nothing longer', () => {
    for (const l of ['OPTION PACKAGES', 'option packages', 'Exp', 'EXP.', 'Title', 'Creators', 'Artists', 'See OnStar', 'com or dealer for details', '09/30/2026', '9-3-26', '- Title -'])
      assert.equal(isExactJunkLabel(l), true, l);
    for (const l of ['Option Packages Group', 'Expedition Package', 'Title Package', 'Creators Edition', 'XLT Black Appearance Package', 'Heated Seats', '', null])
      assert.equal(isExactJunkLabel(l), false, String(l));
  });

  it('the built-in patterns and the rule in optionJunkRules.json agree', () => {
    const rule = RULES.rules.find((r) => r.name === EXACT_JUNK_RULE);
    assert.ok(rule, 'optionJunkRules.json carries the exact-junk-labels rule');
    const sample = ['OPTION PACKAGES', 'Exp', 'Title', 'Creators', 'Artists', 'See OnStar', 'com or dealer for details', '1/2/26', '12.31.2026', 'Exp Package', 'Title Pkg', 'Heated Seats', '2026'];
    const res = rule.patterns.map((p) => new RegExp(p, 'i'));
    setJunkRules(null); // built-ins only
    for (const l of sample) assert.equal(isExactJunkLabel(l), res.some((re) => re.test(l)), l);
    installJunkRulesFromEnv({}, { warn() {} });
  });

  it('are still dropped when the junk list is off', () => {
    setJunkRules(null);
    assert.equal(isExactJunkLabel('OPTION PACKAGES'), true);
    installJunkRulesFromEnv({}, { warn() {} });
  });

  it('a priced line is never dropped as exact junk', () => {
    assert.equal(isPaidOption({ name: 'Title', price: 250 }), true);
    const s = stripExactJunk([{ name: 'Title', price: 250 }, { name: 'Title' }, { name: 'Heated Seats' }]);
    assert.deepEqual(s.options, [{ name: 'Title', price: 250 }, { name: 'Heated Seats' }]);
    assert.equal(s.dropped, 1);
    const same = [{ name: 'Heated Seats' }];
    assert.equal(stripExactJunk(same).options, same, 'nothing dropped: the same array back');
  });
});

describe('cleanOptionsForWrite', () => {
  before(() => installJunkRulesFromEnv({}, { warn() {} }));
  after(() => setJunkRules(null));

  it('default (junk): a trusted covered car keeps the payload minus junk-list and exact-junk lines, so a later policy change can still be derived from it', () => {
    const r = cleanOptionsForWrite(ALLOW, F150, LINES());
    assert.equal(r.covered, true); assert.equal(r.trusted, true);
    assert.deepEqual(r.optionsJson, [{ name: 'XLT Black Appearance Package', code: 'X1', price: 920 }, { name: 'Cruise Control' }]);
    assert.equal(r.exactJunkDropped, 7, 'six exact-junk labels and the roadside line');
  });

  it('a line the model policy keeps is never touched by the junk strip, even if a junk pattern matches its text', () => {
    const lines = [{ name: 'XLT Black Appearance Package', code: 'X1', price: 920 }, { name: 'Roadside Assistance' }];
    assert.deepEqual(names(cleanOptionsForWrite(ALLOW, F150, lines).optionsJson), ['XLT Black Appearance Package']);
    const r = cleanOptionsForWrite(ALLOW, F150, [{ name: 'Title', price: 250, code: 'T1' }, ...lines]);
    assert.deepEqual(names(r.optionsJson), ['Title', 'XLT Black Appearance Package'], 'a priced line is never exact junk');
  });

  it('jsonMode full: a trusted covered car stores the policy result (paid package kept with its price, the rest gone)', () => {
    const r = cleanOptionsForWrite(ALLOW, F150, LINES(), { jsonMode: 'full' });
    assert.equal(r.trusted, true);
    assert.deepEqual(r.optionsJson, [{ code: 'X1', name: 'XLT Black Appearance Package', price: 920, kind: 'package' }]);
  });

  it('policy-covered car with a blank trim: only the exact-junk lines go; every other line (even standard equipment) is left exactly as sent', () => {
    for (const trim of ['', '   ', null]) {
      const r = cleanOptionsForWrite(ALLOW, { ...F150, trim }, LINES());
      assert.equal(r.trusted, false);
      assert.deepEqual(names(r.optionsJson), ['XLT Black Appearance Package', 'Roadside Assistance', 'Cruise Control']);
      assert.equal(r.exactJunkDropped, 6);
    }
  });

  it('policy-covered car with an untrusted trim: same, only exact junk goes', () => {
    const r = cleanOptionsForWrite(ALLOW, { ...F150, trim: 'Totally Unknown Trim' }, LINES());
    assert.equal(r.trusted, false);
    assert.deepEqual(names(r.optionsJson), ['XLT Black Appearance Package', 'Roadside Assistance', 'Cruise Control']);
  });

  it('a car no policy covers: the junk list and the exact-junk labels go, other lines stay, a priced line stays', () => {
    const vw = { make: 'Volkswagen', model: 'Tiguan', year: 2026, trim: 'SE' };
    const r = cleanOptionsForWrite(ALLOW, vw, [...LINES(), { name: 'Title', price: 99 }]);
    assert.equal(r.covered, false);
    assert.deepEqual(names(r.optionsJson), ['XLT Black Appearance Package', 'Cruise Control', 'Title']);
    const blank = cleanOptionsForWrite(ALLOW, { ...vw, trim: '' }, LINES());
    assert.deepEqual(names(blank.optionsJson), ['XLT Black Appearance Package', 'Cruise Control']);
  });

  it('a payload with no option list is passed through untouched (null stays null, so the upsert keeps the stored value)', () => {
    assert.equal(cleanOptionsForWrite(ALLOW, F150, null).optionsJson, null);
    assert.equal(cleanOptionsForWrite(ALLOW, F150, undefined).optionsJson, undefined);
  });

  it('jsonMode junk is the default; an unknown value falls back to it; off stores the payload as sent', () => {
    const junk = cleanOptionsForWrite(ALLOW, F150, LINES(), { jsonMode: 'junk' });
    assert.deepEqual(names(junk.optionsJson), ['XLT Black Appearance Package', 'Cruise Control']);
    assert.deepEqual(cleanOptionsForWrite(ALLOW, F150, LINES(), { jsonMode: 'bogus' }).optionsJson, junk.optionsJson);
    const lines = LINES();
    assert.equal(cleanOptionsForWrite(ALLOW, F150, lines, { jsonMode: 'off' }).optionsJson, lines);
  });

  it('with no policies loaded every car takes the generic path', () => {
    const r = cleanOptionsForWrite(EMPTY_ALLOWLIST, F150, LINES());
    assert.equal(r.covered, false);
    assert.deepEqual(names(r.optionsJson), ['XLT Black Appearance Package', 'Cruise Control']);
  });
});

describe('stored rows', () => {
  before(() => installJunkRulesFromEnv({}, { warn() {} }));
  after(() => setJunkRules(null));

  it('staleExactJunkKeys lists only the exact-junk rows', () => {
    const stored = [{ key: 'option packages', label: 'OPTION PACKAGES' }, { key: 'exp', label: 'Exp' }, { key: '9 30 2026', label: '09/30/2026' }, { key: 'heated seats', label: 'Heated Seats' }, { key: 'xlt black appearance package', label: 'XLT Black Appearance Package' }];
    assert.deepEqual(staleExactJunkKeys(stored).map((r) => r.key), ['option packages', 'exp', '9 30 2026']);
    assert.deepEqual(staleExactJunkKeys(null), []);
  });

  it('a stored paid line of the car\'s own trim that tonight\'s payload no longer lists is kept; an unpaid or unknown stored line is not added', () => {
    const desired = [{ key: 'twin panel moonroof', label: 'Twin Panel Moonroof', code: null }];
    const stored = [
      { key: 'xlt black appearance package', label: 'XLT Black Appearance Package', code: 'X1' },
      { key: 'cruise control', label: 'Cruise Control', code: null },
      { key: 'made up thing', label: 'Made Up Thing', code: null },
    ];
    const out = keepPaidStoredRows(ALLOW, F150, desired, stored);
    assert.deepEqual(out.map((r) => r.key), ['twin panel moonroof', 'xlt black appearance package']);
    const have = [{ key: 'xlt black appearance package', label: 'XLT Black Appearance Package', code: 'X1' }];
    assert.equal(keepPaidStoredRows(ALLOW, F150, have, stored), have, 'already held: the same array back');
    assert.equal(keepPaidStoredRows(ALLOW, F150, desired, []), desired);
    assert.equal(keepPaidStoredRows(EMPTY_ALLOWLIST, F150, desired, stored), desired, 'no policy: nothing to keep');
  });
});

describe('loadSyncAllowlist', () => {
  it('with no env set loads every bundled policy (what the re-clean tool uses); loadAllowlistFromEnv still loads nothing', () => {
    const r = loadSyncAllowlist({});
    assert.equal(r.error, null);
    assert.ok(r.allowlist.models.size >= 250, `got ${r.allowlist.models.size} policy scopes`);
    assert.deepEqual(loadAllowlistFromEnv({}), { allowlist: EMPTY_ALLOWLIST, error: null });
    for (const make of ['Toyota', 'Ford', 'Chevrolet', 'Hyundai', 'Audi', 'Mazda']) assert.ok([...r.allowlist.models.values()].some((p) => p.make === make.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()), make);
  });

  it('OPTION_BUNDLED_POLICIES=off loads exactly what the env lists', () => {
    assert.equal(loadSyncAllowlist({ OPTION_BUNDLED_POLICIES: 'off' }).allowlist, EMPTY_ALLOWLIST);
  });

  it('a policy scope listed in OPTION_MODEL_POLICY_PATH wins over the bundled one', () => {
    const file = BUNDLED_MODEL_POLICY_PATHS.find((f) => f.endsWith('ford-2026.json'));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const scope = Object.keys(raw)[0];
    const tmp = `${process.env.TMPDIR || '/tmp'}/sync-clean-override-${process.pid}.json`;
    fs.writeFileSync(tmp, JSON.stringify({ [scope]: { ...raw[scope], models: ['Zzz Override'] } }));
    try {
      const r = loadSyncAllowlist({ OPTION_MODEL_POLICY_PATH: tmp });
      assert.equal(r.error, null);
      assert.ok([...r.allowlist.models.values()].some((p) => p.scope === scope));
    } finally { fs.rmSync(tmp, { force: true }); }
  });

  it('a bad env path is reported but the bundled policies still load', () => {
    const r = loadSyncAllowlist({ OPTION_MODEL_POLICY_PATH: '/nonexistent/x.json' });
    assert.match(r.error, /nonexistent/);
    assert.ok(r.allowlist.models.size >= 250);
  });
});
