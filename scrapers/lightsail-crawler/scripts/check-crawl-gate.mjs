#!/usr/bin/env node
// Thin real-filesystem/process wrapper around syncCrawlGate.js's pure evaluateCrawlGate() — used
// by run_sync_when_safe.sh (and any future equivalent sync entrypoint) so the exact logic
// covered by syncCrawlGate.test.js is what actually runs live, not a hand-mirrored bash copy
// that could silently drift from it.
//
// Usage: node check-crawl-gate.mjs <runsDir>
//   Exit 0, nothing printed: no crawl lock or process active — safe to proceed.
//   Exit 1, one line printed to stdout: still busy; that line is the human-readable reason.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { isProcessAlive } from "../src/pid_lock.js";
import { evaluateCrawlGate } from "../src/syncCrawlGate.js";

const runsDir = process.argv[2];
if (!runsDir) {
  console.error("usage: check-crawl-gate.mjs <runsDir>");
  process.exit(2);
}

// Every driver*.lock file in the run-tracking directory — driver.lock itself (the default,
// unlabeled crawl) plus driver-<label>.lock for any CRAWLER_RUN_LABEL (today just 'core', but
// this doesn't need to know that name in advance).
let lockEntries = [];
try {
  for (const name of fs.readdirSync(runsDir)) {
    if (!/^driver.*\.lock$/.test(name)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(runsDir, name), "utf8"));
      lockEntries.push({ name, pid: typeof data.pid === "number" ? data.pid : null });
    } catch {
      lockEntries.push({ name, pid: null });
    }
  }
} catch {
  // runsDir doesn't exist yet (e.g. a brand-new box before its first crawl) — no locks possible.
}

// Independent of the lock files entirely — the second signal evaluateCrawlGate's own header
// comment explains the need for.
let crawlProcessPid = null;
try {
  const out = execSync("pgrep -f 'node .*scripts/run-daily-crawl\\.mjs'", { encoding: "utf8" }).trim();
  const first = out.split("\n")[0];
  crawlProcessPid = first ? Number(first) : null;
} catch {
  // pgrep exits non-zero when nothing matches — that's "not running", not an error.
  crawlProcessPid = null;
}

const { busy, reason } = evaluateCrawlGate({ lockEntries, crawlProcessPid, isPidAlive: isProcessAlive });
if (busy) {
  console.log(reason);
  process.exit(1);
}
process.exit(0);
