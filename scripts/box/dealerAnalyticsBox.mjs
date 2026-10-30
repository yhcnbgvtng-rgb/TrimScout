// Real-box wiring for the Dealer Analytics CLIs (dealer-analytics-nightly / -backfill / -probe). Runs on box2 only.
// Env (sourced from ~/dealer-analytics/.env by run_dealer_analytics.sh):
//   DB_HOST DB_PORT DB_NAME + DB_WRITER_USER/DB_WRITER_PASSWORD (writes) or DB_READER_USER/DB_READER_PASSWORD (dry runs, probe)
//   TRIMSCOUT_API_KEY, optional TRIMSCOUT_DEALS_HOST (default 127.0.0.1) / TRIMSCOUT_DEALS_PORT (default 3004)
//   DEALER_ANALYTICS_MYSQL2_FROM  package.json whose node_modules holds mysql2 (default /opt/trimscout-deals/package.json)
//   SYNC_LOG_DIR, CRAWL_RUNS_DIR, CRAWL_GATE_SCRIPT  (defaults are box2's paths)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile, execFileSync } from "node:child_process";
import { createApi } from "./syncHttp.js";
import { DEFAULTS, parseSyncLogTail } from "./dealerAnalyticsCore.js";

const HOME = os.homedir();
const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (source ~/dealer-analytics/.env)`);
  return v;
};

export const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function makePool({ readOnly }) {
  const require = createRequire(process.env.DEALER_ANALYTICS_MYSQL2_FROM || "/opt/trimscout-deals/package.json");
  const mysql = require("mysql2/promise");
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    database: need("DB_NAME"),
    user: need(readOnly ? "DB_READER_USER" : "DB_WRITER_USER"),
    password: need(readOnly ? "DB_READER_PASSWORD" : "DB_WRITER_PASSWORD"),
    connectionLimit: 2,
    dateStrings: true,
    waitForConnections: true,
  });
  // Every pooled connection: a per-statement time cap (a runaway statement fails the run instead of hanging it) and fail-fast row locks.
  pool.pool.on("connection", (conn) => {
    conn.query(`SET SESSION max_statement_time = ${Number(DEFAULTS.statementCapSeconds)}`);
    conn.query("SET SESSION innodb_lock_wait_timeout = 10");
    if (readOnly) conn.query("SET SESSION TRANSACTION READ ONLY");
  });
  const q = async (sql, params) => (await pool.query(sql, params))[0];
  return { pool, q, close: () => pool.end() };
}

export function syncStatus() {
  const dir = process.env.SYNC_LOG_DIR || path.join(HOME, "inventory-sync", "logs");
  try {
    execFileSync("pgrep", ["-f", "node .*inventory-sync\\.mjs"], { stdio: "pipe" });
    return Promise.resolve({ finished: false, detail: "an inventory-sync.mjs process is running on this box" });
  } catch { /* pgrep exits 1 when nothing matches: no sync running */ }
  const logs = fs.readdirSync(dir).filter((n) => /^sync-\d{4}-\d{2}-\d{2}\.log$/.test(n)).map((n) => ({ n, st: fs.statSync(path.join(dir, n)) })).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  if (!logs.length) return Promise.resolve({ finished: false, detail: `no sync logs in ${dir}` });
  const { n, st } = logs[0];
  const fd = fs.openSync(path.join(dir, n), "r");
  try {
    const len = Math.min(4096, st.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    return Promise.resolve(parseSyncLogTail({ tail: buf.toString("utf8"), mtimeMs: st.mtimeMs, nowMs: Date.now() }));
  } finally {
    fs.closeSync(fd);
  }
}

/** '' = no crawl running (box2's own gate script: every driver*.lock plus a crawl-process check). Exit 1 = busy; anything else throws. */
export function checkCrawlGate() {
  const script = process.env.CRAWL_GATE_SCRIPT || path.join(HOME, "nj-scraper/scrapers/lightsail-crawler/scripts/check-crawl-gate.mjs");
  const runsDir = process.env.CRAWL_RUNS_DIR || path.join(HOME, "nj-scraper/scrapers/lightsail-crawler/data/daily_crawl_runs");
  return new Promise((resolve, reject) => {
    execFile("node", [script, runsDir], { encoding: "utf8" }, (err, stdout) => {
      if (!err) return resolve("");
      if (err.code === 1) return resolve(String(stdout).trim() || "crawl gate reports busy");
      reject(new Error(`crawl gate check failed: ${err.message}`));
    });
  });
}

export function makeLockApi() {
  const api = createApi({ host: process.env.TRIMSCOUT_DEALS_HOST || "127.0.0.1", key: need("TRIMSCOUT_API_KEY"), timeouts: { lock: 10_000 } });
  const port = process.env.TRIMSCOUT_DEALS_PORT || "3004";
  return (pathName, body) => api(port, pathName, body);
}

export function makeDeps({ q }) {
  return {
    q,
    dbNow: async () => (await q("SELECT NOW() AS n"))[0].n,
    now: () => new Date(),
    sleep,
    log,
    syncStatus,
    checkCrawlGate,
    lockApi: makeLockApi(),
    owner: `dealer-analytics-${os.hostname()}-${process.pid}`,
  };
}

/** Maps a runGuarded result / thrown error to the process exit code: 0 ok or already done, 2 not ready (nothing written), 4 deadline, 1 error. */
export function exitCodeFor(result) {
  if (result.status === "ok" || result.status === "already-done") return 0;
  if (result.status === "not-ready") return 2;
  return 1;
}
