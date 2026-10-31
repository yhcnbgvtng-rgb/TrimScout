// The vin-search box patch must apply (zero fuzz) to box2's deals_api_server.js md5 bd11ff77 and give a server that still parses.
// bd11ff77 is not committed whole: it is rebuilt from the 2026-10-29 snapshot + the stats-warm and buyer-contact-reveal patches and checked by md5.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const md5 = (f) => crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex");
const patch = (file, p) => execFileSync("patch", ["-F0", "-s", "--no-backup-if-mismatch", file, "-i", p]);

describe("2026-10-31 vin-search box patch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vin-search-"));
  const server = path.join(dir, "deals_api_server.js");
  fs.copyFileSync("docs/box-snapshots/2026-10-29-box2-deals-api/deals_api_server.400e943b.js.txt", server);
  patch(server, "docs/box-patches/2026-10-29-stats-cache-warm/deals_api_server.after-crawl-stamps.js.patch");
  patch(server, "docs/box-patches/2026-10-30-buyer-contact-reveal/deals_api_server.js.patch");

  it("rebuilds the live starting file (md5 bd11ff77)", () => {
    assert.match(md5(server), /^bd11ff77/);
  });
  it("applies cleanly with zero fuzz, parses, and wires the route and handler once each", () => {
    patch(server, "docs/box-patches/2026-10-31-vin-search/deals_api_server.js.patch");
    fs.copyFileSync(server, path.join(dir, "chk.mjs"));
    execFileSync("node", ["--check", path.join(dir, "chk.mjs")]);
    const s = fs.readFileSync(server, "utf8");
    assert.equal(s.split("async function handleInventoryVinSearch(").length - 1, 1);
    assert.equal(s.split('pathname === "/api/inventory/vin-search") return run(handleInventoryVinSearch').length - 1, 1);
  });
  it("is index-bounded (reversed-VIN LIKE), capped at 10 s, current inventory only, read-only", () => {
    const s = fs.readFileSync(server, "utf8");
    const body = s.slice(s.indexOf("async function handleInventoryVinSearch("), s.indexOf("async function handleInventoryVin(req"));
    assert.match(body, /max_statement_time=10 FOR SELECT/);
    assert.match(body, /i\.vin_rev LIKE \?/);
    assert.match(body, /removed_at IS NULL/);
    assert.match(body, /LIMIT 26/);
    assert.doesNotMatch(body, /INSERT|UPDATE|DELETE|ALTER/);
  });
});
