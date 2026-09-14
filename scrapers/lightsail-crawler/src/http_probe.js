// Normal HTTP(S) client for bot-protection *reporting* only.
// Uses node:https / node:http — no TLS impersonation, no cookie jar replay,
// no challenge solver. Redirects are followed a few hops so a vanity host
// that 301s to www still gets classified.

import http from 'node:http';
import https from 'node:https';
import { classifyFetchResult, classifyFetchError } from './bot_protection.js';

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;
const UA = 'TrimScout-NJ-Crawler-Probe/1.0 (+https://trimscout.com; inventory monitor; not a bypass client)';

function requestOnce(urlString, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': UA,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => {
          if (chunks.reduce((n, b) => n + b.length, 0) < 200_000) chunks.push(c);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            url: urlString,
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Fetch timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function probeUrl(url, { timeoutMs = DEFAULT_TIMEOUT_MS, redirects = 0 } = {}) {
  try {
    const res = await requestOnce(url, timeoutMs);
    const loc = res.headers.location;
    if (loc && res.statusCode >= 300 && res.statusCode < 400 && redirects < MAX_REDIRECTS) {
      const next = new URL(loc, url).toString();
      return probeUrl(next, { timeoutMs, redirects: redirects + 1 });
    }
    return { ...classifyFetchResult(res), url, fetchedUrl: url };
  } catch (error) {
    return { ...classifyFetchError(error), url, fetchedUrl: url };
  }
}

// Sitemap first, then homepage. The "worst" (non-NONE) classification wins
// so a clean sitemap that 200s while the home is Cloudflare still reports
// CLOUDFLARE. No second fetch is attempted once a challenge is seen.
export async function probeDealer(dealer, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { dealerProbeUrls } = await import('./nj_policy.js');
  const urls = dealerProbeUrls(dealer);
  let best = {
    classification: 'OTHER',
    httpStatus: null,
    notes: 'No probe URL',
    url: null,
  };
  for (const url of urls) {
    const result = await probeUrl(url, { timeoutMs });
    if (result.classification === 'NONE') {
      if (best.classification === 'OTHER' && !best.httpStatus) best = result;
      else if (best.classification === 'NONE') best = result;
      continue;
    }
    return result;
  }
  return best;
}
