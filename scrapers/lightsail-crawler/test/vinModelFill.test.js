// Filling a blank model from the VIN: a wrong model is worse than a blank one, so these pin down exactly when a
// row is filled and when it is skipped (and why).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIN_RE, checkDigitValid, vinPatternKey, makesMatch, urlNamesModel, parseVpicResult, planDecodeTargets,
  patternConsensus, buildSpellings, canonicalModel, decideRow, summarize,
  APPROVED_MODEL_ALIASES, VPIC_PATTERN_BLOCKLIST, buildAliasMap,
} from '../src/vinModelFill.js';

describe('checkDigitValid', () => {
  it('accepts valid VINs, including an X check digit', () => {
    assert.equal(checkDigitValid('1M8GDM9AXKP042788'), true); // the standard worked example (check digit X)
    assert.equal(checkDigitValid('11111111111111111'), true);
    assert.equal(checkDigitValid('2T36CRAV1TW092736'), true); // vPIC: "decoded clean"
    assert.equal(checkDigitValid('1C4PJXAG2VW566889'), true);
  });

  it('rejects a mistyped VIN, wrong length and forbidden letters', () => {
    assert.equal(checkDigitValid('2T36CRAV2TW092736'), false); // the clean VIN above with its check digit changed
    assert.equal(checkDigitValid('1M8GDM9AXKP042789'), false);
    assert.equal(checkDigitValid('1M8GDM9AXKP04278'), false);
    assert.equal(checkDigitValid('1M8GDM9AXKP04278O'), false);
  });

  it('judges the check digit by the arithmetic, not by vPIC\'s other complaints', () => {
    // vPIC reports "1,400" for these (letters in the serial where a passenger vehicle's last digits are numeric),
    // but their position-9 digit does calculate — worked by hand: 385 % 11 = 0 and 430 % 11 = 1.
    assert.equal(checkDigitValid('2T36CRAV0TW36F914'), true);
    assert.equal(checkDigitValid('2T36CRAV1TW39G895'), true);
  });
});

describe('VIN pattern', () => {
  it('is the manufacturer + descriptor (1-8) plus the model-year character, nothing from the serial', () => {
    assert.equal(vinPatternKey('JTEVA5BR7T5163114'), 'JTEVA5BRT');
    assert.equal(vinPatternKey('JTEVA5BR9T5161011'), 'JTEVA5BRT');
    assert.notEqual(vinPatternKey('JTEVA5BR7T5163114'), vinPatternKey('JTEVB5BR6T5059503'));
    assert.notEqual(vinPatternKey('JTEVA5BR7T5163114'), vinPatternKey('JTEVA5BR7V5163114'), 'a different model year is a different pattern');
  });

  it('VIN_RE is the 17-character VIN alphabet (no I, O, Q)', () => {
    assert.equal(VIN_RE.test('JTEVA5BR7T5163114'), true);
    for (const bad of ['', 'JTEVA5BR7T516311', 'JTEVA5BR7T51631145', 'JTEVA5BR7T516311I', 'jteva5br7t5163114']) assert.equal(VIN_RE.test(bad), false, bad);
  });
});

describe('makesMatch', () => {
  it('ignores case and punctuation, and needs a make on both sides', () => {
    assert.equal(makesMatch('Toyota', 'TOYOTA'), true);
    assert.equal(makesMatch('Mercedes-Benz', 'MERCEDES-BENZ'), true);
    assert.equal(makesMatch('Land Rover', 'LAND ROVER'), true);
    assert.equal(makesMatch('Ram', 'RAM'), true);
    assert.equal(makesMatch('Toyota', 'LEXUS'), false);
    assert.equal(makesMatch('Dodge', 'RAM'), false);
    assert.equal(makesMatch('', 'TOYOTA'), false);
    assert.equal(makesMatch(null, null), false);
  });
});

