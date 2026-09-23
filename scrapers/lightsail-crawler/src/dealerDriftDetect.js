// Pure comparison logic for the dealer domain/name-drift report.
//
// dealer-bot-report.mjs already probes every in-scope dealer nightly and
// already has the *configured* domain/name as loop variables — this module
// just compares those against what the probe actually observed live
// (the resolved post-redirect URL, and the page's self-reported identity
// via dealerPageIdentityPlain.js). Kept separate from dealer-bot-report.mjs
// itself (which runs its whole probe loop at module scope on import, so
// it can't be safely imported by a test) purely so this comparison logic
// stays unit-testable in isolation.

import { normalizeDealerHost } from './nj_verified_domains.js';

// Words that carry no identity signal for a dealership's own name — "of"/
// "the" are template glue, "auto"/"motors"/"group" are generic industry
// words nearly every rooftop's name (old or new) could include.
const STOPWORDS = new Set([
  'the', 'of', 'at', 'and', 'inc', 'llc', 'corp', 'co',
  'dealership', 'dealer', 'dealers', 'auto', 'autos', 'automotive',
  'cars', 'car', 'group', 'motors', 'motor',
]);

function tokenize(name) {
  return new Set(
    String(name || '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

// Containment (shared tokens / smaller set's size), not Jaccard — a longer
// legal name that fully contains the shorter observed name (or vice versa)
// should read as the same dealer, not a partial mismatch.
export function nameSimilarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return null;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}

// Flags when the site's self-reported name doesn't plausibly match the
// configured name. Returns null when there's nothing to compare (no name
// observed — block page, extraction miss) or the names are a good enough
// match; a match needs at least half the smaller name's distinctive words
// to appear in the other.
export function detectNameDrift(configuredName, observedName) {
  if (!observedName) return null;
  const similarity = nameSimilarity(configuredName, observedName);
  if (similarity === null || similarity >= 0.5) return null;
  return { configured: configuredName, observed: observedName };
}

// Flags when the configured domain and the probe's final (post-redirect)
// URL land on different hosts once both are normalized the same way the
// rest of the dealer-seed pipeline already does (nj_verified_domains.js).
export function detectDomainDrift(configuredDomain, resolvedUrl) {
  if (!resolvedUrl) return null;
  let resolvedHost;
  try {
    resolvedHost = new URL(resolvedUrl).hostname;
  } catch {
    return null;
  }
  const configuredHost = normalizeDealerHost(configuredDomain);
  const observedHost = normalizeDealerHost(resolvedHost);
  if (!configuredHost || !observedHost || configuredHost === observedHost) return null;
  return { configured: configuredHost, resolved: observedHost };
}
