// Option re-clean of stored rows (scripts/lib/optionReclean.mjs + scripts/box/2026-10-16-option-reclean.mjs): the per-car verdicts and the script's rails.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAllowlist, loadBundledModelPoliciesRaw } from '../src/factoryOptionAllowlist.js';
import { compileJunkRules, setJunkRules } from '../src/inventoryOptionRows.js';
import { recleanCar, buildPolicyMatchIndex, RECLEAN_MAKES } from '../../../scripts/lib/optionReclean.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rules = JSON.parse(fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/optionJunkRules.json'), 'utf8'));
const policies = loadBundledModelPoliciesRaw();
const CTX = { allow: buildAllowlist(null, policies) };
before(() => setJunkRules(compileJunkRules(rules)));

const Q9 = { vin: 'V1', dealer_id: 7, make: 'Audi', model: 'Q9', year: 2027, trim: 'Prestige TFSI quattro tiptronic' };
const car = (o, extra = {}) => ({ ...Q9, options_json: o.map((name) => ({ name })), ...extra });
const row = (key, label, code = null) => [key, label, code];

describe('which makes', () => {
  it('RECLEAN_MAKES is exactly the makes of the 16 bundled policy files, and the junk list still has its 10 rules', () => {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const fromPolicy = new Set(Object.keys(policies).map((k) => k.split('|')[0]));
    assert.equal(fromPolicy.size, 15);
    assert.deepEqual([...RECLEAN_MAKES].map(slug).sort(), [...fromPolicy].map(slug).sort());
    assert.equal(compileJunkRules(rules).rules.length, 10);
  });
});

describe('policy-covered cars', () => {
  it('a junk row goes, the paid sticker line stays, nothing else changes', () => {
    const r = recleanCar(CTX, car(['Trailer hitch', 'Roadside Assistance']), [row('trailer hitch', 'Trailer hitch'), row('roadside assistance', 'Roadside Assistance')]);
    assert.equal(r.status, 'change');
    assert.deepEqual(r.removed.map((x) => x.label), ['Roadside Assistance']);
    assert.deepEqual(r.after.map((x) => x[1]), ['Trailer hitch']);
    assert.equal(r.relabeled, 0); assert.equal(r.added, 0);
  });
  it('an already clean car is unchanged', () => {
    const r = recleanCar(CTX, car(['Trailer hitch']), [row('trailer hitch', 'Trailer hitch')]);
    assert.equal(r.status, 'unchanged');
  });
  it('a paid line of the car\'s own trim that today\'s feed no longer lists is NOT removed', () => {
    const r = recleanCar(CTX, car(['Roadside Assistance']), [row('trailer hitch', 'Trailer hitch'), row('roadside assistance', 'Roadside Assistance')]);
    assert.equal(r.status, 'change');
    assert.equal(r.paidKept, 1);
    assert.deepEqual(r.removed.map((x) => x.label), ['Roadside Assistance']);
    assert.deepEqual(r.after.map((x) => x[0]), ['trailer hitch']);
    assert.deepEqual(r.paid, ['trailer hitch']);
  });
  it('a policy line a feed marks $0 is still kept (a paid sticker line never goes to the junk list)', () => {
    const r = recleanCar(CTX, car([]), [row('trailer hitch', 'Trailer hitch')]);
    assert.equal(r.removed.length, 0);
    assert.equal(r.paidKept, 1);
  });
  it('blank trim and untrusted trim are skipped, stored rows untouched', () => {
    assert.equal(recleanCar(CTX, car(['Roadside Assistance'], { trim: '' }), [row('roadside assistance', 'Roadside Assistance')]).status, 'skip-blank-trim');
    assert.equal(recleanCar(CTX, car(['Roadside Assistance'], { trim: null }), []).status, 'skip-blank-trim');
    assert.equal(recleanCar(CTX, car(['Roadside Assistance'], { trim: 'Audi Chantilly' }), [row('roadside assistance', 'Roadside Assistance')]).status, 'skip-untrusted-trim');
  });
});

describe('cars no policy covers', () => {
  const plain = { vin: 'V2', dealer_id: 7, make: 'Toyota', model: 'Corolla', year: 2019, trim: 'LE', options_json: [] };
  it('only a junk:* row is removed; nothing is added; other labels are untouched', () => {
    const stored = [row('tow package', 'Tow Package'), row('roadside assistance', 'Roadside Assistance'), row('all wheel drive', 'All Wheel Drive')];
    const r = recleanCar(CTX, plain, stored);
    assert.equal(r.covered, false);
    assert.equal(r.status, 'change');
    assert.deepEqual(r.removed.map((x) => x.rule).sort(), ['junk:roadside', 'junk:vehicle-spec-not-option']);
    assert.deepEqual(r.after.map((x) => x[1]), ['Tow Package']);
    assert.equal(r.added, 0);
  });
  it('a SiriusXM trial line is rewritten to SiriusXM (old row replaced, counted as a rewrite, not a removal)', () => {
    const r = recleanCar(CTX, plain, [row('siriusxm with 360l trial subscription', 'SiriusXM with 360L Trial Subscription'), row('tow package', 'Tow Package')]);
    assert.equal(r.status, 'change');
    assert.deepEqual(r.removed.map((x) => x.rule), ['rewrite']);
    assert.equal(r.rewritten, 1);
    assert.deepEqual(r.after.map((x) => x[1]).sort(), ['SiriusXM', 'Tow Package']);
  });
  it('a clean car is unchanged, a blank trim is skipped', () => {
    assert.equal(recleanCar(CTX, plain, [row('tow package', 'Tow Package')]).status, 'unchanged');
    assert.equal(recleanCar(CTX, { ...plain, trim: ' ' }, [row('roadside assistance', 'Roadside Assistance')]).status, 'skip-blank-trim');
  });
  it('Roadside Assistance Kit is exempt and stays', () => {
    assert.equal(recleanCar(CTX, plain, [row('roadside assistance kit', 'Roadside Assistance Kit')]).status, 'unchanged');
  });
});

