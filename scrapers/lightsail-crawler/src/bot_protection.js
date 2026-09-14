// Bot-protection *detection* only. Classifies a normal HTTP response
// (or a transport error) so the crawler can skip+log challenge pages.
//
// Forbidden here, and nowhere else in this package should add it:
// WAF/captcha/challenge bypass, fingerprint spoofing, cookie replay to
// "solve" a challenge, or any other bot-protection evasion.

export const BOT_CLASSES = Object.freeze({
  NONE: 'NONE',
  CLOUDFLARE: 'CLOUDFLARE',
  VERCEL_CHECKPOINT: 'VERCEL_CHECKPOINT',
  HTTP_403: 'HTTP_403',
  HTTP_429: 'HTTP_429',
  DNS_DEAD: 'DNS_DEAD',
  HTTP_404: 'HTTP_404',
  HTTP_5XX: 'HTTP_5XX',
  CONN_RESET: 'CONN_RESET',
  TIMEOUT: 'TIMEOUT',
  TLS: 'TLS',
  OTHER: 'OTHER',
});

// Actual bot / WAF / challenge classes. Infra failures (DNS, 404, 5xx,
// reset, timeout, TLS) need different fixes and must not be counted as
// "skipped for bot protection."
export const WAF_CLASSES = new Set([
  BOT_CLASSES.CLOUDFLARE,
  BOT_CLASSES.VERCEL_CHECKPOINT,
  BOT_CLASSES.HTTP_403,
  BOT_CLASSES.HTTP_429,
]);

// Same host will not suddenly resolve or complete TLS because we retry `/`.
export const INFRA_NO_HOMEPAGE_RETRY = new Set([
  BOT_CLASSES.DNS_DEAD,
  BOT_CLASSES.CONN_RESET,
  BOT_CLASSES.TIMEOUT,
  BOT_CLASSES.TLS,
]);

export const SOFT_HTTP_CLASSES = new Set([
  BOT_CLASSES.HTTP_404,
  BOT_CLASSES.HTTP_5XX,
]);

export const BOT_PROTECTED_CLASSES = WAF_CLASSES;

export const CLASSIFICATION_ORDER = [
  BOT_CLASSES.NONE,
  BOT_CLASSES.CLOUDFLARE,
  BOT_CLASSES.VERCEL_CHECKPOINT,
  BOT_CLASSES.HTTP_403,
  BOT_CLASSES.HTTP_429,
  BOT_CLASSES.DNS_DEAD,
  BOT_CLASSES.HTTP_404,
  BOT_CLASSES.HTTP_5XX,
  BOT_CLASSES.CONN_RESET,
  BOT_CLASSES.TIMEOUT,
  BOT_CLASSES.TLS,
  BOT_CLASSES.OTHER,
];

export function isBotProtected(classification) {
  return WAF_CLASSES.has(classification);
}

export function isUncrawlable(classification) {
  return Boolean(classification) && classification !== BOT_CLASSES.NONE;
}

export function decideProbeNext(result) {
  const cls = result?.classification;
  if (cls === BOT_CLASSES.NONE) return 'accept';
  if (isBotProtected(cls)) return 'stop';
  if (INFRA_NO_HOMEPAGE_RETRY.has(cls)) return 'stop';
  if (SOFT_HTTP_CLASSES.has(cls) || cls === BOT_CLASSES.OTHER) return 'continue';
  return 'stop';
}

