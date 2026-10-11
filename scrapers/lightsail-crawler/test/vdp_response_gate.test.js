import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyFetchResult } from '../src/bot_protection.js';
import { vdpSkipReason } from '../src/vdpResponseGate.js';

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const MAINTENANCE_PAGE = read('audi_platform_503_maintenance.html'); // the body box2 got back from the Audi platform
const { rows: FAILING_ROWS } = JSON.parse(read('audi_blank_model_rows.json'));

test('Audi platform maintenance page (HTTP 503) is skipped, so no VIN-only stub is written', () => {
  assert.ok(FAILING_ROWS.length >= 5);
  for (const row of FAILING_ROWS) {
    const cls = classifyFetchResult({ statusCode: 503, headers: {}, body: MAINTENANCE_PAGE });
    assert.equal(cls.classification, 'HTTP_5XX', row.vin);
    assert.match(vdpSkipReason(cls), /503/, row.vin);
  }
});

test('the maintenance page really contains no vehicle data (what made the stub blank)', () => {
  assert.match(MAINTENANCE_PAGE, /Site currently\s+not available/);
  assert.doesNotMatch(MAINTENANCE_PAGE, /application\/ld\+json|vehicleIdentificationNumber|"model"/i);
});

test('other error statuses are skipped too', () => {
  for (const statusCode of [500, 502, 504, 404, 410, 401]) {
    const cls = classifyFetchResult({ statusCode, headers: {}, body: '<html>error</html>' });
    assert.ok(vdpSkipReason(cls), `HTTP ${statusCode}`);
  }
});

test('a normal 200 page (and a followed redirect) is still parsed', () => {
  for (const statusCode of [200, 301, 302]) {
    const cls = classifyFetchResult({ statusCode, headers: {}, body: '<html><script type="application/ld+json">{"@type":"Car","model":"Q5"}</script></html>' });
    assert.equal(vdpSkipReason(cls), null, `HTTP ${statusCode}`);
  }
});
