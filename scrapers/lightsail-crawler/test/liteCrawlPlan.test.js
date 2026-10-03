// Lite nightly crawl, Phase 0 (shadow only). The URL shapes below are real ones from box1's crawl data
// (2026-10-01) — one per platform the shadow pass counts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LITE_PLATFORMS,
  liteModeFromEnv,
  litePlatformsFromEnv,
  classifyPlatform,
  normalizeVdpUrl,
  buildUrlIndex,
  knownGoodVinsFromSnapshot,
  planDealer,
  carryForwardRecord,
  emptyLiteShadowStats,
  addLiteShadowStats,
  createLiteShadowSession,
} from '../src/liteCrawlPlan.js';

const DDC_URL = 'https://www.volvocarsdanbury.com/new/Volvo/2026-Volvo-XC40-danbury-ct-b2877b02ac185e03871a198ada14c842.htm';
const TV_URL = 'https://www.liavw.com/viewdetails/cpo/3vwcb7bu8lm033830/2020-volkswagen-jetta-4dr-car';
const FLAT_URL = 'https://www.middletownnissan.com/new-Middletown-2027-Nissan-Rogue-Dark+Armor-5N1BT3BBXVC676683';
const OTHER_URL = 'https://www.example-dealer.com/inventory/used';

const OPT = [{ code: 'PKG-1', name: 'Premium Package', price: 1200, kind: 'dealer' }];

function snapshotFixture() {
  return {
    YV4L12UC0T2822989: { vin: 'YV4L12UC0T2822989', status: 'ACTIVE', url: DDC_URL, price: 50260, mileage: 0, dealerListedOptions: OPT, factoryOptions: [] },
    '3VWCB7BU8LM033830': { vin: '3VWCB7BU8LM033830', status: 'ACTIVE', url: TV_URL, price: null, mileage: 41000, dealerListedOptions: [], factoryOptions: [] },
    '5N1BT3BBXVC676683': { vin: '5N1BT3BBXVC676683', status: 'ACTIVE', url: FLAT_URL, price: 36644, mileage: 0, dealerListedOptions: [], factoryOptions: [{ code: 'X', name: 'Sunroof' }] },
    SOLDVIN0000000001: { vin: 'SOLDVIN0000000001', status: 'SOLD_OR_REMOVED', url: 'https://www.sold.com/x-SOLDVIN0000000001', price: 1, dealerListedOptions: OPT },
  };
}

describe('liteModeFromEnv / litePlatformsFromEnv', () => {
  it('only "shadow" turns shadow mode on — unset, "off", garbage and the not-yet-implemented "on" are all off', () => {
    assert.equal(liteModeFromEnv({}), 'off');
    assert.equal(liteModeFromEnv({ CRAWLER_LITE_NIGHTLY: 'off' }), 'off');
    assert.equal(liteModeFromEnv({ CRAWLER_LITE_NIGHTLY: 'on' }), 'off');
    assert.equal(liteModeFromEnv({ CRAWLER_LITE_NIGHTLY: 'yes' }), 'off');
    assert.equal(liteModeFromEnv({ CRAWLER_LITE_NIGHTLY: 'shadow' }), 'shadow');
    assert.equal(liteModeFromEnv({ CRAWLER_LITE_NIGHTLY: ' Shadow ' }), 'shadow');
  });

  it('defaults to all three counted platforms, and drops unknown names from an explicit list', () => {
    assert.deepEqual(litePlatformsFromEnv({}), ['ddc', 'viewdetails', 'flat_vin']);
    assert.deepEqual(litePlatformsFromEnv({ CRAWLER_LITE_PLATFORMS: '' }), [...LITE_PLATFORMS]);
    assert.deepEqual(litePlatformsFromEnv({ CRAWLER_LITE_PLATFORMS: 'viewdetails, DDC ,bogus' }), ['viewdetails', 'ddc']);
  });
});

describe('classifyPlatform', () => {
  it('recognizes each platform by its real URL shape', () => {
    assert.equal(classifyPlatform(DDC_URL), 'ddc');
    assert.equal(classifyPlatform(TV_URL), 'viewdetails');
    assert.equal(classifyPlatform(FLAT_URL), 'flat_vin');
    assert.equal(classifyPlatform(OTHER_URL), 'other');
    assert.equal(classifyPlatform(''), 'other');
    assert.equal(classifyPlatform(null), 'other');
  });
});