export function pickProbeResult(results) {
  let soft = null;
  for (const result of results) {
    const action = decideProbeNext(result);
    if (action === 'accept' || action === 'stop') return result;
    if (action === 'continue' && !soft) soft = result;
  }
  return soft || {
    classification: BOT_CLASSES.OTHER,
    httpStatus: null,
    notes: 'No probe URL',
    url: null,
  };
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || '';
  }
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function collectHeaderHay(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    const parts = [];
    for (const [k, v] of headers.entries()) parts.push(`${k}: ${v}`);
    return parts.join('\n');
  }
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : v}`)
    .join('\n');
}

// Detect-only vendor label from headers / body. Never used to bypass.
export function detectWafVendor(headers = {}, body = '') {
  const hay = collectHeaderHay(headers).toLowerCase();
  const server = String(headerValue(headers, 'server') || '').toLowerCase();
  const sample = (typeof body === 'string' ? body : '').slice(0, 8000).toLowerCase();
  const blob = `${hay}\n${sample}`;

  if (
    headerValue(headers, 'cf-ray') ||
    /cloudflare/.test(server) ||
    /cf-mitigated|cf-challenge|cdn-cgi\/challenge/.test(blob) ||
    /attention required|just a moment/.test(sample)
  ) {
    return 'Cloudflare';
  }
  if (
    headerValue(headers, 'x-vercel-mitigated') ||
    headerValue(headers, 'x-vercel-challenge-token') ||
    /vercel/.test(server) ||
    /vercel security checkpoint|_vercel_challenge/.test(blob)
  ) {
    return 'Vercel';
  }
  if (/akamaighost|akamai|x-akamai|akamai-grn|x-akamai-transformed|\bak_p\b/.test(blob) || /akamai/.test(server)) {
    return 'Akamai';
  }
  if (/imperva|incapsula|x-iinfo|visid_incap|incap_ses/.test(blob)) {
    return 'Imperva';
  }
  if (/x-amzn-waf|aws-waf|awselb/.test(blob) || /awselb|awselb\/2\.0/.test(server)) {
    return 'AWS WAF';
  }
  if (/x-amz-cf-|cloudfront/.test(blob) || /cloudfront/.test(server)) {
    return 'CloudFront';
  }
  if (/sucuri/.test(blob) || /sucuri/.test(server)) {
    return 'Sucuri';
  }
  if (/datadome|x-datadome|x-dd-b/.test(blob)) {
    return 'DataDome';
  }
  if (/perimeterx|_pxhd|x-px-|px-cdn|human security|px-captcha/.test(blob)) {
    return 'HUMAN/PerimeterX';
  }
  if (/fastly/.test(server) || /x-fastly|fastly-/.test(blob)) {
    return 'Fastly';
  }
  if (/\bbigip\b|x-wa-info|barracuda/.test(blob)) {
    return 'F5/Barracuda-like';
  }
  if (server) return `Unknown (${server.slice(0, 40)})`;
  return 'Unknown';
}

export function classifyFetchError(err) {
  const msg = err instanceof Error ? err.message : String(err || 'unknown error');
  const code = err && typeof err === 'object' ? String(err.code || '') : '';
  const hay = `${code} ${msg}`;
  if (/enotfound|eai_again|getaddrinfo|err_name_not_resolved|enodata/i.test(hay)) {
    return { classification: BOT_CLASSES.DNS_DEAD, httpStatus: null, notes: msg.slice(0, 300), wafVendor: null };
  }
  if (/econnreset|econnrefused|econnaborted|epipe|ehostunreach|enetunreach/i.test(hay)) {
    return { classification: BOT_CLASSES.CONN_RESET, httpStatus: null, notes: msg.slice(0, 300), wafVendor: null };
  }
  if (/timeout|etimedout|esockettimedout|aborted|abort|Fetch timeout/i.test(hay)) {
    return { classification: BOT_CLASSES.TIMEOUT, httpStatus: null, notes: msg.slice(0, 300), wafVendor: null };
  }
  if (/ssl|tls|cert|unable_to_verify|eproto|certificate|ERR_TLS/i.test(hay)) {
    return { classification: BOT_CLASSES.TLS, httpStatus: null, notes: msg.slice(0, 300), wafVendor: null };
  }
  return { classification: BOT_CLASSES.OTHER, httpStatus: null, notes: msg.slice(0, 300), wafVendor: null };
}

export function classifyFetchResult({ statusCode = null, headers = {}, body = '', error = null } = {}) {
  if (error) return classifyFetchError(error);

  const status = Number(statusCode) || 0;
  const text = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf-8') : '';
  const sample = text.slice(0, 20000);
  const headerHay = collectHeaderHay(headers);
  const cfRay = headerValue(headers, 'cf-ray');
  const cfMitigated = headerValue(headers, 'cf-mitigated');
  const server = headerValue(headers, 'server');
  const wafVendor = detectWafVendor(headers, sample);

  const looksCloudflare =
    Boolean(cfRay) ||
    /cloudflare/i.test(server) ||
    /cf-mitigated/i.test(headerHay) ||
    /attention required|just a moment|cf-challenge|challenge-platform|cdn-cgi\/challenge/i.test(sample);

  const looksVercel =
    /vercel security checkpoint|human verification|_vercel_challenge|x-vercel-challenge/i.test(`${sample}\n${headerHay}`) ||
    Boolean(headerValue(headers, 'x-vercel-mitigated') || headerValue(headers, 'x-vercel-challenge-token'));

  if (looksCloudflare && (status === 403 || status === 429 || status === 503 || /attention required|just a moment|cf-challenge/i.test(sample))) {
    return {
      classification: BOT_CLASSES.CLOUDFLARE,
      httpStatus: status || null,
      notes: cfMitigated ? `Cloudflare mitigated (${cfMitigated})` : 'Cloudflare challenge / bot-fight page',
      wafVendor: 'Cloudflare',
    };
  }

  if (looksVercel || (status === 429 && /vercel/i.test(`${sample}\n${headerHay}`))) {
    return {
      classification: BOT_CLASSES.VERCEL_CHECKPOINT,
      httpStatus: status || null,
      notes: 'Vercel Security Checkpoint',
      wafVendor: 'Vercel',
    };
  }

  if (status === 429) {
    return { classification: BOT_CLASSES.HTTP_429, httpStatus: 429, notes: 'HTTP 429 Too Many Requests', wafVendor };
  }
  if (status === 403) {
    return {
      classification: BOT_CLASSES.HTTP_403,
      httpStatus: 403,
      notes: `HTTP 403 Forbidden; vendor=${wafVendor}`,
      wafVendor,
    };
  }
  if (status === 404) {
    return { classification: BOT_CLASSES.HTTP_404, httpStatus: 404, notes: 'HTTP 404', wafVendor: null };
  }
  if (status >= 500 && status <= 599) {
    return { classification: BOT_CLASSES.HTTP_5XX, httpStatus: status, notes: `HTTP ${status}`, wafVendor: null };
  }
  if (status >= 200 && status < 400) {
    return { classification: BOT_CLASSES.NONE, httpStatus: status, notes: '', wafVendor: null };
  }
  if (!status) {
    return { classification: BOT_CLASSES.OTHER, httpStatus: null, notes: 'No HTTP status', wafVendor };
  }
  return { classification: BOT_CLASSES.OTHER, httpStatus: status, notes: `HTTP ${status}`, wafVendor };
}

export function summarizeBotRows(rows) {
  const summary = {};
  for (const cls of CLASSIFICATION_ORDER) summary[cls] = 0;
  for (const r of rows) {
    const cls = r.classification || BOT_CLASSES.OTHER;
    summary[cls] = (summary[cls] || 0) + 1;
  }

  const byBrand = new Map();
  for (const r of rows) {
    const brand = r.brand || r.make || 'Unknown';
    if (!byBrand.has(brand)) byBrand.set(brand, { brand, total: 0, ready: 0 });
    const rec = byBrand.get(brand);
    rec.total += 1;
    if (r.classification === BOT_CLASSES.NONE && Number(r.httpStatus) === 200) rec.ready += 1;
  }

  const brandRates = [...byBrand.values()]
    .sort((a, b) => a.brand.localeCompare(b.brand))
    .map((rec) => ({
      ...rec,
      passRate: rec.total ? `${Math.round((rec.ready / rec.total) * 100)}%` : '0%',
    }));

  const ready = rows.filter((r) => r.classification === BOT_CLASSES.NONE && Number(r.httpStatus) === 200);

  return { summary, brandRates, ready };
}
