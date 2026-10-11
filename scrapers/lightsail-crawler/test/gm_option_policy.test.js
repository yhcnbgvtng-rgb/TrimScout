// 2026-27 GM option policies (Chevrolet 18 models, GMC 13, Buick 4): the approved rules, same engine as the Toyota and Ford policies.
// Source: docs/gm-2026-2027/<brand>_lineup_options_by_trim.csv -> scripts/build-gm-option-policy.mjs -> src/optionPolicies/<brand>-2026-2027.json (+ POLICY_REPORT_<brand>.md).
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
const BRANDS = ['chevrolet', 'gmc', 'buick'];
const RAW = Object.fromEntries(BRANDS.map((b) => [b, JSON.parse(fs.readFileSync(path.join(repo, `scrapers/lightsail-crawler/src/optionPolicies/${b}-2026-2027.json`), 'utf8'))]));
const CSV = Object.fromEntries(BRANDS.map((b) => [b, parseCsv(fs.readFileSync(path.join(repo, `docs/gm-2026-2027/${b}_lineup_options_by_trim.csv`), 'utf8'))]));
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const MAKE = { chevrolet: 'Chevrolet', gmc: 'GMC', buick: 'Buick' };
const run = (make, vehicle, names, extra = {}) => optionRowsForVehicle(ALLOW, { make, year: 2026, ...vehicle }, names.map((name) => ({ name, ...extra })));
const labels = (r) => r.rows.map((x) => x.label).sort();
const by = (r, label) => r.rows.find((x) => x.label === label);
const slug = normalizeOptionKey;

describe('what is covered: model + year + trim, per brand', () => {
  it('Chevrolet has 18 models, GMC 13 and Buick 4, one policy per model and year', () => {
    const models = (b) => new Set(Object.values(RAW[b]).map((p) => p.models[0])).size;
    assert.deepEqual([models('chevrolet'), models('gmc'), models('buick')], [18, 13, 4]);
    assert.deepEqual(BRANDS.map((b) => Object.keys(RAW[b]).length), [18, 13, 4]);
  });
  it('policy sizes (entries per brand) match the generated report', () => {
    const size = (b) => Object.values(RAW[b]).reduce((n, p) => n + Object.values(p.trims).reduce((m, t) => m + Object.keys(t.options).length, 0), 0);
    assert.deepEqual(BRANDS.map(size), [1236, 925, 99]);
  });
  it('another model year, another model and another make are untouched (no policy)', () => {
    for (const v of [
      { make: 'Chevrolet', model: 'Trax', year: 2025 }, { make: 'Chevrolet', model: 'Trax', year: 2027 }, { make: 'Chevrolet', model: 'Malibu', year: 2026 },
      { make: 'GMC', model: 'Sierra 1500', year: 2026 }, { make: 'Buick', model: 'Envista', year: 2027 }, { make: 'Buick', model: 'Cascada', year: 2026 },
      { make: 'Honda', model: 'Civic', year: 2026 }, { make: 'Cadillac', model: 'Escalade', year: 2026 },
    ]) {
      assert.deepEqual(modelPoliciesFor(ALLOW, v), [], JSON.stringify(v));
      assert.equal(optionRowsForVehicle(ALLOW, { ...v, trim: 'LT' }, [{ name: 'Sunroof Package' }]), null);
      assert.equal(policyFacetRows(ALLOW, { ...v, trim: 'LT' }, [{ name: 'Sunroof Package' }]), null);
      const same = [{ name: 'Sunroof Package' }];
      assert.equal(policyApiOptions(ALLOW, { ...v, trim: 'LT' }, same), same);
    }
  });
  it('Ford and Toyota stay covered', () => {
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Ford', model: 'Ranger', year: 2026 }).length, 1);
    assert.equal(modelPoliciesFor(ALLOW, { make: 'Toyota', model: 'RAV4', year: 2026 }).length, 1);
  });
});

