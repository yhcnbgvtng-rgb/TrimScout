// Normal HTTP(S) client for bot-protection *reporting* only.
// Uses node:https / node:http — no TLS impersonation, no cookie jar replay,
// no challenge solver. Redirects are followed a few hops so a vanity host
// that 301s to www still gets classified.

import http from 'node:http';
import https from 'node:https';
import { classifyFetchResult, classifyFetchError, pickProbeResult, decideProbeNext, BOT_CLASSES } from './bot_protection.js';

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
    const classified = classifyFetchResult(res);
    // The body is already in memory from requestOnce — only carry it back
    // to the caller for a clean, unblocked page. A challenge/error page's
    // HTML isn't the dealer's real content (see dealerPageIdentityPlain.js's
    // own block-page guard), and there's no reason to hold onto bodies for
    // 404/5xx/etc. probes that nothing downstream reads.
    const body = classified.classification === BOT_CLASSES.NONE ? res.body : undefined;
    return { ...classified, url, fetchedUrl: url, body };
  } catch (error) {
    return { ...classifyFetchError(error), url, fetchedUrl: url };
  }
}

// Sitemap first, then homepage. A sitemap 404 is not "the dealer is 404" —
// try `/` before classifying HTTP_404 / HTTP_5XX. Challenge / WAF / DNS /
// TLS / reset stop immediately (detect only; no bypass, no extra retries
// on a dead host).
export async function probeDealer(dealer, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { dealerProbeUrls } = await import('./nj_policy.js');
  const urls = dealerProbeUrls(dealer);
  const results = [];
  for (const url of urls) {
    const result = await probeUrl(url, { timeoutMs });
    results.push(result);
    const action = decideProbeNext(result);
    if (action === 'accept' || action === 'stop') return result;
  }
  return pickProbeResult(results);
}
