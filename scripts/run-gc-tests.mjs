// Runs the tests that need `node --expose-gc` as their own targeted step (the main `npm test` run has no --expose-gc, so the
// GC-dependent case in heap_guard.test.js is skipped there). Fails if the run fails, if ANY test in it is skipped/todo/cancelled,
// or if the GC case did not report ok. Works on Node 20 and 22 (TAP summary lines are identical).
//   node scripts/run-gc-tests.mjs        (npm run test:gc)
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FILES = ["scrapers/lightsail-crawler/test/heap_guard.test.js"];
const MUST_PASS = "detachStrings releases the page a captured substring came from";

/** @returns {{ ok: boolean, problems: string[] }} */
export function judge(tap, status) {
  const problems = [];
  if (status !== 0) problems.push(`node --test exited with status ${status}`);
  const n = (k) => { const m = tap.match(new RegExp(`^# ${k} (\\d+)`, "m")); return m ? Number(m[1]) : null; };
  for (const k of ["skipped", "todo", "cancelled", "fail"]) if (n(k) !== 0) problems.push(`expected "# ${k} 0", got ${n(k)}`);
  if (!(n("pass") > 0)) problems.push("no passing tests reported");
  if (!new RegExp(`^\\s*ok \\d+ - ${MUST_PASS}`, "m").test(tap)) problems.push(`GC test "${MUST_PASS}" did not report ok`);
  return { ok: problems.length === 0, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = spawnSync(process.execPath, ["--expose-gc", "--test", "--test-reporter=tap", ...FILES], { encoding: "utf8" });
  const tap = r.stdout + r.stderr;
  process.stdout.write(tap);
  const { ok, problems } = judge(tap, r.status);
  if (!ok) { console.error("\nGC test run FAILED:\n - " + problems.join("\n - ")); process.exit(1); }
  console.log("\nGC test run OK: GC case passed, 0 skipped/todo/cancelled/failed.");
}
