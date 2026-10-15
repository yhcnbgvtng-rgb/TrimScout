// 2026-27 Audi option policy (32 models): the approved rules, same engine as the Toyota, Ford, GM, Cadillac, Honda, Kia and Hyundai policies.
// Source: docs/option-catalogs-2026-10-12/audi_lineup_options_by_trim.csv -> scripts/build-cadillac-honda-kia-option-policy.mjs -> src/optionPolicies/audi-2026-2027.json.
// Paul's rule: every paid factory line on the window sticker stays (paints, packages, options, wheels, paid interior colors / materials, the trailer hitch);
// accessories, dealer add-ons, $0 items and subscription-only items are dropped. Package-only wheels / interiors are kept but never add to the price.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle, policyFacetRows, resolvePolicyTrim } from '../src/factoryOptionAllowlist.js';
import { parseCsv } from '../../../scripts/lib/optionPolicyCommon.mjs';
import { normalizeOptionKey } from '../src/inventoryOptionRows.js';
import { looksLikeOptionSentence } from '../src/optionSentenceFilter.js';
import { ALIASES } from '../../../scripts/lib/optionPolicyAliases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const RAW = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionPolicies/audi-2026-2027.json'), 'utf8'));
const CSV = parseCsv(fs.readFileSync(path.join(repo, 'docs/option-catalogs-2026-10-12/audi_lineup_options_by_trim.csv'), 'utf8'));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const slug = normalizeOptionKey;
const price = (r) => Number(r.price_usd) || 0;
const paid = CSV.filter((r) => r.category !== 'Base' && price(r) > 0);
const nonAdditive = (r) => /not additive/i.test(r.notes);
const run = (vehicle, names) => optionRowsForVehicle(ALLOW, { make: 'Audi', ...vehicle }, names.map((name) => ({ name })));
const entries = Object.entries(RAW).flatMap(([scope, p]) => Object.entries(p.trims).flatMap(([tk, t]) => Object.entries(t.options).map(([k, o]) => ({ scope, tk, k, o, trim: t.label }))));

describe('what is covered: make + model + year + trim', () => {
  it('32 models, one policy per model and year, 58 trims, 733 entries (177 packages, 230 options, 0 powertrain, 326 paints)', () => {
    assert.equal(CSV.length, 791);
    assert.equal(Object.keys(RAW).length, 32);
    assert.equal(new Set(Object.values(RAW).map((p) => p.models[0])).size, 32);
    assert.equal(Object.values(RAW).reduce((n, p) => n + Object.keys(p.trims).length, 0), 58);
    assert.equal(entries.length, 733);
    const by = (k) => entries.filter((e) => e.o.kind === k).length;
    assert.deepEqual(['package', 'option', 'powertrain', 'paint'].map(by), [177, 230, 0, 326]);
  });
  it('every policy scope is Audi + the CSV model + the CSV year', () => {
    const want = new Set(CSV.map((r) => `audi|${slug(r.model)}|${r.year}`));
    assert.deepEqual([...Object.keys(RAW)].sort(), [...want].sort());
  });
  it('A6 allroad and A7 Sportback are left out, as are other model years, models the CSV lacks and other makes', () => {
    for (const v of [
      { make: 'Audi', model: 'A6 allroad', year: 2027 }, { make: 'Audi', model: 'A7 Sportback', year: 2026 }, { make: 'Audi', model: 'A7 Sportback', year: 2027 },
      { make: 'Audi', model: 'Q5', year: 2025 }, { make: 'Audi', model: 'Q8 e-tron', year: 2026 }, { make: 'Audi', model: 'TT', year: 2026 },
      { make: 'Volkswagen', model: 'Atlas', year: 2026 }, { make: 'Genesis', model: 'GV70', year: 2026 },
    ]) {
      assert.deepEqual(modelPoliciesFor(ALLOW, v), [], JSON.stringify(v));
      const same = [{ name: 'Glacier White metallic' }];
      assert.equal(optionRowsForVehicle(ALLOW, { ...v, trim: 'Premium' }, same), null);
      assert.equal(policyFacetRows(ALLOW, { ...v, trim: 'Premium' }, same), null);
    }
  });
  it('the other makes stay covered', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Hyundai', model: 'Tucson', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Kia', model: 'Sorento', year: 2027 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'RAV4', year: 2026 }).length, 1);
  });
  it('the policy file is bundled and listed in the write-path doc and install script', () => {
    assert.ok(fs.readFileSync(path.join(repo, 'scripts/box/2026-10-11-option-policy-write-path.sh'), 'utf8').includes('audi-2026-2027'));
    assert.ok(fs.readFileSync(path.join(repo, 'docs/OPTION_POLICY_WRITE_PATH.md'), 'utf8').includes('audi-2026-2027.json'));
  });
});

