import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DDL, DEFAULTS, TABLES, addDays, assertYmd, canStartNow, dealerRanges, deriveEvents, excludedSet, isWriteSql, marketSql, parseExcludedEnv,
  parseSyncLogTail, pastStop, priceDiffValidationSql, stratifiedSample, summaryRow, summarySql, dropsSql,
} from "./dealerAnalyticsCore.js";
import { StopError, buildSummary, readOnlyQuery, runBackfill, runGuarded, runNightly } from "./dealerAnalyticsRun.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const EDT_NOON = new Date("2026-10-31T16:00:00Z"); // 12:00 ET (EDT)
const cfg = { ...DEFAULTS, throttleMs: 0, lockPollMs: 1, lockWaitMs: 5000, gateCheckEvery: 2 };

// ---- derivation ----------------------------------------------------------------------------------------------------------
const row = (vin, dealer_id, seen_on, price) => ({ vin, dealer_id, seen_on, price });

test("deriveEvents records a change on the first day seen at the new price, using rows before the window as the previous price", () => {
  const rows = [row("V1", 5, "2026-10-28", 30000), row("V1", 5, "2026-10-29", 30000), row("V1", 5, "2026-10-30", 29000), row("V1", 5, "2026-10-31", 29000)];
  assert.deepEqual(deriveEvents(rows, { fromDate: "2026-10-30" }), [[5, "2026-10-30", "V1", "2026-10-29", 30000, 29000]]);
  assert.deepEqual(deriveEvents(rows, { fromDate: "2026-10-31" }), []);
});

test("deriveEvents: gaps date the change when first observed, null/zero prices are skipped, input order does not matter", () => {
  const rows = [row("V1", 5, "2026-10-30", 31000), row("V1", 5, "2026-10-20", 30000), row("V1", 5, "2026-10-25", null), row("V1", 5, "2026-10-26", 0)];
  assert.deepEqual(deriveEvents(rows), [[5, "2026-10-30", "V1", "2026-10-20", 30000, 31000]]);
});

test("deriveEvents keeps stores apart, excludes dealer 0 and the excluded ids, and returns primary-key order", () => {
  const rows = [
    row("B", 9, "2026-10-01", 100), row("B", 9, "2026-10-02", 90),
    row("A", 9, "2026-10-01", 100), row("A", 9, "2026-10-02", 95),
    row("A", 3, "2026-10-01", 100), row("A", 3, "2026-10-03", 110),
    row("Z", 0, "2026-10-01", 100), row("Z", 0, "2026-10-02", 1),
    row("Y", 16951, "2026-10-01", 100), row("Y", 16951, "2026-10-02", 1),
  ];
  const ev = deriveEvents(rows, { excluded: excludedSet() });
  assert.deepEqual(ev.map((e) => [e[0], e[1], e[2]]), [[3, "2026-10-03", "A"], [9, "2026-10-02", "A"], [9, "2026-10-02", "B"]]);
});

test("exclusions: dealer 0 is always out; 16951 is out by default and the list is configurable", () => {
  assert.ok(excludedSet().has(0) && excludedSet().has(16951));
  assert.ok(excludedSet([]).has(0) && !excludedSet([]).has(16951));
  assert.deepEqual(parseExcludedEnv(undefined), [16951]);
  assert.deepEqual(parseExcludedEnv("16951, 14802"), [16951, 14802]);
  assert.throws(() => excludedSet(["abc"]));
});

// ---- SQL / DDL --------------------------------------------------------------------------------------------------------
test("DDL creates exactly the four new tables and never touches existing ones", () => {
  assert.equal(DDL.length, 4);
  const names = DDL.map((s) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(s)[1]).sort();
  assert.deepEqual(names, Object.values(TABLES).sort());
  for (const s of DDL) assert.ok(!/\b(ALTER|DROP|TRUNCATE|DELETE)\b/i.test(s));
});

test("no source file writes to dealer_inventory, dealer_inventory_days or dealer_inventory_options", () => {
  const files = fs.readdirSync(dir).filter((n) => /^(dealerAnalytics(Core|Run)\.js|dealerAnalyticsBox\.mjs|dealer-analytics-.*\.mjs)$/.test(n));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/(INSERT (IGNORE )?INTO|UPDATE|DELETE FROM|ALTER TABLE|REPLACE INTO|TRUNCATE TABLE)\s+dealer_inventory(_days|_options)?\b/i.test(src), `${f} writes to an existing table`);
  }
});