describe('urlNamesModel', () => {
  const url = 'https://www.toyotaofcoconutcreek.com/viewdetails/new/2t36crav0tw36f914/2026-toyota-rav4-sport-utility';
  it('finds the model in the listing slug', () => {
    assert.equal(urlNamesModel(url, '2T36CRAV0TW36F914', 'RAV4'), true);
    assert.equal(urlNamesModel('https://x.com/new-Jeep-Grand-Cherokee-4x4-1C4RJHAG', '1C4RJHAG5RC123456', 'Grand Cherokee'), true);
  });

  it('does not match on the VIN itself, a different model, a missing URL, or a too-short model name', () => {
    assert.equal(urlNamesModel('https://x.com/viewdetails/new/2t36crav0tw36f914/', '2T36CRAV0TW36F914', 'CRAV'), false, 'the serial must not corroborate');
    assert.equal(urlNamesModel(url, '2T36CRAV0TW36F914', 'Camry'), false);
    assert.equal(urlNamesModel(null, '2T36CRAV0TW36F914', 'RAV4'), false);
    assert.equal(urlNamesModel('https://x.com/lexus-es-350', 'JTHBZ1B1XL1234567', 'ES'), false);
  });
});

describe('parseVpicResult', () => {
  it('keeps make, model, year and the error codes; blanks become null', () => {
    assert.deepEqual(parseVpicResult({ VIN: '2T36CRAV0TW36F914', Make: 'TOYOTA', Model: 'RAV4', ModelYear: '2026', ErrorCode: '1,400', ErrorText: '1 - Check Digit' }),
      { vin: '2T36CRAV0TW36F914', make: 'TOYOTA', model: 'RAV4', modelYear: '2026', errorCodes: ['1', '400'], errorText: '1 - Check Digit' });
    const empty = parseVpicResult({ VIN: 'X', Make: '', Model: '  ', ErrorCode: '0' });
    assert.equal(empty.make, null);
    assert.equal(empty.model, null);
  });
});

describe('planDecodeTargets', () => {
  const row = (vin) => ({ vin, dealerId: 1, make: 'Toyota' });

  it('groups by pattern and samples at most three VINs per pattern, preferring ones with a valid check digit', () => {
    const rows = ['2T36CRAV0TW36F914', '2T36CRAV1TW092736', '2T36CRAV1TW39G895', '2T36CRAV2TW098951', '2T36CRAV3TW090356', '1C4PJXAG2VW566889'].map(row);
    const plan = planDecodeTargets(rows);
    assert.equal(plan.size, 2);
    const rav = plan.get('2T36CRAVT');
    assert.equal(rav.rows.length, 5);
    assert.ok(rav.sampleVins.length >= 1 && rav.sampleVins.length <= 3);
    assert.ok(rav.sampleVins.every((v) => checkDigitValid(v)), 'valid-check-digit VINs are sampled when the pattern has any');
    assert.deepEqual(plan.get('1C4PJXAGV').sampleVins, ['1C4PJXAG2VW566889']);
  });

  it('falls back to whatever it has when no VIN in the pattern has a valid check digit; skips non-VINs', () => {
    const plan = planDecodeTargets([row('2T36CRAV0TW36F914'), row('2T36CRAV1TW39G895'), row('SHORT')]);
    assert.equal(plan.size, 1);
    assert.ok(plan.get('2T36CRAVT').sampleVins.length >= 1);
  });
});