describe('normalizeVdpUrl', () => {
  it('ignores protocol, www., case, a trailing slash and the #fragment', () => {
    const a = normalizeVdpUrl('https://www.LiaVW.com/viewdetails/cpo/3VWCB7BU8LM033830/2020-volkswagen-jetta-4dr-car/#photos');
    const b = normalizeVdpUrl('http://liavw.com/viewdetails/cpo/3vwcb7bu8lm033830/2020-volkswagen-jetta-4dr-car');
    assert.equal(a, b);
    assert.equal(a, 'liavw.com/viewdetails/cpo/3vwcb7bu8lm033830/2020-volkswagen-jetta-4dr-car');
  });

  it('keeps the query string — some platforms identify the vehicle there', () => {
    assert.notEqual(normalizeVdpUrl('https://x.com/details.aspx?id=1'), normalizeVdpUrl('https://x.com/details.aspx?id=2'));
  });

  it('degrades gracefully on a non-URL string and returns "" for empty input', () => {
    assert.equal(normalizeVdpUrl('www.Example.com/Car/#x'), 'example.com/car');
    assert.equal(normalizeVdpUrl(''), '');
    assert.equal(normalizeVdpUrl(undefined), '');
  });
});

describe('buildUrlIndex', () => {
  it('maps normalized URL -> VIN for ACTIVE records only', () => {
    const index = buildUrlIndex(snapshotFixture());
    assert.equal(index.get(normalizeVdpUrl(DDC_URL)), 'YV4L12UC0T2822989');
    assert.equal(index.get(normalizeVdpUrl(TV_URL)), '3VWCB7BU8LM033830');
    assert.equal(index.has(normalizeVdpUrl('https://www.sold.com/x-SOLDVIN0000000001')), false);
    assert.equal(index.size, 3);
  });

  it('drops a URL claimed by two different VINs instead of trusting either', () => {
    const index = buildUrlIndex({
      AAAAAAAAAAAAAAAA1: { status: 'ACTIVE', url: 'https://d.com/car' },
      BBBBBBBBBBBBBBBB2: { status: 'ACTIVE', url: 'https://www.d.com/car/' },
      CCCCCCCCCCCCCCCC3: { status: 'ACTIVE', url: 'https://d.com/car' },
    });
    assert.equal(index.has('d.com/car'), false);
  });

  it('skips records with no url, and tolerates an empty/missing snapshot', () => {
    assert.equal(buildUrlIndex({ X: { status: 'ACTIVE' } }).size, 0);
    assert.equal(buildUrlIndex(undefined).size, 0);
  });
});

describe('knownGoodVinsFromSnapshot', () => {
  it('counts ACTIVE VINs with non-empty dealerListedOptions or factoryOptions', () => {
    const known = knownGoodVinsFromSnapshot(snapshotFixture());
    assert.deepEqual([...known].sort(), ['5N1BT3BBXVC676683', 'YV4L12UC0T2822989']);
  });
});