test("SQL builders: dates are validated, exclusions are embedded, dealer ranges cover every id once", () => {
  assert.throws(() => summarySql("2026-10-31'; DROP TABLE x;--", excludedSet()));
  assert.throws(() => dropsSql("nope"));
  assert.match(summarySql("2026-10-31", excludedSet()), /dealer_id NOT IN \(16951\)/);
  assert.match(marketSql(excludedSet([])), /dealer_id > 0/);
  assert.ok(!/NOT IN/.test(marketSql(excludedSet([]))));
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.throws(() => assertYmd("2026-13-40"));
  assert.deepEqual(dealerRanges(10, 4), [[1, 4], [5, 8], [9, 10]]);
  assert.deepEqual(dealerRanges(0, 4), []);
  assert.equal(isWriteSql("  INSERT INTO t VALUES ?"), true);
  assert.equal(isWriteSql("WITH a AS (SELECT 1) SELECT * FROM a"), false);
});

test("summaryRow fills missing drop stats with zeros/NULLs in column order", () => {
  const r = summaryRow("2026-10-31", { dealer_id: "7", active_units: "10", new_units: "4", used_units: "6", priced_units: "9", avg_price: "30000", avg_dom: "12.5", age_0_30: "8", age_31_60: "1", age_61_90: "1", age_90_plus: "0", added_units: "2", removed_units: "1", added_7d: "5", removed_7d: "3" }, null, "2026-10-31 12:00:00");
  assert.equal(r.length, 23);
  assert.deepEqual(r.slice(16, 22), [0, 0, null, null, null, null]);
  assert.equal(r[22], "2026-10-31 12:00:00");
});

// ---- windows ---------------------------------------------------------------------------------------------------------------
test("run window is evaluated in New York time across DST", () => {
  assert.equal(canStartNow(new Date("2026-07-15T14:00:00Z")), true); // 10:00 EDT
  assert.equal(canStartNow(new Date("2026-01-15T14:00:00Z")), true); // 09:00 EST
  assert.equal(canStartNow(new Date("2026-07-15T09:00:00Z")), false); // 05:00 EDT
  assert.equal(canStartNow(new Date("2026-07-15T22:30:00Z")), false); // 18:30 EDT
  assert.equal(pastStop(new Date("2026-07-16T01:00:00Z")), false); // 21:00 EDT
  assert.equal(pastStop(new Date("2026-07-16T01:45:00Z")), true); // 21:45 EDT
  assert.equal(pastStop(new Date("2026-01-16T02:45:00Z")), true); // 21:45 EST
});

test("parseSyncLogTail: finished only when the log ends with the run summary, is quiet, and is recent", () => {
  const summary = '2026-10-30 09:42:38 {"upserted":348803,"sweptStores":977}';
  const base = { tail: `x\n2026-10-30 09:42:38 [sync] retired list: 1\n${summary}\n`, mtimeMs: 1_000_000_000, nowMs: 1_000_000_000 + 3600_000 };
  assert.equal(parseSyncLogTail(base).finished, true);
  assert.equal(parseSyncLogTail({ ...base, nowMs: base.mtimeMs + 30_000 }).finished, false);
  assert.equal(parseSyncLogTail({ ...base, nowMs: base.mtimeMs + 21 * 3600_000 }).finished, false);
  assert.equal(parseSyncLogTail({ ...base, tail: "[run_sync_when_safe] crawl still active (lock driver.lock held by pid 1) — waiting 300s\n" }).finished, false);
});

// ---- guards ------------------------------------------------------------------------------------------------------------------
function fakeDeps(over = {}) {
  const calls = [];
  let t = EDT_NOON.getTime();
  let lost = false;
  const deps = {
    calls,
    setLost: () => { lost = true; },
    advance: (ms) => { t += ms; },
    now: () => new Date(t),
    sleep: async (ms) => { t += ms; },
    log: () => {},
    owner: "test-owner",
    syncStatus: async () => { calls.push("syncStatus"); return { finished: true, finishedAt: new Date(t - 3600_000) }; },
    checkCrawlGate: async () => { calls.push("gate"); return ""; },
    lockApi: async (p) => { calls.push(p.split("/").pop()); return p.endsWith("acquire") ? { acquired: true } : {}; },
    startHeartbeat: () => { calls.push("heartbeat-start"); return { stop: () => calls.push("heartbeat-stop"), isLost: () => lost }; },
    q: async () => [],
    ...over,
  };
  return deps;
}