describe('rule 1: only paid packages, standalone options, paints and powertrain upgrades, priced per trim', () => {
  it('Trax LT: a paid package (keyed on its RPO), a paint, a standalone option', () => {
    const r = run('Chevrolet', { model: 'Trax', trim: 'LT' }, ['LT Convenience Package', 'Marina Blue Metallic', 'Keyless Entry Keypad']);
    assert.deepEqual(r.rows.map((x) => [x.kind, x.price, x.key]).sort(), [['option', 320, 'keyless entry keypad'], ['package', 595, '6k5'], ['paint', 395, 'marina blue metallic']].sort());
  });
  it('a powertrain upgrade is kept at its price (Silverado 1500 ZR2 6.6L V8)', () => {
    assert.deepEqual(run('Chevrolet', { model: 'Silverado 1500', year: 2027, trim: 'ZR2' }, ['6.6L V8 gas']).rows.map((x) => [x.kind, x.price]), [['powertrain', 2505]]);
  });
  it('the same name is priced by the trim (Trax Sunroof Package: 1RS $795, LT $895)', () => {
    assert.equal(run('Chevrolet', { model: 'Trax', trim: '1RS' }, ['Sunroof Package']).rows[0].price, 795);
    assert.equal(run('Chevrolet', { model: 'Trax', trim: 'LT' }, ['Sunroof Package']).rows[0].price, 895);
  });
  it('Buick: Envista Convenience I is $995 on Preferred and $895 on Sport Touring; the 2027 Enclave AWD upgrade is a powertrain option', () => {
    assert.equal(run('Buick', { model: 'Envista', trim: 'Preferred' }, ['Convenience I Package']).rows[0].price, 995);
    assert.equal(run('Buick', { model: 'Envista', trim: 'Sport Touring' }, ['Convenience I Package']).rows[0].price, 895);
    assert.deepEqual(run('Buick', { model: 'Enclave', year: 2027, trim: 'Preferred' }, ['Super Cruise Package', 'AWD']).rows.map((x) => [x.kind, x.price]).sort(), [['package', 3670], ['powertrain', 2000]].sort());
  });
  it('GMC: Canyon AT4X Black Badging Package, 2027 Sierra 1500 AT4 Premium Package', () => {
    assert.deepEqual(run('GMC', { model: 'Canyon', trim: 'AT4X' }, ['Black Badging Package']).rows.map((x) => x.price), [595]);
    assert.deepEqual(run('GMC', { model: 'Sierra 1500', year: 2027, trim: 'AT4' }, ['AT4 Premium Package']).rows.map((x) => x.price), [3400]);
  });
  it('every CSV row that the rules keep is in its policy at that trim (and nothing else is), for all three brands', () => {
    for (const b of BRANDS) {
      const expected = new Map();
      for (const r of CSV[b]) {
        const price = Number(r.price_usd) || 0;
        if (r.category === 'Base' || !(price > 0)) continue;
        if (!['Factory package', 'Factory option', 'Exterior color', 'Powertrain'].includes(r.category)) continue;
        if (r.model === 'Corvette') {
          const grp = r.category === 'Factory package' || r.category === 'Exterior color' || (r.category === 'Factory option' && ['Wheels', 'Performance'].includes(r.subcategory));
          if (!grp || (r.subcategory === 'Performance' && !(price > 1000))) continue;
        }
        const m = /(?:^|;\s*)key=([^;]+)/.exec(r.notes || '');
        const key = m && !m[1].trim().startsWith('name:') ? slug(m[1].trim()) : slug(r.item.replace(/®|™/g, '').replace(/\s+/g, ' ').trim());
        expected.set(`${b}|${slug(r.model)}|${r.year}|${slug(r.trim)}|${key}`, r);
      }
      const actual = new Set();
      for (const [scope, p] of Object.entries(RAW[b])) for (const [tk, t] of Object.entries(p.trims)) for (const k of Object.keys(t.options)) actual.add(`${scope}|${tk}|${k}`);
      assert.deepEqual([...actual].filter((x) => !expected.has(x)), [], `${b}: policy entries the rules do not keep`);
      assert.deepEqual([...expected.keys()].filter((x) => !actual.has(x)), [], `${b}: kept CSV rows missing from the policy`);
    }
  });
});