describe('planDealer', () => {
  const snapshot = snapshotFixture();
  const urlIndex = buildUrlIndex(snapshot);
  const knownGoodVins = knownGoodVinsFromSnapshot(snapshot);
  const NEW_URL = 'https://www.volvocarsdanbury.com/new/Volvo/2027-Volvo-EX30-danbury-ct-00000000000000000000000000000000.htm';

  it('is lite only when the URL maps to a snapshot VIN, the VIN has options, and its platform is allowed', () => {
    const urls = [DDC_URL, TV_URL, FLAT_URL, NEW_URL, OTHER_URL];
    const plan = planDealer({ urls, urlIndex, snapshot, knownGoodVins, platforms: LITE_PLATFORMS });
    assert.deepEqual(plan.lite, [
      { url: DDC_URL, vin: 'YV4L12UC0T2822989', platform: 'ddc' },
      { url: FLAT_URL, vin: '5N1BT3BBXVC676683', platform: 'flat_vin' },
    ]);
    // TV_URL: known VIN but no options yet -> full. NEW_URL: not in snapshot -> full. OTHER_URL: unknown -> full.
    assert.deepEqual(plan.full, [TV_URL, NEW_URL, OTHER_URL]);
    assert.equal(plan.matched, 3);
    assert.deepEqual(plan.byPlatform.ddc, { urls: 2, matched: 1, liteEligible: 1 });
    assert.deepEqual(plan.byPlatform.viewdetails, { urls: 1, matched: 1, liteEligible: 0 });
    assert.deepEqual(plan.byPlatform.other, { urls: 1, matched: 0, liteEligible: 0 });
  });

  it('sends a known-good VIN to full when its platform is not in the allowlist', () => {
    const plan = planDealer({ urls: [DDC_URL, FLAT_URL], urlIndex, snapshot, knownGoodVins, platforms: ['viewdetails'] });
    assert.deepEqual(plan.lite, []);
    assert.deepEqual(plan.full, [DDC_URL, FLAT_URL]);
  });

  it('every input URL lands in exactly one of full/lite, in order', () => {
    const urls = [OTHER_URL, DDC_URL, TV_URL];
    const plan = planDealer({ urls, urlIndex, snapshot, knownGoodVins });
    assert.equal(plan.full.length + plan.lite.length, urls.length);
  });
});

describe('carryForwardRecord', () => {
  const prev = snapshotFixture().YV4L12UC0T2822989;

  it('takes price/mileage from the listing when it is a real number, marks it seen today, and leaves options alone', () => {
    const rec = carryForwardRecord(prev, { price: 48900, mileage: 12 }, '2026-10-02');
    assert.equal(rec.price, 48900);
    assert.equal(rec.mileage, 12);
    assert.equal(rec.lastSeen, '2026-10-02');
    assert.equal(rec.liteCarried, true);
    assert.deepEqual(rec.dealerListedOptions, OPT);
    assert.deepEqual(rec.factoryOptions, []);
    assert.equal(rec.vin, prev.vin);
  });

  it('keeps the stored value when the listing is missing, null, NaN or a string', () => {
    assert.equal(carryForwardRecord(prev, null, '2026-10-02').price, 50260);
    assert.equal(carryForwardRecord(prev, { price: null, mileage: undefined }, '2026-10-02').price, 50260);
    assert.equal(carryForwardRecord(prev, { price: Number.NaN }, '2026-10-02').price, 50260);
    assert.equal(carryForwardRecord(prev, { price: '45000' }, '2026-10-02').price, 50260);
    assert.equal(carryForwardRecord(prev, {}, '2026-10-02').mileage, 0);
  });

  it('does not mutate the snapshot record it was given', () => {
    const before = JSON.stringify(prev);
    carryForwardRecord(prev, { price: 1, mileage: 2 }, '2026-10-02');
    assert.equal(JSON.stringify(prev), before);
  });
});

describe('addLiteShadowStats', () => {
  it('returns null when both sides are missing', () => {
    assert.equal(addLiteShadowStats(null, undefined), null);
  });

  it('sums every counter and every per-platform counter', () => {
    const a = { ...emptyLiteShadowStats(), urlsTotal: 10, liteEligible: 4, indexMismatches: 1, byPlatform: { ddc: { urls: 10, matched: 5, liteEligible: 4, liteEligibleProduced: 3, indexMismatches: 1 } } };
    const b = { ...emptyLiteShadowStats(), urlsTotal: 5, liteEligible: 2, vehiclesExtracted: 5, byPlatform: { ddc: { urls: 2, matched: 2, liteEligible: 2, liteEligibleProduced: 2, indexMismatches: 0 }, viewdetails: { urls: 3, matched: 0, liteEligible: 0, liteEligibleProduced: 0, indexMismatches: 0 } } };
    const sum = addLiteShadowStats(a, b);
    assert.equal(sum.urlsTotal, 15);
    assert.equal(sum.liteEligible, 6);
    assert.equal(sum.indexMismatches, 1);
    assert.equal(sum.vehiclesExtracted, 5);
    assert.deepEqual(sum.byPlatform.ddc, { urls: 12, matched: 7, liteEligible: 6, liteEligibleProduced: 5, indexMismatches: 1 });
    assert.deepEqual(sum.byPlatform.viewdetails, { urls: 3, matched: 0, liteEligible: 0, liteEligibleProduced: 0, indexMismatches: 0 });
  });
});