describe('policy match index (plan report)', () => {
  it('finds a policy entry (paid, with its trim and scope) for a row key, for the right make only', () => {
    const idx = buildPolicyMatchIndex(CTX.allow);
    const hit = idx.get('audi').get('trailer hitch');
    assert.ok(hit.some((h) => h.paid && h.label === 'Trailer hitch' && h.scope.startsWith('audi|q9')));
    assert.equal(idx.get('toyota').get('trailer hitch'), undefined);
  });
  it('the own trim is reported on a covered car result', () => {
    assert.equal(recleanCar(CTX, car(['Trailer hitch', 'Roadside Assistance']), [row('trailer hitch', 'Trailer hitch'), row('roadside assistance', 'Roadside Assistance')]).ownTrimLabel, 'Prestige TFSI quattro tiptronic');
  });
});

describe('the re-clean script', () => {
  const src = fs.readFileSync(path.join(repo, 'scripts/box/2026-10-16-option-reclean.mjs'), 'utf8');
  const audi = fs.readFileSync(path.join(repo, 'scripts/box/2026-10-15-audi-option-policy-apply.mjs'), 'utf8');
  const fn = (name) => { const a = src.indexOf(`async function ${name}(`); return src.slice(a, src.indexOf('\n}\n', a)); };
  it('keeps the Audi rails: 20-dealer batches, 20 s cap, sync lock, hard stop 21:40 ET, backup, stale guard, restore dry unless --go, reader account for reads', () => {
    for (const s of ['const BATCH = 20, CAP = 20;', '"21:40"', 'takeLock("option-reclean-apply")', 'takeLock("option-reclean-restore")', 'pastDeadline()', 'LOCK BUSY', 'backup.jsonl', 'async function restore()', 'DB_READER_USER', 'const write = PHASE === "apply" || (PHASE === "restore" && args.go);', 'if (!args.go) return;', 'a second query timed out']) assert.ok(src.includes(s), s);
    for (const s of ['const BATCH = 20, CAP = 20;', 'a second query timed out', 'const write = PHASE === "apply" || (PHASE === "restore" && args.go);']) assert.ok(audi.includes(s), `Audi script has ${s}`);
  });
  it('the dry run takes no lock, opens no file for writing and prints no VIN', () => {
    const d = fn('dryrun');
    assert.ok(d.includes('lockHeld()'));
    assert.doesNotMatch(d, /takeLock|writeFileSync|openSync|writeSync|appendFile|INSERT|DELETE|UPDATE/);
    assert.doesNotMatch(src.slice(src.indexOf('function report('), src.indexOf('async function dealerIdsFor')), /vin/i);
    assert.ok(!src.slice(src.indexOf('const write ='), src.indexOf('const DEALS')).includes('dryrun'), 'dryrun never uses the writer account');
  });
  it('apply refuses an incomplete or sampled plan, and skips a car that would lose a paid line', () => {
    assert.ok(fn('apply').includes('the plan is incomplete') && fn('apply').includes('--stride'));
    assert.ok(src.includes('would lose a paid sticker line: never'));
  });
  it('the plan skips blank and untrusted trims before anything is backed up (status !== "change")', () => {
    assert.ok(fn('plan').includes('if (res.status !== "change") continue;'));
  });
  it('the emitted single-file bundle runs on stdin with the engine, the 10 junk rules and the policies inlined', async () => {
    let esbuild = null; try { esbuild = await import('esbuild'); } catch {}
    if (!esbuild) return; // bundling tool not installed here
    const env = { ...process.env }; delete env.NODE_OPTIONS; // the test runner's loader flags must not leak into the plain-node children
    const bundle = execFileSync('node', [path.join(repo, 'scripts/box/2026-10-16-option-reclean.mjs'), '--emit'], { maxBuffer: 64 << 20, env });
    let out;
    try { out = execFileSync('node', ['--input-type=module', '-', '--phase=selftest'], { input: bundle, env, stdio: ['pipe', 'pipe', 'pipe'], cwd: fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'rc-')) }).toString(); }
    catch (e) { assert.fail(`bundle failed: ${String(e.stderr).slice(-500)}`); }
    const j = JSON.parse(out);
    assert.equal(j.junkRules, 10); assert.equal(j.policyScopes, 254); assert.equal(j.status, 'change');
    assert.ok(j.removed.includes('Roadside Assistance'));
  });
});
