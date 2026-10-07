// Nightly-crawl "lite" mode (CRAWLER_LITE_NIGHTLY_MODE, off by default) — see
// liteCrawlOptionsGuard.js's own header comment for the guarantee this protects. These are the
// exact scenarios from the PR's own test plan: a known VIN's options survive an empty fetch, a
// new or blank-options VIN still gets a full extract, and the mode does nothing when off.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPreserveStoredOptions, buildOptionsPatch } from '../src/liteCrawlOptionsGuard.js';

describe('shouldPreserveStoredOptions', () => {
  it('is false when the mode is off, regardless of stored-options status', () => {
    assert.equal(shouldPreserveStoredOptions({ liteModeEnabled: false, hasStoredOptions: true }), false);
  });
  it('is false for a VIN with no stored options, even with the mode on (new or blank-options VIN)', () => {
    assert.equal(shouldPreserveStoredOptions({ liteModeEnabled: true, hasStoredOptions: false }), false);
  });
  it('is true only when the mode is on AND the VIN already has real stored options', () => {
    assert.equal(shouldPreserveStoredOptions({ liteModeEnabled: true, hasStoredOptions: true }), true);
  });
});

describe('buildOptionsPatch', () => {
  it('known VIN with real stored options: ignores this run\'s own (even empty) fetch result, patch carries no options fields, and the raw scrape gets cleared', () => {
    const emptyFetchResult = { options: [], optionCodes: [], totalOptionsPrice: 0, baseMsrp: 45000 };
    const { patch, clearDealerListedOptions } = buildOptionsPatch({ liteModeEnabled: true, hasStoredOptions: true, optionData: emptyFetchResult });
    assert.deepEqual(patch, {});
    assert.equal(clearDealerListedOptions, true);
  });

  it('known VIN with real stored options: still ignores options fields even if this run\'s fetch DID find something (never re-crawls options once stored)', () => {
    const freshNonEmptyFetch = { options: [{ code: 'ABC', name: 'Sunroof', price: 995 }], optionCodes: ['ABC'], totalOptionsPrice: 995, baseMsrp: 45000 };
    const { patch, clearDealerListedOptions } = buildOptionsPatch({ liteModeEnabled: true, hasStoredOptions: true, optionData: freshNonEmptyFetch });
    assert.deepEqual(patch, {});
    assert.equal(clearDealerListedOptions, true);
  });

  it('new VIN (no stored options): full extract — patch carries the real fetched options fields', () => {
    const fetched = { options: [{ code: 'X1', name: 'Nav', price: 500 }], optionCodes: ['X1'], totalOptionsPrice: 500, baseMsrp: 30000 };
    const { patch, clearDealerListedOptions } = buildOptionsPatch({ liteModeEnabled: true, hasStoredOptions: false, optionData: fetched });
    assert.deepEqual(patch, { factoryOptions: fetched.options, optionCodes: fetched.optionCodes, totalOptionsPrice: 500, baseMsrp: 30000 });
    assert.equal(clearDealerListedOptions, false);
  });

  it('known VIN whose stored options are blank: full extract, same as a new VIN', () => {
    const fetched = { options: [{ code: 'X2', name: 'Tow Pkg', price: 350 }], optionCodes: ['X2'], totalOptionsPrice: 350, baseMsrp: 28000 };
    const { patch, clearDealerListedOptions } = buildOptionsPatch({ liteModeEnabled: true, hasStoredOptions: false, optionData: fetched });
    assert.deepEqual(patch, { factoryOptions: fetched.options, optionCodes: fetched.optionCodes, totalOptionsPrice: 350, baseMsrp: 28000 });
    assert.equal(clearDealerListedOptions, false);
  });

  it('mode off: behaves exactly as before this mode existed, even for a VIN with stored options', () => {
    const fetched = { options: [], optionCodes: [], totalOptionsPrice: 0, baseMsrp: null };
    const { patch, clearDealerListedOptions } = buildOptionsPatch({ liteModeEnabled: false, hasStoredOptions: true, optionData: fetched });
    assert.deepEqual(patch, { factoryOptions: [], optionCodes: [], totalOptionsPrice: 0, baseMsrp: null });
    assert.equal(clearDealerListedOptions, false);
  });
});