describe('the CSV is the contract: every paid factory line is in, nothing else is', () => {
  it('every paid CSV row is in its trim\'s policy (make + model + year + trim) at the CSV price (package-only rows: price 0, CSV price as packagePrice)', () => {
    assert.equal(paid.length, 733);
    for (const r of paid) {
      const t = RAW[`audi|${slug(r.model)}|${r.year}`]?.trims[slug(r.trim)];
      assert.ok(t, `${r.year} ${r.model} ${r.trim}: trim missing`);
      const o = t.options[slug(r.item)];
      assert.ok(o, `${r.year} ${r.model} ${r.trim}: ${r.item} missing`);
      if (nonAdditive(r)) { assert.equal(o.price, 0, r.item); assert.equal(o.additive, false, r.item); assert.equal(o.packagePrice, price(r), r.item); }
      else { assert.equal(o.price, price(r), `${r.year} ${r.model} ${r.trim}: ${r.item}`); assert.equal(o.additive, undefined); }
    }
  });
  it('every paid CSV row also survives the real matcher: the sticker line "<item>" on that exact vehicle comes back (package-only rows at $0)', () => {
    // The global option-sentence filter (inventoryOptionRows / optionSentenceFilter, >= 75 chars or 2 sentence words) runs before any policy and is not changed here:
    // 56 long CSV names ("... (contained in Executive package), Black-Black-Steel Gray") can never come back through a feed line of that exact text.
    const longNames = paid.filter((r) => looksLikeOptionSentence(r.item));
    assert.equal(longNames.length, 56);
    for (const r of longNames) assert.equal(run({ model: r.model, year: Number(r.year), trim: r.trim }, [r.item]).rows.length, 0, r.item);
    for (const r of paid.filter((x) => !looksLikeOptionSentence(x.item))) {
      const res = run({ model: r.model, year: Number(r.year), trim: r.trim }, [r.item]);
      assert.equal(res.rows.length, 1, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
      assert.equal(res.rows[0].price, nonAdditive(r) ? 0 : price(r), `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('nothing is in the policy that is not a paid CSV row: no Base price, no $0 row, no accessory, no subscription', () => {
    const want = new Set(paid.map((r) => `audi|${slug(r.model)}|${r.year}|${slug(r.trim)}|${slug(r.item)}`));
    const have = entries.map((e) => `${e.scope}|${e.tk}|${e.k}`);
    assert.equal(have.length, want.size);
    assert.deepEqual(have.filter((x) => !want.has(x)), []);
    for (const { o, trim } of entries) {
      assert.ok(o.price > 0 || o.additive === false, `${trim} ${o.label}`);
      assert.notEqual(o.label, 'Base Price (trim MSRP)');
      assert.doesNotMatch(o.label, /accessor|subscription|floor mat|cargo (net|liner|mat)|splash|\bplan\b/i, o.label);
    }
  });
  it('no Base CSV row becomes an option on its trim', () => {
    for (const r of CSV.filter((x) => x.category === 'Base')) {
      const o = RAW[`audi|${slug(r.model)}|${r.year}`].trims[slug(r.trim)].options;
      assert.equal(o[slug(r.item)], undefined, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
    }
  });
  it('accessories, dealer add-ons, subscriptions and standard equipment from a feed never become options', () => {
    const junk = ['Carpeted Floor Mats', 'All-Weather Floor Mats', 'Cargo Net', 'Splash Guards', 'Audi connect Subscription', 'SiriusXM Subscription', 'Ceramic Coating', 'Nitrogen Tires', 'Wheel Locks', 'Roof Rack Cross Bars', 'Panoramic Sunroof', 'Heated Seats', 'Leather Seats'];
    for (const [v, t] of [[{ model: 'Q9', year: 2027 }, 'Prestige TFSI quattro tiptronic'], [{ model: 'A6 Sedan', year: 2027 }, 'Premium TFSI quattro S tronic'], [{ model: 'SQ5', year: 2027 }, 'x']]) {
      const trim = Object.values((RAW[`audi|${slug(v.model)}|${v.year}`] || RAW[`audi|${slug(v.model)}|2027`]).trims)[0].label;
      assert.deepEqual(run({ ...v, trim }, junk).rows, [], `${v.model} ${trim}`);
    }
  });
  it('the generated JSON and reports are current', () => {
    execFileSync('node', [path.join(repo, 'scripts/build-cadillac-honda-kia-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('Audi specifics', () => {
  it('82 package-only wheels and interiors are kept but never add to a price', () => {
    const na = entries.filter((e) => e.o.additive === false);
    assert.equal(na.length, 82);
    for (const e of na) { assert.equal(e.o.price, 0, e.o.label); assert.ok(e.o.packagePrice > 0, e.o.label) }
    const q9 = run({ model: 'Q9', year: 2027, trim: 'Prestige TFSI quattro tiptronic' }, ['22" 5-Y-spoke bicolor (contained in Black optic package)', 'Black optic package']);
    const sum = q9.rows.reduce((n, r) => n + r.price, 0);
    assert.equal(q9.rows.length, 2);
    assert.ok(q9.rows.some((r) => r.price === 0));
    assert.equal(sum, q9.rows.find((r) => r.price > 0)?.price ?? 0);
  });
  it('the trailer hitch stays a paid option ($850 on Q9) and does not become a dealer add-on', () => {
    const r = run({ model: 'Q9', year: 2027, trim: 'Premium Plus TFSI quattro tiptronic' }, ['Trailer hitch']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]), [['option', 850]]);
    assert.deepEqual(r.dealerAddons, []);
  });
  it('S8 paints stay at $7,900', () => {
    const r = run({ model: 'S8 Sedan', year: 2027, trim: 'TFSI quattro tiptronic' }, ['Nardo Gray', 'Kumulusblau Uni']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price]), [['paint', 7900], ['paint', 7900]]);
  });
  it('the 8 packages with missing contents (A6 Sedan, RS 6 Avant, RS 7) stay as packages at their price', () => {
    const partial = CSV.filter((r) => /PARTIAL/.test(r.notes) && r.category !== 'Base');
    assert.equal(partial.length, 8);
    for (const r of partial) {
      const o = RAW[`audi|${slug(r.model)}|${r.year}`].trims[slug(r.trim)].options[slug(r.item)];
      assert.equal(o.kind, 'package'); assert.equal(o.price, price(r));
    }
    assert.match(fs.readFileSync(path.join(repo, 'docs/option-catalogs-2026-10-12/POLICY_REPORT_audi.md'), 'utf8'), /Packages with missing contents \(PARTIAL\) \(8\)/);
  });
  it('no trusted trim -> no options (trim missing or not in the CSV)', () => {
    assert.deepEqual(run({ model: 'Q9', year: 2027, trim: 'Nope' }, ['Trailer hitch']).rows, []);
    assert.deepEqual(run({ model: 'Q9', year: 2027, trim: null }, ['Trailer hitch']).rows, []);
  });
  it('a blank trim on the sync payload leaves stored rows alone, a trim the policy does not trust also leaves them alone (skip, never wipe)', () => {
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Audi', model: 'Q9', year: 2027, trim: '' }, [{ name: 'Trailer hitch' }]), { skip: true });
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Audi', model: 'Q9', year: 2027, trim: 'Nope' }, [{ name: 'Trailer hitch' }]), { skip: true });
  });
});

describe('approved exact trim aliases (scripts/lib/optionPolicyAliases.mjs, audi)', () => {
  const trimOf = (model, year, trim) => { const p = modelPoliciesFor(ALLOW, { make: 'Audi', model, year })[0]; return p ? resolvePolicyTrim(p, trim, model)?.trim?.label ?? null : null; };
  const trusted = (model, year, trim) => run({ model, year, trim }, ['Glacier White metallic'])?.trimTrusted === true;
  // [model, year, feed trim string, policy trim label]: every string is a real one from the 2026-10-15 box2 dry run
  const MAPPED = [
    ['Q7', 2027, 'Premium Plus TFSI® quattro®', 'Premium Plus TFSI quattro tiptronic'],
    ['Q7', 2027, 'Premiumplustfsiquattrotiptronic', 'Premium Plus TFSI quattro tiptronic'],
    ['Q8', 2027, 'Premium Plus 55 TFSI®', 'Premium Plus 55 TFSI quattro tiptronic'],
    ['Q8', 2027, 'Prestige 55 TFSI® quattro®', 'Prestige 55 TFSI quattro tiptronic'],
    ['Q8', 2027, 'Premium 55 TFSI® quattro®', 'Premium 55 TFSI quattro tiptronic'],
    ['Q8', 2027, 'Prestige', 'Prestige 55 TFSI quattro tiptronic'],
    ['Q9', 2027, 'Premium Plus TFSI® quattro®', 'Premium Plus TFSI quattro tiptronic'],
    ['SQ8', 2027, 'Premium Plus TFSI® quattro®', 'Premium Plus TFSI quattro tiptronic'],
    ['A6 Sedan', 2027, 'Premium TFSI® quattro® S', 'Premium TFSI quattro S tronic'],
    ['Q3', 2027, 'SUV TFSI® quattro® S', 'TFSI quattro S tronic'],
    ['S3', 2027, 'Sedan TFSI® quattro® S', 'TFSI quattro S tronic'],
    ['A3', 2027, 'Sedan 40 TFSI® quattro®', '40 TFSI quattro S tronic (A3 Sedan)'],
    ['A3', 2027, 'Sedan TFSI® quattro® Black', 'TFSI quattro Black optic plus S tronic (A3 Sedan)'],
    ['Q6 e-tron', 2027, 'Premium Plus quattro® Audi', 'Premium Plus quattro'],
    ['Q6 e-tron', 2027, 'Premium Plus', 'Premium Plus quattro'],
    ['Q6 Sportback e-tron', 2027, 'Prestige', 'Prestige quattro'],
    ['SQ6 e-tron', 2027, 'Prestige', 'Prestige quattro'],
    ['S e-tron GT', 2026, 'Premium Plus', 'Premium Plus quattro'],
    ['RS 6 Avant', 2026, '4.0T performance', 'RS 6 Avant performance'],
    ['RS Q8', 2027, 'Performance', 'quattro tiptronic (RS Q8 performance)'],
  ];
  for (const [model, year, trim, want] of MAPPED) it(`${year} ${model} "${trim}" = ${want}`, () => assert.equal(trimOf(model, year, trim), want));

  // [model, year, feed trim string]: stays unmapped (skipped, never stripped) because it is blank, ends in a dealer's name, names two trims, or is not a trim
  const UNMAPPED = [
    ['Q8', 2027, ''], ['Q6 e-tron', 2027, ''], ['Q6 e-tron', 2027, 'Prestige quattro® Audi San'], ['Q6 e-tron', 2027, 'Premium Plus quattro® Rusnak/Westlake'],
    ['Q6 e-tron', 2027, 'Q6 e-tron Audi Chantilly'], ['SQ7', 2027, 'TFSI® tiptronic® Audi Chantilly'], ['SQ9', 2027, 'TFSI® tiptronic® Audi of'],
    ['A3', 2027, 'Sedan TFSI® quattro® S'], ['Q5', 2027, 'Q5 quat. 2.0 R4200/D14A7'],
    ['A6 Sportback e-tron', 2027, 'Premium Plus'], // RWD or quattro: two trims at that level
    ['Q4 e-tron', 2026, 'Premium'], // 45 RWD or 55 quattro
  ];
  for (const [model, year, trim] of UNMAPPED) it(`${year} ${model} "${trim}" stays untrusted`, () => assert.equal(trusted(model, year, trim), false));

  it('every Audi alias points at exactly one real trim of its own model + year, and no alias crosses model years', () => {
    let n = 0;
    for (const [scope, al] of Object.entries(ALIASES.audi)) {
      const [year, model] = scope.split('|');
      const key = Object.keys(RAW).find((k) => RAW[k].source.endsWith(`(${year} ${model})`));
      assert.ok(key, `${scope} has a policy`);
      for (const to of Object.values(al.trimAliases || {})) { n++; assert.ok(Object.values(RAW[key].trims).some((t) => t.label === to), `${scope}: ${to}`); }
    }
    assert.ok(n >= 40, `checked ${n} aliases`);
    assert.equal(trusted('Q8', 2026, 'Premium Plus'), false); // 2026 Q8 has no policy
    assert.equal(trusted('Q6 e-tron', 2026, 'Premium Plus'), false);
  });
  it('an aliased trim gets exactly the rows its policy trim gets', () => {
    const a = run({ model: 'Q8', year: 2027, trim: 'Premium Plus 55 TFSI®' }, ['Glacier White metallic']);
    const b = run({ model: 'Q8', year: 2027, trim: 'Premium Plus 55 TFSI quattro tiptronic' }, ['Glacier White metallic']);
    assert.deepEqual(a.rows, b.rows);
  });
});

describe('the Audi apply script (scripts/box/2026-10-15-audi-option-policy-apply.mjs)', () => {
  const read = (f) => fs.readFileSync(path.join(repo, 'scripts/box', f), 'utf8');
  const src = read('2026-10-15-audi-option-policy-apply.mjs');
  it('is Audi-only: Audi 2026-27 car and dealer queries, its own lock owners, no other make named', () => {
    assert.ok(src.includes("make = 'Audi' AND year IN (2026, 2027)") && src.includes("AND make = 'Audi'"));
    assert.ok(src.includes('audi-option-policy-apply') && src.includes('audi-option-policy-restore'));
    assert.doesNotMatch(src, /mazda|hyundai|subaru|nissan|bmw|mercedes|toyota|ford/i);
  });
  it('keeps the safety rails: untrusted trims are skipped (never a wipe), backup first, deadline, sync lock, restore', () => {
    assert.ok(src.includes('if (!res.trimTrusted) { t.skippedNoTrustedTrim++; continue; }'));
    assert.ok(src.indexOf('if (!res.trimTrusted)') < src.indexOf('const before = by.get'), 'the skip comes before anything is planned or backed up');
    assert.ok(src.includes('backup.jsonl') && src.includes('pastDeadline()') && src.includes('takeLock(') && src.includes('async function restore()'));
    assert.ok(src.includes('LOCK BUSY') && src.includes('stale'));
    assert.ok(src.includes('DB_READER_USER') && src.includes('const write = PHASE === "apply" || (PHASE === "restore" && args.go);'), 'plan uses the reader account; restore is dry without --go');
  });
  it('is the Mazda script with only the make and the lock owners changed (so the rails that ran on 2026-10-15 are the rails here)', () => {
    const mazda = read('2026-10-15-mazda-option-policy-apply.mjs').replace(/Mazda/g, 'Audi').replace(/mazda/g, 'audi');
    assert.equal(src, mazda);
  });
});