test("runGuarded: checks sync, then the crawl gate, then takes the lock, runs, and releases", async () => {
  const deps = fakeDeps();
  const r = await runGuarded({ deps, cfg, work: async () => { deps.calls.push("work"); return { done: true }; } });
  assert.equal(r.status, "ok");
  assert.deepEqual(deps.calls, ["syncStatus", "gate", "acquire", "heartbeat-start", "work", "heartbeat-stop", "release"]);
});

test("runGuarded: nothing is locked or run when the sync is unfinished, a crawl is active, or it is outside the window", async () => {
  for (const [over, re] of [
    [{ syncStatus: async () => ({ finished: false, detail: "still going" }) }, /sync not finished/],
    [{ checkCrawlGate: async () => "driver.lock held by pid 9" }, /crawl active/],
    [{ now: () => new Date("2026-10-31T23:30:00Z") }, /start window/],
  ]) {
    const deps = fakeDeps(over);
    let ran = false;
    const r = await runGuarded({ deps, cfg, work: async () => { ran = true; } });
    assert.equal(r.status, "not-ready");
    assert.match(r.reason, re);
    assert.equal(ran, false);
    assert.ok(!deps.calls.includes("acquire"));
  }
});

test("runGuarded: a lock that never frees is a not-ready result, and nothing runs", async () => {
  const deps = fakeDeps({ lockApi: async () => ({ acquired: false, heldBy: "box3-sync", heldSinceMs: 5 }) });
  let ran = false;
  const r = await runGuarded({ deps, cfg: { ...cfg, lockWaitMs: 3000 }, work: async () => { ran = true; } });
  assert.equal(r.status, "not-ready");
  assert.match(r.reason, /lock-timeout/);
  assert.equal(ran, false);
});

test("runGuarded: an error in the work propagates and still releases the lock", async () => {
  const deps = fakeDeps();
  await assert.rejects(runGuarded({ deps, cfg, work: async () => { throw new Error("boom"); } }), /boom/);
  assert.deepEqual(deps.calls.slice(-2), ["heartbeat-stop", "release"]);
});

test("checkpoint stops the run at 21:30 ET, when the lock is lost, and when a crawl starts — and the lock is released each time", async () => {
  const cases = [
    ["deadline", (d) => d.advance(10 * 3600_000), null],
    ["lock-lost", (d) => d.setLost(), null],
    ["crawl-active", () => {}, "driver.lock held by pid 9"],
  ];
  for (const [code, trigger, gateReason] of cases) {
    const deps = fakeDeps();
    let gateOn = false;
    deps.checkCrawlGate = async () => { deps.calls.push("gate"); return gateOn ? gateReason : ""; };
    await assert.rejects(
      runGuarded({ deps, cfg, work: async (ctx) => { await ctx.checkpoint(); trigger(deps); gateOn = true; await ctx.checkpoint(); await ctx.checkpoint(); } }),
      (err) => err instanceof StopError && err.code === code,
    );
    assert.equal(deps.calls.at(-1), "release");
  }
});