describe('keys: GM RPO codes, or the full name when there is no code', () => {
  it('a coded option is keyed on its RPO and found by name, by RPO, or by the feed\'s own order code', () => {
    for (const probe of [[['LT Convenience Package'], {}], [['RPO 6K5'], {}], [['6K5'], {}], [['Some Dealer Name'], { code: '6K5' }]]) {
      const r = run('Chevrolet', { model: 'Trax', trim: 'LT' }, probe[0], probe[1]);
      assert.deepEqual(r.rows.map((x) => x.key), ['6k5'], JSON.stringify(probe));
      assert.equal(r.rows[0].price, 595);
    }
  });
  it('a feed-internal code ("PKG-73") is not an RPO and never matches', () => {
    assert.deepEqual(run('Chevrolet', { model: 'Trax', trim: 'LT' }, ['Mystery Package'], { code: 'PKG-73' }).rows, []);
  });
  it('an option with no code is keyed on its full name', () => {
    assert.deepEqual(run('Buick', { model: 'Envista', trim: 'Preferred' }, ['Advanced Safety Package']).rows.map((x) => x.key), ['advanced safety package']);
  });
  it('every code-keyed entry is keyed on exactly its code', () => {
    let n = 0;
    for (const b of BRANDS) for (const p of Object.values(RAW[b])) for (const t of Object.values(p.trims)) for (const [k, o] of Object.entries(t.options)) if (o.code) { n++; assert.equal(k, o.code.toLowerCase(), `${t.label} ${o.label}`); }
    assert.equal(n, 61);
  });
});

describe('what is never an option', () => {
  it('standard, included and unknown equipment, accessories and subscriptions are dropped', () => {
    const r = run('Chevrolet', { model: 'Trax', trim: 'LT' }, ['Apple CarPlay', 'Cloth Seats', 'All-Weather Floor Liners', 'Bed Liner', 'OnStar Basics Plan', 'LT Convenience Package']);
    assert.deepEqual(labels(r), ['LT Convenience Package']);
  });
  it('a package is never expanded into its features: a feature listed once rolls up to its package, otherwise it is dropped', () => {
    const r = run('Buick', { model: 'Envista', trim: 'Preferred' }, ['Wireless Device Charging', 'Power liftgate']);
    assert.ok(r.rows.every((x) => x.kind === 'package'), JSON.stringify(r.rows));
  });
  it('a package one trim offers is not kept on a trim that lacks it', () => {
    const r = run('Chevrolet', { model: 'Trax', trim: '1RS' }, ['LT Convenience Package']);
    assert.deepEqual(r.rows, []);
    assert.ok(r.dropped.every((d) => d.rule === 'not-offered-on-trim'), JSON.stringify(r.dropped));
  });
  it('rules are data under an option, never options', () => {
    let rules = 0;
    for (const b of BRANDS) for (const p of Object.values(RAW[b])) for (const t of Object.values(p.trims)) for (const o of Object.values(t.options)) {
      assert.doesNotMatch(o.label, /^(?:requires?|not available|only with|deletes?)\b/i, o.label);
      assert.ok(o.price > 0, `${t.label} ${o.label}`);
      for (const rule of o.rules || []) { rules++; assert.ok(['requires', 'notAvailableWith', 'onlyWith', 'deletes'].includes(rule.type)); assert.ok(Array.isArray(rule.refs)); }
    }
    assert.equal(rules, 33 + 6 + 1);
  });
  it('a combo GM will not allow is stored as a rule: Colorado Trail Boss Stars and Steel requires Midnight Edition (or the Off Road Lighting Package)', () => {
    const o = Object.values(RAW.chevrolet['chevrolet|colorado|2026'].trims['trail boss'].options).find((x) => x.label === 'Stars and Steel Special Edition');
    assert.equal(o.price, 13455);
    assert.equal(o.rules[0].type, 'requires');
    assert.ok(o.rules[0].refs.includes('midnight edition'));
    const dark = Object.values(RAW.chevrolet['chevrolet|tahoe|2027'].trims['lt'].options).find((x) => x.label === 'Dark Essentials Package');
    assert.equal(dark.rules[0].type, 'notAvailableWith');
  });
});

