import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkCoverage, listedTests } from "./check-test-coverage.mjs";

describe("listedTests", () => {
  it("takes only the test files from the tsx command", () => {
    assert.deepEqual(listedTests("tsx --test lib/a.test.ts scrapers/x/test/b.test.js"), ["lib/a.test.ts", "scrapers/x/test/b.test.js"]);
  });
});

describe("checkCoverage", () => {
  const tracked = ["lib/a.test.ts", "lib/b.test.ts", "src/not-a-test.ts", "x/c.test.js"];
  it("passes when every tracked test file is listed or known-failing", () => {
    assert.equal(checkCoverage({ tracked, listed: ["lib/a.test.ts", "lib/b.test.ts"], known: { "x/c.test.js": "needs got-scraping" } }).ok, true);
  });
  it("fails for a tracked test file that is in neither place", () => {
    const r = checkCoverage({ tracked, listed: ["lib/a.test.ts"], known: { "x/c.test.js": "r" } });
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /lib\/b\.test\.ts is not run by "npm test"/);
  });
  it("fails for a listed file that no longer exists, a stale known entry, an entry in both places, a missing reason, and a duplicate", () => {
    const r = checkCoverage({ tracked: ["lib/a.test.ts"], listed: ["lib/a.test.ts", "lib/a.test.ts", "lib/gone.test.ts"], known: { "lib/a.test.ts": "", "lib/old.test.ts": "x" } });
    const text = r.problems.join("\n");
    assert.match(text, /lib\/gone\.test\.ts, which is not a tracked test file/);
    assert.match(text, /lib\/old\.test\.ts, which is not a tracked test file/);
    assert.match(text, /lib\/a\.test\.ts is both in "npm test" and in test-known-failing/);
    assert.match(text, /needs a reason/);
    assert.match(text, /more than once/);
  });
});