describe('patternConsensus', () => {
  const d = (make, model) => ({ make, model });
  it('agrees when the samples agree, ignoring case', () => {
    assert.deepEqual(patternConsensus([d('TOYOTA', 'RAV4'), d('Toyota', 'Rav4')]), { status: 'ok', make: 'TOYOTA', model: 'RAV4' });
  });
  it('is "no model" when vPIC returned nothing usable — it never invents one', () => {
    assert.deepEqual(patternConsensus([d('TOYOTA', null), d(null, null)]), { status: 'no-model' });
    assert.deepEqual(patternConsensus([]), { status: 'no-model' });
  });
  it('is inconsistent when samples disagree on the model or the make', () => {
    assert.equal(patternConsensus([d('FORD', 'F-150'), d('FORD', 'F-250')]).status, 'inconsistent');
    assert.equal(patternConsensus([d('RAM', '1500'), d('DODGE', '1500')]).status, 'inconsistent');
  });
  it('one failed sample does not veto the others', () => {
    assert.equal(patternConsensus([d('TOYOTA', 'RAV4'), d('TOYOTA', null)]).status, 'ok');
  });
});

describe('spellings already in the database', () => {
  const spellings = buildSpellings([
    { make: 'Toyota', model: 'RAV4', n: 900 }, { make: 'Toyota', model: 'Rav4', n: 3 }, { make: 'Toyota', model: 'Grand Highlander', n: 50 },
    { make: 'Jeep', model: 'Grand Cherokee', n: 400 }, { make: 'Ford', model: 'F-150', n: 700 }, { make: null, model: 'X', n: 1 },
  ]);
  it('reuses the most common existing spelling', () => {
    assert.deepEqual(canonicalModel(spellings, 'Toyota', 'Rav4'), { model: 'RAV4', seenInDb: true, aliased: false });
    assert.deepEqual(canonicalModel(spellings, 'Ford', 'F150'), { model: 'F-150', seenInDb: true, aliased: false });
    assert.deepEqual(canonicalModel(spellings, 'Jeep', 'GRAND CHEROKEE'), { model: 'Grand Cherokee', seenInDb: true, aliased: false });
  });
  it('keeps vPIC\'s spelling, flagged as new, when the database has never seen the model for that make', () => {
    assert.deepEqual(canonicalModel(spellings, 'Toyota', 'Crown Signia'), { model: 'Crown Signia', seenInDb: false, aliased: false });
    assert.deepEqual(canonicalModel(spellings, 'Lexus', 'RAV4'), { model: 'RAV4', seenInDb: false, aliased: false }, 'spellings are per make');
  });
});

describe('approved aliases', () => {
  const spellings = buildSpellings([{ make: 'Audi', model: 'Q6 e-tron', n: 38 }, { make: 'Mercedes-Benz', model: 'GLE', n: 2542 }, { make: 'Nissan', model: 'Ariya', n: 459 }]);
  it('are exactly the names that were approved, one rule per make + vPIC spelling', () => {
    assert.deepEqual(APPROVED_MODEL_ALIASES.map(([make, vpic, name]) => `${make} | ${vpic} -> ${name}`).sort(), [
      'Audi | Q4 -> Q4 e-tron', 'Audi | Q6 -> Q6 e-tron', 'Audi | SQ6 -> SQ6 e-tron',
      'Mercedes-Benz | GLB-Class -> GLB', 'Mercedes-Benz | GLE-Class -> GLE',
      'Nissan | Ariya Hatchback -> Ariya', 'Nissan | Ariya MPV -> Ariya',
      'Toyota | Prius Prime (PHEV) -> Prius Prime',
      'Volvo | EX30 CC -> EX30 Cross Country', 'Volvo | V60CC -> V60 Cross Country', 'Volvo | V90CC -> V90 Cross Country',
    ]);
    assert.equal(buildAliasMap().size, APPROVED_MODEL_ALIASES.length, 'no two rules share a key');
    assert.equal(APPROVED_MODEL_ALIASES.some(([make, vpic]) => /SQ9/i.test(vpic) && make === 'Audi'), false, 'SQ9 stays blank');
  });
  it('are written exactly as approved, and say whether the database already uses that name', () => {
    assert.deepEqual(canonicalModel(spellings, 'Audi', 'Q6'), { model: 'Q6 e-tron', seenInDb: true, aliased: true });
    assert.deepEqual(canonicalModel(spellings, 'Mercedes-Benz', 'GLE-Class'), { model: 'GLE', seenInDb: true, aliased: true });
    assert.deepEqual(canonicalModel(spellings, 'Nissan', 'Ariya MPV'), { model: 'Ariya', seenInDb: true, aliased: true });
    assert.deepEqual(canonicalModel(spellings, 'Volvo', 'EX30 CC'), { model: 'EX30 Cross Country', seenInDb: false, aliased: true });
  });
  it('match case- and punctuation-insensitively, and only for that make', () => {
    assert.equal(canonicalModel(spellings, 'AUDI', 'q6').model, 'Q6 e-tron');
    assert.equal(canonicalModel(spellings, 'Toyota', 'Prius Prime (PHEV)').model, 'Prius Prime');
    assert.equal(canonicalModel(spellings, 'Lexus', 'Q6').aliased, false);
    assert.equal(canonicalModel(spellings, 'Audi', 'Q6', null).aliased, false, 'a caller can turn aliases off');
  });
});