// ---- nightly + backfill steps ---------------------------------------------------------------------------------------------------------
function scriptedQ(log, { failOn = null } = {}) {
  return async (sql, params) => {
    log.push(sql);
    if (failOn && failOn.test(sql)) throw new Error("db exploded");
    if (/FROM dealer_analytics_runs/.test(sql) && /COUNT/.test(sql)) return [{ n: 0 }];
    if (/SELECT NOW\(\)/.test(sql)) return [{ n: "2026-10-31 12:00:00" }];
    if (/last_seen_at >= \?/.test(sql)) return params[0].startsWith("2026-10-29") ? [{ vin: "V1", dealer_id: 5 }, { vin: "V2", dealer_id: 16951 }, { vin: "V3", dealer_id: 0 }] : [];
    if (/FROM dealer_inventory_days/.test(sql)) { (log.daysVins ||= []).push(...params[0]); return [row("V1", 5, "2026-10-30", 30000), row("V1", 5, "2026-10-31", 28000)]; }
    if (/^SELECT make FROM/.test(sql)) return [{ make: "Toyota" }];
    if (/AND make = \?/.test(sql)) return [{ model: "Camry", year: 2025, cond: "new", units: 3, dealers: 2, avg_price: 29000 }];
    if (/MAX\(dealer_id\)/.test(sql)) return [{ m: 300 }];
    if (/AS active_units/.test(sql)) return [{ dealer_id: 5, active_units: 10, new_units: 4, used_units: 6, priced_units: 9, avg_price: 30000, avg_dom: 12.5, age_0_30: 8, age_31_60: 1, age_61_90: 1, age_90_plus: 0, added_units: 2, removed_units: 1, added_7d: 5, removed_7d: 3 }];
    if (/FROM dealer_price_changes WHERE dealer_id BETWEEN/.test(sql)) return [{ dealer_id: 5, drop_units_7d: 1, drop_units_30d: 1, avg_drop_usd_7d: 2000, avg_drop_pct_7d: 6.67, avg_drop_usd_30d: 2000, avg_drop_pct_30d: 6.67 }];
    if (/^INSERT IGNORE/.test(sql)) return { affectedRows: params[0].length };
    return [];
  };
}
const writes = (log) => log.filter((s) => isWriteSql(s));

test("nightly: creates tables, writes changes then market then summary, marks the run ok, never touches excluded dealers", async () => {
  const log = [];
  const deps = fakeDeps({ q: scriptedQ(log) });
  const r = await runNightly({ deps, cfg, excluded: excludedSet() });
  assert.equal(r.status, "ok");
  assert.equal(r.changes.events, 1);
  assert.equal(r.changes.drops, 1);
  const w = writes(log).map((s) => /(?:INTO|UPDATE|TABLE IF NOT EXISTS) (\w+)/.exec(s)[1]);
  assert.deepEqual(w.slice(0, 4), ["dealer_price_changes", "dealer_daily_summary", "market_price_daily", "dealer_analytics_runs"]);
  const order = w.slice(4).filter((n, i, a) => a.indexOf(n) === i && !(n === "dealer_analytics_runs" && i < 3));
  assert.ok(order.indexOf("dealer_price_changes") < order.indexOf("market_price_daily") && order.indexOf("market_price_daily") < order.indexOf("dealer_daily_summary"));
  assert.match(log.at(-1), /SET status = 'ok'/);
  assert.deepEqual(deps.calls.slice(-1), ["release"]);
  // the excluded dealers' candidates (16951, 0) were dropped before the days lookup
  assert.deepEqual(log.daysVins, ["V1"]);
});

test("nightly: any error stops the run — later steps are skipped, the run is marked failed, the lock is released", async () => {
  const log = [];
  const deps = fakeDeps({ q: scriptedQ(log, { failOn: /INSERT INTO market_price_daily/ }) });
  await assert.rejects(runNightly({ deps, cfg, excluded: excludedSet() }), /db exploded/);
  assert.ok(!log.some((s) => /INSERT INTO dealer_daily_summary/.test(s)), "summary must not run after a failed step");
  assert.ok(log.some((s) => /SET status = 'failed'/.test(s)));
  assert.equal(deps.calls.at(-1), "release");
});

test("nightly: a day that already finished after this sync is skipped without taking the lock", async () => {
  const log = [];
  const q = async (sql, params) => { log.push(sql); return /COUNT\(\*\) AS n FROM dealer_analytics_runs/.test(sql) ? [{ n: 1 }] : []; };
  const deps = fakeDeps({ q });
  const r = await runNightly({ deps, cfg, excluded: excludedSet() });
  assert.equal(r.status, "already-done");
  assert.ok(!deps.calls.includes("acquire"));
  assert.equal(writes(log).length, 0);
});

test("nightly --dry-run: no write statement reaches the database, no lock is taken", async () => {
  const log = [];
  const deps = fakeDeps({ q: scriptedQ(log) });
  const r = await runNightly({ deps, cfg, excluded: excludedSet(), dryRun: true });
  assert.equal(r.status, "ok");
  assert.equal(r.changes.events, 1);
  assert.equal(writes(log).length, 0);
  assert.ok(!deps.calls.includes("acquire") && !deps.calls.includes("release"));
});