describe('createLiteShadowSession', () => {
  it("mode 'off' logs nothing, reports no stats, and leaves the dealer's URL list exactly as it was", () => {
    const lines = [];
    const session = createLiteShadowSession({ mode: 'off', snapshot: snapshotFixture(), log: (l) => lines.push(l) });
    const urls = [DDC_URL, TV_URL, FLAT_URL];
    const copy = [...urls];
    session.beginDealer('Some Dealer', urls);
    session.recordExtracted(DDC_URL, 'YV4L12UC0T2822989');
    session.endDealer();
    assert.deepEqual(lines, []);
    assert.equal(session.stats(), null);
    assert.deepEqual(urls, copy);
  });

  it("mode 'shadow' predicts per dealer, checks the prediction against what the full fetch produced, and never touches the URL list", () => {
    const lines = [];
    const session = createLiteShadowSession({ mode: 'shadow', snapshot: snapshotFixture(), log: (l) => lines.push(l) });
    const urls = [DDC_URL, TV_URL, FLAT_URL, OTHER_URL];
    const copy = [...urls];

    session.beginDealer('Dealer A', urls);
    session.recordExtracted(DDC_URL, 'YV4L12UC0T2822989'); // lite-eligible, produced, VIN matches
    session.recordExtracted(FLAT_URL, 'JM3KMDHA3T0226661'); // lite-eligible, produced, WRONG VIN -> mismatch
    session.recordExtracted(TV_URL, '3VWCB7BU8LM033830'); // full-path URL, counts only toward vehiclesExtracted
    session.endDealer();

    assert.deepEqual(urls, copy);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\[lite-shadow\] Dealer A urls=4 matched=3 liteEligible=2 byPlatform=\{/);
    assert.equal(lines[1], '[lite-shadow] Dealer A liteEligibleProduced=2/2 indexMismatches=1 vehiclesExtracted=3');

    const stats = session.stats();
    assert.equal(stats.urlsTotal, 4);
    assert.equal(stats.matched, 3);
    assert.equal(stats.liteEligible, 2);
    assert.equal(stats.liteEligibleProduced, 2);
    assert.equal(stats.indexMismatches, 1);
    assert.equal(stats.vehiclesExtracted, 3);
    assert.equal(stats.byPlatform.flat_vin.indexMismatches, 1);
    assert.equal(stats.byPlatform.ddc.liteEligibleProduced, 1);
  });

  it('counts a lite-eligible URL that the full fetch failed on as not produced, and accumulates across dealers', () => {
    const session = createLiteShadowSession({ mode: 'shadow', snapshot: snapshotFixture() });
    session.beginDealer('Dealer A', [DDC_URL]);
    session.endDealer(); // DDC_URL fetch produced nothing tonight
    session.beginDealer('Dealer B', [FLAT_URL]);
    session.recordExtracted(FLAT_URL, '5N1BT3BBXVC676683');
    session.endDealer();
    const stats = session.stats();
    assert.equal(stats.liteEligible, 2);
    assert.equal(stats.liteEligibleProduced, 1);
    assert.equal(stats.indexMismatches, 0);
  });

  it('endDealer is safe to call with no dealer open (standalone.js calls it in a finally on every path), and beginDealer closes an unclosed dealer', () => {
    const lines = [];
    const session = createLiteShadowSession({ mode: 'shadow', snapshot: snapshotFixture(), log: (l) => lines.push(l) });
    session.endDealer();
    assert.deepEqual(lines, []);
    session.beginDealer('Dealer A', [DDC_URL]);
    session.beginDealer('Dealer B', [FLAT_URL]);
    session.endDealer();
    session.endDealer();
    assert.equal(lines.length, 4);
    assert.equal(session.stats().liteEligible, 2);
  });

  it('reports a zeroed block (not null) when shadow mode ran but saw no dealers', () => {
    const stats = createLiteShadowSession({ mode: 'shadow', snapshot: {} }).stats();
    assert.deepEqual(stats, emptyLiteShadowStats());
  });
});
