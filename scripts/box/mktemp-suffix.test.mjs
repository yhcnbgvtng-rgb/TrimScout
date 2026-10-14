// A module fetched into a bare `mktemp` file (no .js extension) is syntax-checked as CommonJS, so `node --check` rejects any ES module (import / export).
// Every box script that fetches a module to a temp file and runs `node --check` on it must create the file with --suffix=.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

test("box scripts that node --check a temp file create it with --suffix=.js", () => {
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sh"))) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/\$\(mktemp\)/.test(line) && /node --check/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