describe('rule 6: no trusted trim -> no options', () => {
  it('an unlisted, blank or look-alike trim gets nothing', () => {
    assert.deepEqual(run('Chevrolet', { model: 'Trax', trim: 'Premier' }, ['LT Convenience Package']).rows, []);
    assert.deepEqual(run('Chevrolet', { model: 'Trax', trim: null }, ['LT Convenience Package']).rows, []);
    assert.deepEqual(run('GMC', { model: 'Canyon', trim: 'SLT' }, ['Black Badging Package']).rows, []);
    assert.deepEqual(run('Chevrolet', { model: 'Silverado EV', trim: 'LT' }, ['Sunroof Package']).rows, [], 'EV trims are listed with their range; plain LT is untrusted');
    assert.deepEqual(run('Buick', { model: 'Envista', trim: 'Preferred Essence' }, ['Convenience I Package']).rows, []);
  });
  it('a blank trim on the sync payload leaves the stored rows alone (skip), a bad trim yields zero rows', () => {
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Chevrolet', model: 'Trax', year: 2026, trim: '' }, [{ name: 'Sunroof Package' }]), { skip: true });
    assert.deepEqual(policyFacetRows(ALLOW, { make: 'Chevrolet', model: 'Trax', year: 2026, trim: 'Premier' }, [{ name: 'Sunroof Package' }]).rows, []);
  });
  it('drivetrain and body words around a trim are noise ("Z71 4WD Crew Cab" is Z71, "Trail Boss 4WD" is Trail Boss)', () => {
    assert.deepEqual(run('Chevrolet', { model: 'Colorado', trim: 'Trail Boss 4WD Crew Cab' }, ['Midnight Edition']).rows.map((x) => x.price), [4195]);
    assert.deepEqual(run('Chevrolet', { model: 'Colorado', trim: 'Z71 4WD' }, ['Midnight Edition']).rows.map((x) => x.price), [4245]);
    assert.equal(run('Chevrolet', { model: 'Colorado', trim: 'Trail Boss 4WD' }, ['Midnight Edition']).trimVia, 'exact');
  });
});

describe('factory editions are kept as packages (Paul): ZR2 Bison and AT4X AEV', () => {
  it('ZR2 Bison Edition is a paid package on the ZR2 (Silverado 1500 2027, Silverado 2500 HD 2026, Colorado 2026), priced per model', () => {
    for (const [model, year, price] of [['Silverado 1500', 2027, 8020], ['Silverado 2500 HD', 2026, 8875], ['Colorado', 2026, 11700]]) {
      const r = run('Chevrolet', { model, year, trim: 'ZR2' }, ['ZR2 Bison Edition']);
      assert.deepEqual(r.rows.map((x) => [x.label, x.kind, x.price]), [['ZR2 Bison Edition', 'package', price]], model);
    }
  });
  it('a Bison feed line is matched through its decoration and a content line rolls up to the package, not a second option', () => {
    const r = run('Chevrolet', { model: 'Colorado', trim: 'ZR2 4WD' }, ['ZR2 Bison Edition ($11,700)', 'Bed-Mounted Vertical Spare Tire Carrier']);
    assert.deepEqual(r.rows.map((x) => [x.label, x.price]), [['ZR2 Bison Edition', 11700]]);
  });
  it('Bison is not offered on other trims', () => {
    assert.deepEqual(run('Chevrolet', { model: 'Colorado', trim: 'Trail Boss' }, ['ZR2 Bison Edition']).rows, []);
  });
  it('AT4X AEV Edition is a paid package on the AT4X (Canyon 2026, Sierra 1500 2027, Sierra 2500 HD 2026)', () => {
    for (const [model, year, price] of [['Canyon', 2026, 10100], ['Sierra 1500', 2027, 6640], ['Sierra 2500 HD', 2026, 9390]]) {
      const r = run('GMC', { model, year, trim: 'AT4X' }, ['AT4X AEV Edition']);
      assert.deepEqual(r.rows.map((x) => [x.label, x.kind, x.price]), [['AT4X AEV Edition', 'package', price]], model);
    }
    assert.deepEqual(run('GMC', { model: 'Canyon', trim: 'AT4' }, ['AT4X AEV Edition']).rows, []);
  });
});

