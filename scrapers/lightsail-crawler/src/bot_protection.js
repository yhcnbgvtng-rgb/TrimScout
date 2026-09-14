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
  TIMEOUT: 'TIMEOUT',
  TLS: 'TLS',
  OTHER: 'OTHER',
});

export const BOT_PROTECTED_CLASSES = new Set([
  BOT_CLASSES.CLOUDFLARE,
  BOT_CLASSES.VERCEL_CHECKPOINT,
  BOT_CLASSES.HTTP_403,
  BOT_CLASSES.HTTP_429,
  BOT_CLASSES.TIMEOUT,
  BOT_CLASSES.TLS,
  BOT_CLASSES.OTHER,
]);

export function isBotProtected(classification) {
  return classification && classification !== BOT_CLASSES.NONE;
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

export function classifyFetchError(err) {
  const msg = err instanceof Error ? err.message : String(err || 'unknown error');
  if (/timeout|etimedout|esockettimedout|aborted|abort|Fetch timeout/i.test(msg)) {
    return { classification: BOT_CLASSES.TIMEOUT, httpStatus: null, notes: msg.slice(0, 300) };
  }
  if (/ssl|tls|cert|unable_to_verify|eproto|certificate|ERR_TLS/i.test(msg)) {
    return { classification: BOT_CLASSES.TLS, httpStatus: null, notes: msg.slice(0, 300) };
  }
  return { classification: BOT_CLASSES.OTHER, httpStatus: null, notes: msg.slice(0, 300) };
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
    };
  }

  if (looksVercel || (status === 429 && /vercel/i.test(`${sample}\n${headerHay}`))) {
    return {
      classification: BOT_CLASSES.VERCEL_CHECKPOINT,
      httpStatus: status || null,
      notes: 'Vercel Security Checkpoint',
    };
  }

  if (status === 429) {
    return { classification: BOT_CLASSES.HTTP_429, httpStatus: 429, notes: 'HTTP 429 Too Many Requests' };
  }
  if (status === 403) {
    return { classification: BOT_CLASSES.HTTP_403, httpStatus: 403, notes: 'HTTP 403 Forbidden' };
  }
  if (status >= 200 && status < 400) {
    return { classification: BOT_CLASSES.NONE, httpStatus: status, notes: '' };
  }
  if (!status) {
    return { classification: BOT_CLASSES.OTHER, httpStatus: null, notes: 'No HTTP status' };
  }
  return { classification: BOT_CLASSES.OTHER, httpStatus: status, notes: `HTTP ${status}` };
}