describe('decideRow', () => {
  const spellings = buildSpellings([{ make: 'Toyota', model: 'RAV4', n: 10 }]);
  const ok = { status: 'ok', make: 'TOYOTA', model: 'RAV4' };
  const goodVin = '2T36CRAV1TW092736';
  const badVin = '2T36CRAV2TW092736'; // goodVin with its check digit changed
  const slug = (vin) => `https://www.toyotaofcoconutcreek.com/viewdetails/new/${vin.toLowerCase()}/2026-toyota-rav4-sport-utility`;

  it('tier A: a clean VIN whose make matches is filled, using the database\'s own spelling', () => {
    assert.deepEqual(decideRow({ vin: goodVin, dealerId: 1, make: 'Toyota', vdpUrl: null }, { status: 'ok', make: 'TOYOTA', model: 'Rav4' }, spellings),
      { action: 'fill', model: 'RAV4', tier: 'A', seenInDb: true, aliased: false });
  });

  it('tier B: a VIN with a failing check digit is filled only when the listing URL names the model', () => {
    assert.equal(checkDigitValid(badVin), false);
    assert.deepEqual(decideRow({ vin: badVin, dealerId: 1, make: 'Toyota', vdpUrl: slug(badVin) }, ok, spellings), { action: 'fill', model: 'RAV4', tier: 'B', seenInDb: true, aliased: false });
    assert.deepEqual(decideRow({ vin: badVin, dealerId: 1, make: 'Toyota', vdpUrl: 'https://x.com/viewdetails/new/' + badVin }, ok, spellings),
      { action: 'skip', reason: 'VIN check digit fails and the listing URL does not name the model' });
  });

  it('skips, with a reason, everything it should not guess at', () => {
    const r = (over, verdict = ok) => decideRow({ vin: goodVin, dealerId: 1, make: 'Toyota', vdpUrl: null, ...over }, verdict, spellings);
    assert.equal(r({ vin: 'SHORT' }).reason, 'not a 17-character VIN');
    assert.match(r({ make: null }).reason, /no make/);
    assert.match(r({}, null).reason, /lookup failed/);
    assert.match(r({}, { status: 'inconsistent' }).reason, /different models/);
    assert.equal(r({}, { status: 'no-model' }).reason, 'vPIC returned no model');
    assert.equal(r({ make: 'Lexus' }).reason, 'make mismatch (row "Lexus" vs vPIC "TOYOTA")');
  });

  it('never fills when the decoded make does not match, even for a clean VIN', () => {
    assert.equal(decideRow({ vin: goodVin, dealerId: 1, make: 'Ram', vdpUrl: null }, { status: 'ok', make: 'DODGE', model: 'Durango' }, spellings).action, 'skip');
  });
});

