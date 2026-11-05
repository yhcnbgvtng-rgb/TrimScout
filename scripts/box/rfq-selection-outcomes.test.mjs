// The deals-box patch for per-vehicle selection outcomes: applies to a COPY of the repo mirror (TEST_ONLY: no sudo, no pm2),
// twice (idempotent), and the patched server still parses. The SQL itself only runs on the box (see the patch header).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIRROR = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src', 'deals_api_server.js');
const SCRIPT = path.join(here, '2026-11-05-rfq-selection-outcomes.sh');

function apply(file) {
  return execFileSync('bash', [SCRIPT], { env: { ...process.env, TEST_ONLY: '1', FILE: file }, encoding: 'utf8' });
}

describe('rfq selection-outcomes box patch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-outcomes-'));
  const copy = path.join(dir, 'deals_api_server.js');
  fs.copyFileSync(MIRROR, copy);

  it('applies cleanly to the repo mirror and the result passes node --check', () => {
    const out = apply(copy);
    assert.match(out, /applied: column, mapper, idempotent invite, handler, route/);
    assert.match(out, /syntax ok/);
    const s = fs.readFileSync(copy, 'utf8');
    assert.match(s, /selection_outcomes_json MEDIUMTEXT/);
    assert.match(s, /selectionOutcomes: parseJsonCol\(row\.selection_outcomes_json\)/);
    assert.match(s, /method === "PUT" && rfqSelectionOutcomesMatch/);
  });

  it('is idempotent: a second run changes nothing', () => {
    const before = fs.readFileSync(copy, 'utf8');
    const out = apply(copy);
    assert.match(out, /nothing \(already present\)/);
    assert.equal(fs.readFileSync(copy, 'utf8'), before);
  });

  it('a retry for a dealership that already holds a live invitation returns it instead of creating a second row', () => {
    const s = fs.readFileSync(copy, 'utf8');
    const reuse = s.indexOf('reused: true');
    const insert = s.indexOf('INSERT INTO rfq_invites (rfq_id, dealer_name');
    const cap = s.indexOf('An RFQ can invite at most');
    assert.ok(reuse > 0 && insert > reuse && cap > reuse, 'the reuse check runs before the cap and before the insert');
  });

  it('the endpoint only stores whitelisted fields and a fixed set of reason codes', () => {
    const s = fs.readFileSync(copy, 'utf8');
    const handler = s.slice(s.indexOf('async function handlePutSelectionOutcomes'), s.indexOf('POST /api/rfqs/:id/invites/:inviteId/delivery'));
    assert.match(handler, /SELECTION_CODES\.has\(o\.code\)/);
    assert.doesNotMatch(handler, /INSERT INTO rfq_invites|delivery_status|sendMail|resend/i, 'display data only: it cannot create or send anything');
  });

  it('the repo mirror itself is untouched (the patch is code only until it is installed)', () => {
    assert.doesNotMatch(fs.readFileSync(MIRROR, 'utf8'), /selection_outcomes_json/);
  });
});