describe('Corvette lean cut: only packages, paints, wheels and performance items; the $1,000 threshold is for performance items only', () => {
  const vette = (names, trim = 'Stingray 1LT') => run('Chevrolet', { model: 'Corvette', year: 2027, trim }, names);
  it('keeps every priced package, paint and wheel, and performance items over $1,000', () => {
    const r = vette(['Z51 Performance Package', '20-spoke Gloss Black forged', 'Magnetic Selective Ride Control', 'Quad center exit exhaust', 'Roswell Green Metallic', '5-split-spoke Satin Graphite machined edge forged']);
    assert.deepEqual(r.rows.map((x) => [x.label, x.kind, x.price]).sort(), [['20-spoke Gloss Black forged', 'option', 1095], ['5-split-spoke Satin Graphite machined edge forged', 'option', 995], ['Magnetic Selective Ride Control', 'option', 1895], ['Quad center exit exhaust', 'option', 1995], ['Roswell Green Metallic', 'paint', 500], ['Z51 Performance Package', 'package', 5395]].sort());
  });
  it('drops everything else: exterior stripes, seats, roof, interior items, and performance items at or under $1,000', () => {
    const r = vette(['Stinger stripe', 'Full-length dual racing stripes', 'Competition Sport bucket seats', 'Transparent roof panel', 'Visible carbon-fiber roof panel with body-color surround', 'Personalized interior plaque', 'Performance data and video recorder', 'Engine lighting', 'Battery (12-volt) Protection Package', '6.7L engine cover']);
    assert.deepEqual(r.rows, [], JSON.stringify(r.rows));
  });
  it('the whole Corvette policy obeys the cut and no non-Corvette Chevrolet policy does', () => {
    let vetteEntries = 0, cheap = 0;
    for (const [scope, p] of Object.entries(RAW.chevrolet)) for (const t of Object.values(p.trims)) for (const o of Object.values(t.options)) {
      if (scope.includes('|corvette|')) { vetteEntries++; assert.ok(['package', 'option', 'paint'].includes(o.kind) && o.price > 0, `${t.label} ${o.label} $${o.price}`); } else if (o.price <= 1000) cheap++;
    }
    assert.ok(vetteEntries > 50, `${vetteEntries} Corvette entries`);
    assert.ok(cheap > 300, `${cheap} sub-$1,000 entries on other models`);
  });
  it('a Corvette trim is trusted only as listed ("Stingray 1LT"); a bare "Stingray" gets nothing', () => {
    assert.deepEqual(vette(['Z51 Performance Package'], 'Stingray').rows, []);
  });
});

describe('write path and API list (code only, policy on)', () => {
  const car = { make: 'Chevrolet', model: 'Trax', year: 2026, trim: 'LT' };
  const feed = [{ name: 'LT Convenience Package', price: 595 }, { name: 'Apple CarPlay' }, { name: 'Bluetooth' }, { name: 'Cloth Seats' }];
  it('the facet table gets only the policy rows and the API list is the same set, with the policy price and kind', () => {
    const f = policyFacetRows(ALLOW, car, feed);
    assert.deepEqual(f.rows.map((x) => x.key), ['6k5']);
    assert.deepEqual(policyApiOptions(ALLOW, car, feed), [{ code: null, name: 'LT Convenience Package', price: 595, kind: 'package' }]);
  });
  it('a vehicle of a make without a policy gets the very same list back', () => {
    const honda = [{ name: 'Apple CarPlay' }];
    assert.equal(policyApiOptions(ALLOW, { make: 'Honda', model: 'Civic', year: 2026, trim: 'LX' }, honda), honda);
  });
});

describe('the generated files are current', () => {
  it('node scripts/build-gm-option-policy.mjs --check passes', () => {
    execFileSync(process.execPath, [path.join(repo, 'scripts/build-gm-option-policy.mjs'), '--check'], { stdio: 'pipe' });
  });
});

describe('apply scripts (not run here): one per brand, scoped to its own make and model years', () => {
  for (const [b, make] of [['chevrolet', 'Chevrolet'], ['gmc', 'GMC'], ['buick', 'Buick']]) {
    it(`${b}: parses, touches only make = '${make}' for 2026-27, has plan / apply / restore with checkpoints`, () => {
      const f = path.join(repo, `scripts/box/2026-10-11-${b}-option-policy-apply.mjs`);
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
      const s = fs.readFileSync(f, 'utf8');
      assert.equal((s.match(new RegExp(`make = '${make}'`, 'g')) || []).length, 3); // the header comment and the two queries
      assert.equal((s.match(/year IN \(2026, 2027\)/g) || []).length >= 2, true);
      assert.doesNotMatch(s, /Ford|Toyota|make = '(?!(?:Chevrolet|GMC|Buick)')/);
      for (const needle of ['async function plan', 'async function apply', 'async function restore', 'checkpoint.json', 'backup.jsonl', 'applied.jsonl', 'args.go']) assert.ok(s.includes(needle), needle);
      assert.ok(s.includes(`${b}-option-policy-apply`) && s.includes(`${b}-option-policy-restore`));
    });
  }
});