test("readOnlyQuery refuses writes before they reach the database", async () => {
  let reached = 0;
  const q = readOnlyQuery(async () => { reached += 1; return []; });
  await q("SELECT 1");
  await assert.rejects(q("INSERT INTO dealer_price_changes VALUES ?", [[]]), /dry run/);
  await assert.rejects(q("CREATE TABLE IF NOT EXISTS x (a INT)"), /dry run/);
  assert.equal(reached, 1);
});

test("buildSummary writes dealers in key order from the per-range queries", async () => {
  const log = [];
  const ctx = { checkpoint: async () => {} };
  const out = await buildSummary({ q: scriptedQ(log), ctx, cfg: { ...cfg, dealerChunk: 250 }, excluded: excludedSet(), day: "2026-10-31", dryRun: false, log: () => {}, computedAt: "2026-10-31 12:00:00" });
  assert.equal(out.dealers, 2); // two ranges (1-250, 251-300), the scripted query returns one dealer for each
  assert.equal(log.filter((s) => /INSERT INTO dealer_daily_summary/.test(s)).length, 2);
});

test("backfill: dry run counts without writing or locking; apply writes, saves progress, and releases the lock", async () => {
  const mk = (log) => async (sql, params) => {
    log.push(sql);
    if (/SELECT DISTINCT vin/.test(sql)) return params[0] === "" ? [{ vin: "V1" }, { vin: "V2" }] : [];
    if (/FROM dealer_inventory_days/.test(sql)) return [row("V1", 5, "2026-10-01", 100), row("V1", 5, "2026-10-02", 90), row("V2", 6, "2026-10-01", 50), row("V2", 6, "2026-10-02", 60)];
    if (/^INSERT IGNORE/.test(sql)) return { affectedRows: params[0].length };
    return [];
  };
  const dryLog = [];
  const dry = fakeDeps({ q: mk(dryLog) });
  const d = await runBackfill({ deps: dry, cfg, excluded: excludedSet(), apply: false });
  assert.equal(d.status, "ok");
  assert.equal(d.stats.events, 2);
  assert.equal(writes(dryLog).length, 0);
  assert.ok(!dry.calls.includes("acquire"));

  const log = [];
  const saved = [];
  const deps = fakeDeps({ q: mk(log) });
  const r = await runBackfill({ deps, cfg, excluded: excludedSet(), apply: true, saveState: async (s) => saved.push(s) });
  assert.equal(r.stats.inserted, 2);
  assert.equal(saved.at(-1).lastVin, "V2");
  assert.equal(deps.calls.at(-1), "release");
});

test("backfill pauses cleanly at the stop time and keeps its place", async () => {
  const log = [];
  const deps = fakeDeps();
  deps.q = async (sql, params) => {
    log.push(sql);
    if (/SELECT DISTINCT vin/.test(sql)) { deps.advance(10 * 3600_000); return [{ vin: `V${params[0] || "0"}` }]; }
    if (/FROM dealer_inventory_days/.test(sql)) return [];
    return [];
  };
  const saved = [];
  const r = await runBackfill({ deps, cfg, excluded: excludedSet(), apply: true, saveState: async (s) => saved.push(s) });
  assert.equal(r.status, "ok");
  assert.equal(r.paused, true);
  assert.equal(saved.length, 1);
  assert.equal(deps.calls.at(-1), "release");
});

// ---- probe ------------------------------------------------------------------------------------------------------------------------------
test("probe: the stratified sample is deterministic and spans the size bands; its SQL is read-only and rejects non-numeric ids", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ dealer_id: i + 1, units: (i + 1) * 3 }));
  const a = stratifiedSample(rows, 4);
  assert.equal(a.length, 20);
  assert.equal(new Set(a).size, 20);
  assert.deepEqual(a, stratifiedSample(rows, 4));
  assert.ok(Math.max(...a) > 900 && Math.min(...a) < 250);
  const sql = priceDiffValidationSql([1, 2, 3]);
  assert.equal(isWriteSql(sql), false);
  assert.match(sql, /IN \(1,2,3\)/);
  assert.throws(() => priceDiffValidationSql(["1) OR (1=1"]));
});

test("the nightly wrapper script passes bash -n and takes a flock", () => {
  const src = fs.readFileSync(path.join(dir, "run_dealer_analytics.sh"), "utf8");
  assert.match(src, /flock -n/);
  assert.match(src, /dealer-analytics-nightly\.mjs/);
});
