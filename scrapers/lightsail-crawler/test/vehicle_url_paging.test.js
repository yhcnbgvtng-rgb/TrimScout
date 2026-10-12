import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  vehicleUrlLimits, planVehicleUrlPages, describeVehicleUrlPlan, DEFAULT_HARD_MAX_VEHICLES_PER_DEALER,
} from '../src/vehicleUrlPaging.js';

const urls = (n) => Array.from({ length: n }, (_, i) => `https://d.example/vdp/${i}`);

test('the 2026-10-10 case: 1,172 URLs with a 1,000 page size are all crawled, in two pages (used to drop 172)', () => {
  const limits = vehicleUrlLimits({ CRAWLER_MAX_VEHICLES_PER_DEALER: '1000' });
  const plan = planVehicleUrlPages(urls(1172), limits);
  assert.deepEqual(plan.pages.map((p) => p.length), [1000, 172]);
  assert.equal(plan.dropped, 0);
  assert.equal(plan.hardCapped, false);
  assert.deepEqual(plan.pages.flat(), urls(1172), 'order preserved, nothing duplicated or lost');
});

test('the largest rooftop seen (6,157 URLs) fits under the default ceiling', () => {
  const limits = vehicleUrlLimits({ CRAWLER_MAX_VEHICLES_PER_DEALER: '1000' });
  const plan = planVehicleUrlPages(urls(6157), limits);
  assert.equal(plan.pages.length, 7);
  assert.equal(plan.kept, 6157);
  assert.equal(plan.dropped, 0);
});

test('the hard ceiling still bounds a pathological sitemap, and says what it dropped', () => {
  const limits = vehicleUrlLimits({ CRAWLER_MAX_VEHICLES_PER_DEALER: '1000' });
  const plan = planVehicleUrlPages(urls(50000), limits);
  assert.equal(plan.kept, DEFAULT_HARD_MAX_VEHICLES_PER_DEALER);
  assert.equal(plan.dropped, 50000 - DEFAULT_HARD_MAX_VEHICLES_PER_DEALER);
  assert.equal(plan.hardCapped, true);
  assert.equal(plan.pages.flat().length, DEFAULT_HARD_MAX_VEHICLES_PER_DEALER);
  assert.match(describeVehicleUrlPlan('Big Auto', plan, limits), /over the hard limit of 8000.*42000 not crawled/);
});

test('the ceiling is configurable, and setting it to the page size restores the old truncation', () => {
  const limits = vehicleUrlLimits({ CRAWLER_MAX_VEHICLES_PER_DEALER: '1000', CRAWLER_HARD_MAX_VEHICLES_PER_DEALER: '1000' });
  const plan = planVehicleUrlPages(urls(1172), limits);
  assert.deepEqual(plan.pages.map((p) => p.length), [1000]);
  assert.equal(plan.dropped, 172);
});

test('a page size above the ceiling is clamped; no page size means one page; junk values fall back to defaults', () => {
  assert.deepEqual(vehicleUrlLimits({ CRAWLER_MAX_VEHICLES_PER_DEALER: '99999', CRAWLER_HARD_MAX_VEHICLES_PER_DEALER: '2000' }), { pageSize: 2000, hardMax: 2000 });
  assert.deepEqual(vehicleUrlLimits({}), { pageSize: 0, hardMax: DEFAULT_HARD_MAX_VEHICLES_PER_DEALER });
  assert.deepEqual(vehicleUrlLimits({ CRAWLER_MAX_VEHICLES_PER_DEALER: 'abc', CRAWLER_HARD_MAX_VEHICLES_PER_DEALER: '-5' }), { pageSize: 0, hardMax: DEFAULT_HARD_MAX_VEHICLES_PER_DEALER });
  const single = planVehicleUrlPages(urls(3000), vehicleUrlLimits({}));
  assert.equal(single.pages.length, 1);
  assert.equal(single.kept, 3000);
});

test('edge sizes: empty, exactly one page, exactly the ceiling', () => {
  assert.deepEqual(planVehicleUrlPages([], { pageSize: 1000, hardMax: 8000 }).pages, []);
  assert.equal(planVehicleUrlPages(urls(1000), { pageSize: 1000, hardMax: 8000 }).pages.length, 1);
  const atCeiling = planVehicleUrlPages(urls(8000), { pageSize: 1000, hardMax: 8000 });
  assert.equal(atCeiling.hardCapped, false);
  assert.equal(atCeiling.pages.length, 8);
  assert.equal(describeVehicleUrlPlan('X', planVehicleUrlPages(urls(500), { pageSize: 1000, hardMax: 8000 }), {}), null, 'quiet when nothing needed paging');
});

test('standalone.js uses the planner and no longer slices vehicleUrls to a cap', () => {
  const src = readFileSync(new URL('../src/standalone.js', import.meta.url), 'utf8');
  assert.match(src, /planVehicleUrlPages\(vehicleUrls, urlLimits\)/);
  assert.doesNotMatch(src, /vehicleUrls\.slice\(0, maxVehiclesPerDealer\)/);
  assert.match(src, /for \(let pageNo = 0; pageNo < urlPlan\.pages\.length/);
  assert.match(src, /if \(dealerTimedOut\) \{\s*console\.log\(`\$\{progress\} ⏱️ \$\{dealer\.name\}: 1-hour cutoff reached before page/);
});