describe('decideRow: names the database does not use yet, approved aliases, known vPIC errors', () => {
  const spellings = buildSpellings([{ make: 'Audi', model: 'Q6 e-tron', n: 38 }, { make: 'Audi', model: 'SQ5', n: 500 }, { make: 'Lexus', model: 'GX', n: 200 }]);
  const audiQ6 = { vin: 'WA1ACBF76TD018375', dealerId: 7, make: 'Audi', vdpUrl: null }; // a real VIN with a valid check digit
  const decoded = (make, model) => ({ status: 'ok', make, model });

  it('writes an approved alias under the approved name', () => {
    assert.equal(checkDigitValid(audiQ6.vin), true);
    assert.deepEqual(decideRow(audiQ6, decoded('AUDI', 'Q6'), spellings), { action: 'fill', model: 'Q6 e-tron', tier: 'A', seenInDb: true, aliased: true });
  });

  it('holds a vPIC spelling the database has never used for the make (and no alias covers), saying which', () => {
    const d = decideRow(audiQ6, decoded('AUDI', 'SQ9'), spellings);
    assert.equal(d.action, 'skip');
    assert.match(d.reason, /differently from the database/);
    assert.equal(d.detail, 'Audi → SQ9');
  });

  it('writes such a spelling only when explicitly allowed', () => {
    assert.deepEqual(decideRow(audiQ6, decoded('AUDI', 'SQ9'), spellings, { allowNewSpellings: true }), { action: 'fill', model: 'SQ9', tier: 'A', seenInDb: false, aliased: false });
  });

  it('never fills a VIN pattern vPIC is known to decode wrongly, whatever vPIC says now', () => {
    const q5Sportback2026 = { vin: 'WA1EAAGU0T2003324', dealerId: 7, make: 'Audi', vdpUrl: null }; // vPIC: SQ5 — dealers: Q5 Sportback
    const lx570 = { vin: 'JTJHY7AX3K4308370', dealerId: 7, make: 'Lexus', vdpUrl: null }; // vPIC: GX — listing: LX 570
    for (const [row, model] of [[q5Sportback2026, 'SQ5'], [lx570, 'GX']]) {
      const d = decideRow(row, decoded(row.make.toUpperCase(), model), spellings);
      assert.equal(d.action, 'skip', row.vin);
      assert.equal(d.reason, 'vPIC is known to decode this VIN pattern wrongly');
      assert.ok(d.detail.length > 10);
    }
    assert.notEqual(decideRow({ ...q5Sportback2026, vin: 'WA1EAAGU0V2003324' }, decoded('AUDI', 'SQ5'), spellings).reason, 'vPIC is known to decode this VIN pattern wrongly', 'the model year is part of the pattern: only the 2026 (T) pattern is blocked');
    for (const key of VPIC_PATTERN_BLOCKLIST.keys()) assert.match(key, /^[A-HJ-NPR-Z0-9]{9}$/, 'keys are pattern keys: VIN positions 1-8 plus the model-year character');
  });
});

describe('summarize', () => {
  it('counts blank rows, fills by tier and skips by reason, per make', () => {
    const rows = [{ make: 'Toyota' }, { make: 'Toyota' }, { make: 'Toyota' }, { make: 'Ford' }, { make: null }];
    const decisions = [
      { action: 'fill', tier: 'A' }, { action: 'fill', tier: 'B' }, { action: 'skip', reason: 'make mismatch (row "Toyota" vs vPIC "LEXUS")' },
      { action: 'skip', reason: 'vPIC returned no model' }, { action: 'skip', reason: 'row has no make, so the decoded make cannot be checked' },
    ];
    const s = summarize(rows, decisions);
    assert.deepEqual(s.totals, { blank: 5, fills: 2, skipped: 3 });
    assert.deepEqual(s.byMake.find((m) => m.make === 'Toyota'), { make: 'Toyota', blank: 3, fillA: 1, fillB: 1, skipped: 1 });
    assert.equal(s.reasons.length, 3);
  });
});
