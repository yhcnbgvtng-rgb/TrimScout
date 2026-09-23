import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectDomainDrift, detectNameDrift, nameSimilarity } from '../src/dealerDriftDetect.js';

describe('detectDomainDrift', () => {
  it('flags when the resolved host differs from the configured one', () => {
    // The real case that motivated this feature: Mark Ficken Ford's seed
    // still has the pre-rebrand domain, which redirects to the dealer's
    // real current site.
    const drift = detectDomainDrift('felixsabatesfordlincoln.net', 'https://www.fordlincolncharlotte.com/');
    assert.deepEqual(drift, { configured: 'felixsabatesfordlincoln.net', resolved: 'fordlincolncharlotte.com' });
  });

  it('does not flag when the host matches modulo scheme/www', () => {
    assert.equal(detectDomainDrift('bachrodtbmw.com', 'https://www.bachrodtbmw.com/inventory'), null);
    assert.equal(detectDomainDrift('www.bachrodtbmw.com', 'http://bachrodtbmw.com/'), null);
  });

  it('does not flag a subdomain retailer-platform host against itself', () => {
    assert.equal(detectDomainDrift('jackdaniels.porsche.com', 'https://jackdaniels.porsche.com/inventory/new'), null);
  });

  it('returns null when there is no resolved URL to compare (probe failed before a response)', () => {
    assert.equal(detectDomainDrift('somebmw.com', null), null);
  });

  it('returns null for an unparseable resolved URL rather than throwing', () => {
    assert.equal(detectDomainDrift('somebmw.com', 'not a url'), null);
  });
});

describe('nameSimilarity / detectNameDrift', () => {
  it('flags a rebrand where the observed name shares little with the configured one', () => {
    const drift = detectNameDrift('Mark Ficken Ford', 'Ford Lincoln Charlotte');
    assert.deepEqual(drift, { configured: 'Mark Ficken Ford', observed: 'Ford Lincoln Charlotte' });
  });

  it('does not flag "of"-style template variants of the same name', () => {
    assert.equal(detectNameDrift('BMW of Morristown', 'Morristown BMW'), null);
    assert.equal(detectNameDrift('Mercedes-Benz of Paramus', 'Mercedes-Benz Paramus'), null);
  });

  it('does not flag when the configured name fully contains the observed short form', () => {
    assert.equal(detectNameDrift('Prestige Volvo Cars East Hanover', 'Prestige Volvo'), null);
  });

  it('returns null when nothing was observed (block page, extraction miss)', () => {
    assert.equal(detectNameDrift('Some Dealer', null), null);
    assert.equal(detectNameDrift('Some Dealer', ''), null);
  });

  it('nameSimilarity is null when either name tokenizes to nothing', () => {
    assert.equal(nameSimilarity('The Of At', 'Some Real Dealer'), null);
  });
});
