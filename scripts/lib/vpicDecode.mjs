// NHTSA vPIC batch decode for the make-vs-VIN dry run: one representative VIN per (WMI + VDS) prefix goes to the free DecodeVINValuesBatch endpoint
// (<= 50 VINs per POST), and the answer is cached in a local JSON file keyed by the 8-character prefix, never by the VIN. The make is fixed by the
// prefix (WMI + VDS), so one VIN per prefix is enough. Polite by design: one request at a time, a pause between requests, a request cap, and a stop
// after consecutive failed batches. A failed batch is not cached, so a rerun retries it. No VIN is written to the cache or printed.
import fs from "node:fs";

export const VPIC_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/";
export const prefix8 = (vin) => String(vin ?? "").toUpperCase().slice(0, 8);

export function loadCache(file) {
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return j && typeof j === "object" && j.makes ? j : { makes: {} }; } catch { return { makes: {} }; }
}
export function saveCache(file, cache) { // write then rename: an interrupted run never leaves half a file
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache)); fs.renameSync(`${file}.tmp`, file);
}

/**
 * items: [{ key8, vin }] (one VIN per prefix). Fills `cache.makes[key8]` with the decoded make ("" when vPIC answered but named none).
 * Returns { requested, cached, decoded, failed, requests, stopped } counts only. opts: cachePath, fetchImpl, pauseMs (default 1500), batchSize (<=50),
 * maxRequests, maxFailures (consecutive, default 3), sleep, shouldStop (e.g. past the deadline).
 */
export async function decodePrefixes(items, cache, opts = {}) {
  const { cachePath, url = VPIC_URL, fetchImpl = fetch, pauseMs = 1500, batchSize = 50, maxRequests = 200, maxFailures = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), shouldStop = () => false } = opts;
  const todo = []; const seen = new Set(); let cached = 0;
  for (const it of items) {
    if (seen.has(it.key8)) continue; seen.add(it.key8);
    if (Object.hasOwn(cache.makes, it.key8)) cached++; else todo.push(it);
  }
  const out = { requested: seen.size, cached, decoded: 0, failed: 0, requests: 0, stopped: null };
  let consecutive = 0;
  for (let i = 0; i < todo.length; i += Math.min(batchSize, 50)) {
    if (shouldStop()) { out.stopped = "deadline"; break; }
    if (out.requests >= maxRequests) { out.stopped = `request cap (${maxRequests})`; break; }
    const batch = todo.slice(i, i + Math.min(batchSize, 50));
    out.requests++;
    let results = null;
    try {
      const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ format: "json", data: batch.map((b) => b.vin).join(";") }).toString(), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`vPIC HTTP ${res.status}`);
      results = (await res.json()).Results;
      if (!Array.isArray(results)) throw new Error("vPIC: no Results array");
    } catch { results = null; }
    if (!results) {
      out.failed += batch.length; consecutive++;
      if (consecutive >= maxFailures) { out.stopped = `${maxFailures} failed batches in a row`; break; }
    } else {
      consecutive = 0;
      const byVin = new Map(results.map((r) => [String(r.VIN ?? "").toUpperCase(), r]));
      for (const b of batch) {
        const r = byVin.get(b.vin.toUpperCase());
        if (!r) { out.failed++; continue; } // vPIC skipped it: leave uncached so a rerun tries again
        cache.makes[b.key8] = String(r.Make ?? "").trim(); out.decoded++;
      }
      if (cachePath) saveCache(cachePath, cache); // after every good batch: a stopped run keeps its progress
    }
    if (i + batchSize < todo.length) await sleep(pauseMs);
  }
  return out;
}
