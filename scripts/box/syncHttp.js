// HTTP transport + retry policy for inventory-sync.mjs. Pure node:http, no dependencies, so it can be
// copied to a box next to the other sync files with nothing to install.
//
// Why not the global fetch(): its undici dispatcher aborts any request whose response headers take
// longer than 300s (HeadersTimeoutError) and node:http exposes no way to raise that. A bulk upsert or a
// sweep UPDATE on a loaded deals box can legitimately take longer than that — the server keeps running
// the statement after the client gives up, so the retry piles a SECOND copy of the same heavy statement
// on top of the first (box1 2026-10-01, box4 2026-09-28/29: the run died on that error, after hours of
// upserting). Here every request gets an explicit, generous deadline per kind of call, and every failure
// carries a `retryable` verdict instead of every error being retried the same way.

import http from "node:http";

export class ApiError extends Error {
  constructor(message, { status = null, code = null, retryable = false, path = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.path = path;
  }
}

// 4xx other than "slow down / try again" is deterministic — resending the same request can't fix it —
// so those fail immediately instead of burning the whole retry budget (the old client retried a 400 six
// times, 30s each time it happened).
export const isRetryableStatus = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

// Milliseconds. A request is only ever given up on after this long with NO complete response, which for
// the two heavy calls is far beyond anything a healthy-but-loaded deals box needs.
export const DEFAULT_TIMEOUTS_MS = Object.freeze({
  lock: 20_000, // acquire / heartbeat / release: must stay snappy so a stuck call can't mask a lost lock
  directory: 120_000, // GET /api/dealerships (read once at start)
  bulk: 20 * 60_000, // POST /api/inventory/bulk
  sweep: 20 * 60_000, // POST /api/inventory/sweep
  stats: 90_000, // GET /api/inventory/stats — only feeds a log line
  other: 5 * 60_000,
});

export function timeoutKindFor(path) {
  if (path.startsWith("/api/ops/sync-lock/")) return "lock";
  if (path.startsWith("/api/inventory/bulk")) return "bulk";
  if (path.startsWith("/api/inventory/sweep")) return "sweep";
  if (path.startsWith("/api/inventory/stats")) return "stats";
  if (path.startsWith("/api/dealerships")) return "directory";
  return "other";
}

/**
 * One request, one deadline (covers connect + send + the whole response, not just idle time, so a slow
 * trickle can't hold it open forever). Resolves the parsed JSON body (null if the body is empty or not
 * JSON); rejects with an ApiError that says whether retrying could help.
 * `body` may be an object (serialized here) or an already-serialized JSON string (sent as-is — the upsert
 * path builds its body incrementally so it can cap the byte size, see syncBatching.js).
 */
export function requestJson({ host, port, path, method, headers = {}, body = null, timeoutMs, request = http.request }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
    let timer = null;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (err) =>
      finish(
        reject,
        err instanceof ApiError ? err : new ApiError(`${path} -> ${err && (err.code || err.message) ? err.code || err.message : "request failed"}`, { code: (err && err.code) || "ECONNERR", retryable: true, path })
      );
    const req = request(
      {
        host,
        port,
        path,
        method,
        agent: false, // a fresh connection per request: no keep-alive race with the server's 5s idle close
        headers: { ...headers, ...(payload != null ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", fail);
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* not JSON — handled by status below */ }
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) return finish(resolve, json);
          finish(reject, new ApiError(`${path} -> ${status} ${json && json.error ? json.error : ""}`.trim(), { status, retryable: isRetryableStatus(status), path }));
        });
      }
    );
    req.on("error", fail);
    timer = setTimeout(() => req.destroy(new ApiError(`${path} -> no response within ${Math.round(timeoutMs / 1000)}s`, { code: "ETIMEDOUT", retryable: true, path })), timeoutMs);
    if (payload != null) req.write(payload);
    req.end();
  });
}

/** api(port, path, body?, { timeoutMs? }) bound to one host + API key. GET when there is no body, POST otherwise. */
export function createApi({ host, key, timeouts = {}, request = http.request }) {
  const limits = { ...DEFAULT_TIMEOUTS_MS, ...timeouts };
  return (port, path, body, opts = {}) =>
    requestJson({
      host,
      port: Number(port),
      path,
      method: body == null ? "GET" : "POST",
      headers: { "X-Trimscout-Api-Key": key },
      body,
      timeoutMs: opts.timeoutMs ?? limits[timeoutKindFor(path)],
      request,
    });
}

/**
 * Retry `fn` while `shouldRetry(err)` says another attempt could help. Delay before attempt n+1 is
 * min(maxDelayMs, delayMs * factor^n). `retries` counts re-attempts (retries:6 = up to 7 tries).
 * Errors that are not ApiErrors (programming errors) are never retried.
 */
export async function withRetry(fn, { retries = 1, delayMs = 3000, factor = 1, maxDelayMs = 60_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), shouldRetry = (err) => err instanceof ApiError && err.retryable, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const wait = Math.min(maxDelayMs, Math.round(delayMs * factor ** attempt));
      if (onRetry) onRetry({ attempt: attempt + 1, retries, waitMs: wait, err });
      await sleep(wait);
    }
  }
}
