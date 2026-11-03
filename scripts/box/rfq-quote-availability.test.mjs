// The deals-box patch for the dealer availability confirmation: applies to the repo mirror copy, twice (idempotent), and the result still parses.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIRROR = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src', 'deals_api_server.js');
const PATCH = path.join(here, 'rfq-quote-availability-patch.py');

describe('rfq-quote-availability box patch', () => {
  it('patches a copy of the mirror once, is a no-op the second time, and leaves valid JavaScript', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avail-'));
    const f = path.join(dir, 'deals_api_server.js');
    fs.copyFileSync(MIRROR, f);
    const out1 = execFileSync('python3', ['-I', PATCH, f], { encoding: 'utf8' });
    assert.match(out1, /patched: publicRfqQuote, column, body, insert-columns, insert-values/);
    const once = fs.readFileSync(f, 'utf8');
    assert.match(once, /ADD COLUMN IF NOT EXISTS availability_json TEXT NULL/);
    assert.match(once, /availability: parseJsonCol\(row\.availability_json\)/);
    assert.match(once, /usedJson, availabilityJson, rfqRows\[0\]\.audit/);
    assert.match(execFileSync('python3', ['-I', PATCH, f], { encoding: 'utf8' }), /already patched/);
    assert.equal(fs.readFileSync(f, 'utf8'), once);
    execFileSync('node', ['--check', f]);
  });

  it('the SQL is additive only: one nullable column', () => {
    const sql = fs.readFileSync(path.join(here, '2026-11-03-rfq-quote-availability.sql'), 'utf8').split('\n').filter((l) => !l.startsWith('--')).join('\n');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS availability_json TEXT NULL/);
    assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE|MODIFY)\b/i);
  });
});
