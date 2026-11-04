// The box2 quote patcher, run against byte-for-byte copies of the LIVE files (scripts/box/fixtures/2026-11-04-box2): dry-run writes nothing,
// the real run patches once and is a no-op the second time, the result parses, it refuses a file it was not written for, and it leaves the
// trade-in / contact-reveal / vin-search / one-per-VIN code alone.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', '2026-11-04-box2');
const SRC = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src');
const PATCH = path.join(here, '2026-11-04-box2-quote-patches.py');
const NAMES = ['deals_api_server.js', 'dealStages.js', 'rfqStages.js'];

const liveCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'box2patch-test-'));
  for (const n of NAMES) fs.copyFileSync(path.join(FIX, n), path.join(dir, n));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  return dir;
};
const run = (dir, ...extra) => spawnSync('python3', ['-I', PATCH, '--dir', dir, '--src', SRC, ...extra], { encoding: 'utf8' });
const read = (dir, n) => fs.readFileSync(path.join(dir, n), 'utf8');

describe('box2 quote patcher', () => {
  it('--dry-run reports the changes, syntax-checks them and writes nothing', () => {
    const dir = liveCopy();
    const before = NAMES.map((n) => read(dir, n));
    const r = run(dir, '--dry-run');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /deals_api_server\.js patched: publicRfqQuote, columns, expiresAt, tradeAnswerExpiry, expiresAtCheck, body, insert-columns, insert-values, quote-read-filter/);
    assert.match(r.stdout, /stateTradeCredit\.js: would install \(new file\)/);
    assert.match(r.stdout, /syntax ok/);
    assert.match(r.stdout, /DRY RUN: nothing written/);
    assert.deepEqual(NAMES.map((n) => read(dir, n)), before);
    assert.equal(fs.existsSync(path.join(dir, 'stateTradeCredit.js')), false);
  });

  it('patches once, is a no-op the second time, and everything parses', () => {
    const dir = liveCopy();
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    const once = NAMES.map((n) => read(dir, n));
    const again = run(dir);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already patched/);
    assert.deepEqual(NAMES.map((n) => read(dir, n)), once);
    for (const n of [...NAMES, 'stateTradeCredit.js']) execFileSync('node', ['--check', path.join(dir, n)]);
    // installed files are exactly the repo's
    for (const n of ['stateTradeCredit.js', 'dealStages.js', 'rfqStages.js']) assert.equal(read(dir, n), fs.readFileSync(path.join(SRC, n), 'utf8'));
  });

  it('(a) stamps audit on the quote and filters the quote reads', () => {
    const s = read((() => { const d = liveCopy(); run(d); return d; })(), 'deals_api_server.js');
    assert.match(s, /used_json, availability_json, audit, audit_at\)/);
    assert.match(s, /usedJson, availabilityJson, rfqRows\[0\]\.audit \? 1 : 0, rfqRows\[0\]\.audit \? new Date\(\) : null\]/);
    assert.match(s, /FROM rfq_quotes WHERE invite_id IN \(\$\{placeholders\}\) AND deleted_at IS NULL AND \(audit = 0 OR \(SELECT audit FROM rfq_requests WHERE id = \?\) = 1\)/);
    assert.match(s, /\[\.\.\.inviteIds, rfqId\]/);
    assert.match(s, /ADD COLUMN IF NOT EXISTS audit TINYINT\(1\) NOT NULL DEFAULT 0/);
  });

  it('(b) saves availability and hands it back on the quote', () => {
    const s = read((() => { const d = liveCopy(); run(d); return d; })(), 'deals_api_server.js');
    assert.match(s, /availability: parseJsonCol\(row\.availability_json\)/);
    assert.match(s, /const availabilityJson = body\.availability && typeof body\.availability === "object"/);
    assert.match(s, /ADD COLUMN IF NOT EXISTS availability_json TEXT NULL/);
  });

  it('(c) the offer date is optional: no required check, NULL when missing, never a default date', () => {
    const s = read((() => { const d = liveCopy(); run(d); return d; })(), 'deals_api_server.js');
    assert.doesNotMatch(s, /if \(!expiresAt \|\| Number\.isNaN/);
    assert.match(s, /const expiresAt = body\.expiresAt != null && String\(body\.expiresAt\)\.trim\(\) !== "" \? body\.expiresAt : null;/);
    assert.match(s, /expiresAt != null && Number\.isNaN\(new Date\(expiresAt\)\.getTime\(\)\)\) missing\.push/);
    assert.match(s, /expiresAt \? new Date\(expiresAt\) : null/);
    assert.match(s, /quoteExpiresAt: expiresAt, now/);
    const handler = s.slice(s.indexOf('async function handleSubmitRfqQuote('), s.indexOf('async function handleSubmitRfqQuote(') + 6000);
    const uses = handler.split('new Date(expiresAt)');
    assert.equal(uses.length, 3, 'only the validity check and the guarded insert build a date from expiresAt');
    assert.ok(handler.includes('expiresAt ? new Date(expiresAt) : null'), 'the insert only builds a date when one was sent');
    assert.doesNotMatch(handler, /expiresAt\s*=[^=][^;]*(Date\.now\(\)|new Date\(\)|setDate|setHours)/, 'no default date');
  });

  it('(c) the SQL only makes expires_at nullable', () => {
    const sql = fs.readFileSync(path.join(here, '2026-11-04-rfq-quote-optional-offer-date.sql'), 'utf8').split('\n').filter((l) => !l.startsWith('--')).join('\n');
    assert.match(sql, /MODIFY expires_at DATETIME NULL/);
    assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE|DEFAULT)\b/i);
  });

  it('(d) installs the shared state trade credit and drops the 11-state list', () => {
    const dealStages = fs.readFileSync(path.join(SRC, 'dealStages.js'), 'utf8');
    assert.match(dealStages, /import \{ STATE_TRADE_CREDIT, quoteIsNew, quotedTaxOf, tradeTaxSaving \} from "\.\/stateTradeCredit\.js"/);
    assert.doesNotMatch(dealStages, /\["CO", "FL", "GA", "IL"/);
    assert.match(fs.readFileSync(path.join(SRC, 'rfqStages.js'), 'utf8'), /\n      used,\n/);
  });

  it('refuses a deals_api_server.js it was not written for, and writes nothing', () => {
    const dir = liveCopy();
    fs.appendFileSync(path.join(dir, 'deals_api_server.js'), '\n// changed on the box\n');
    const before = NAMES.map((n) => read(dir, n));
    const r = run(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not the version this was written against/);
    assert.deepEqual(NAMES.map((n) => read(dir, n)), before);
    assert.equal(fs.existsSync(path.join(dir, 'stateTradeCredit.js')), false);
  });

  it('refuses a changed dealStages.js, and writes nothing (not even the server file)', () => {
    const dir = liveCopy();
    fs.appendFileSync(path.join(dir, 'dealStages.js'), '\n// hand edit\n');
    const before = NAMES.map((n) => read(dir, n));
    const r = run(dir);
    assert.notEqual(r.status, 0);
    assert.deepEqual(NAMES.map((n) => read(dir, n)), before);
  });

  it('touches none of the trade-in, contact-reveal, vin-search or one-per-VIN code', () => {
    const dir = liveCopy();
    run(dir);
    const a = fs.readFileSync(path.join(FIX, 'deals_api_server.js'), 'utf8');
    const b = read(dir, 'deals_api_server.js');
    for (const word of ['createRfqTradeConfirmHandlers', 'handleRfqTradeIn', 'tradeAnswerProblem', 'createRfqContactRevealHandler', 'handleInventoryVinSearch', 'vin-search', 'loserMaint', 'onePerVinModeOf', 'facetsOnePerVin']) {
      assert.equal(b.split(word).length, a.split(word).length, word);
    }
    const removed = a.split('\n').filter((l) => !b.split('\n').includes(l));
    assert.ok(removed.length <= 12, `only the lines this patch rewrites are removed (${removed.length})`);
  });
});