describe('paid interior lines (option bot, Paul 2026-10-11: every paid factory line on the window sticker stays)', () => {
  const interior = (b) => CSV[b].filter((r) => r.category === 'Factory option' && r.subcategory === 'Interior');
  const policyFor = (b, r) => {
    const p = Object.values(RAW[b]).find((x) => x.models[0] === slug(r.model) && x.source.includes(r.year));
    return p?.trims[slug(r.trim)];
  };
  for (const b of ['chevrolet', 'gmc']) {
    it(`${b}: every paid interior row (except Corvette's lean cut) is in its trim's policy at the CSV price, as an option`, () => {
      const rows = interior(b).filter((r) => Number(r.price_usd) > 0 && r.model !== 'Corvette');
      assert.ok(rows.length > 20);
      for (const r of rows) {
        const t = policyFor(b, r);
        assert.ok(t, `${r.model} ${r.trim}`);
        const e = Object.values(t.options).find((o) => o.label === r.item.replace(/®|™/g, '').trim());
        assert.ok(e, `${r.year} ${r.model} ${r.trim}: ${r.item}`);
        assert.deepEqual([e.kind, e.price], ['option', Number(r.price_usd)], r.item);
      }
    });
    it(`${b}: no $0 interior row and no Corvette interior row becomes an option`, () => {
      for (const r of interior(b).filter((x) => !(Number(x.price_usd) > 0) || x.model === 'Corvette')) {
        const t = policyFor(b, r);
        if (!t) continue;
        assert.ok(!Object.values(t.options).some((o) => o.label === r.item && o.kind === 'option' && (r.model === 'Corvette' || o.price === 0)), `${r.model} ${r.trim}: ${r.item}`);
      }
    });
  }
  it('Colorado WT and Silverado 1500 WT get their new paid interior lines, priced per trim', () => {
    const colorado = { model: 'Colorado', trim: 'WT' };
    assert.deepEqual(run('Chevrolet', colorado, ['Jet Black, Evotex seat trim']).rows.map((x) => [x.kind, x.price]), [['option', 1250]]);
    const silverado = run('Chevrolet', { model: 'Silverado 1500', trim: 'WT', year: 2027 }, ['Wrapped steering wheel']);
    assert.deepEqual(silverado.rows.map((x) => [x.kind, x.price]), [['option', 75]]);
  });
  it('GMC Sierra 1500 PRO gets wrapped steering wheel $75 and carpeted floor covering $100', () => {
    const r = run('GMC', { model: 'Sierra 1500', trim: 'PRO', year: 2027 }, ['Wrapped steering wheel', 'Carpeted floor covering']);
    assert.deepEqual(r.rows.map((x) => [x.label, x.price]).sort(), [['Carpeted floor covering', 100], ['Wrapped steering wheel', 75]]);
  });
  it('Corvette keeps its lean cut: an interior line is still dropped', () => {
    const r = run('Chevrolet', { model: 'Corvette', trim: '1LT', year: 2026 }, ['Wrapped steering wheel']);
    assert.deepEqual(r?.rows ?? [], []);
  });
  it('Cadillac: the paid interior lines (65 CSV rows) are already in its policy and the CSV is unchanged', () => {
    const rows = parseCsv(fs.readFileSync(path.join(repo, 'docs/cadillac-honda-kia-2026-2027/cadillac_lineup_options_by_trim.csv'), 'utf8'));
    assert.equal(rows.length, 677);
    const paid = rows.filter((r) => r.category === 'Factory option' && r.subcategory === 'Interior' && Number(r.price_usd) > 0);
    assert.ok(paid.length > 0);
    const raw = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionPolicies/cadillac-2026-2027.json'), 'utf8'));
    const labels = new Set(Object.values(raw).flatMap((p) => Object.values(p.trims).flatMap((t) => Object.values(t.options).map((o) => o.label))));
    for (const r of paid) assert.ok(labels.has(r.item.replace(/®|™/g, '').trim()), r.item);
  });
});
