// Fails CI when a tracked *.test.* file is neither run by `npm test` nor listed in test-known-failing.json.
//
// `npm test` is an explicit list of files (package.json), so a new test file that nobody added to it silently never runs in CI — that
// happened to the zero-scrape, catalog-summary and superseded tests (2026-10-10) and to ~50 older crawler tests. Every test file must be
// in exactly one of the two places: the list, or the known-failing file (with a reason), so skipping a test is always a visible decision.
//
//   node scripts/check-test-coverage.mjs          # checks the repo it is run from
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TEST_RE = /\.test\.(ts|tsx|js|mjs)$/;

/** Files named on the `tsx --test ...` command in the package.json "test" script. */
export function listedTests(testScript) {
  return String(testScript).trim().split(/\s+/).filter((t) => TEST_RE.test(t));
}

/**
 * @param {{ tracked: string[], listed: string[], known: Record<string, string> }} p
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkCoverage({ tracked, listed, known }) {
  const problems = [];
  const trackedTests = tracked.filter((f) => TEST_RE.test(f));
  const trackedSet = new Set(trackedTests);
  const listedSet = new Set(listed);
  const knownSet = new Set(Object.keys(known));
  for (const f of trackedTests) {
    if (!listedSet.has(f) && !knownSet.has(f)) problems.push(`${f} is not run by "npm test" and is not in test-known-failing.json — add it to the "test" script in package.json (or, if it cannot pass yet, to test-known-failing.json with a reason).`);
  }
  for (const f of listed) if (!trackedSet.has(f)) problems.push(`"npm test" lists ${f}, which is not a tracked test file (renamed or deleted?).`);
  for (const f of knownSet) {
    if (!trackedSet.has(f)) problems.push(`test-known-failing.json lists ${f}, which is not a tracked test file — remove the entry.`);
    if (listedSet.has(f)) problems.push(`${f} is both in "npm test" and in test-known-failing.json — remove it from one.`);
    if (!String(known[f] || "").trim()) problems.push(`test-known-failing.json entry for ${f} needs a reason.`);
  }
  const dup = listed.filter((f, i) => listed.indexOf(f) !== i);
  for (const f of new Set(dup)) problems.push(`"npm test" lists ${f} more than once.`);
  return { ok: problems.length === 0, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const known = fs.existsSync("test-known-failing.json") ? JSON.parse(fs.readFileSync("test-known-failing.json", "utf8")) : {};
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const { ok, problems } = checkCoverage({ tracked, listed: listedTests(pkg.scripts.test), known });
  if (!ok) {
    console.error(`Test coverage check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Test coverage OK: ${listedTests(pkg.scripts.test).length} files run by "npm test", ${Object.keys(known).length} known failing.`);
}
