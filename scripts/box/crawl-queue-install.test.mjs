// The install script, run for real against four sandboxed "boxes" (one home directory each) through a stub ssh/scp. Covers what
// matters when Paul runs it: it refuses without a typed GO, refuses on a busy box, changes nothing in preflight, backs up
// everything it touches, installs with the flag OFF, is idempotent, flips the flag on and off, and restores byte-for-byte.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { patchText } from "./2026-10-14-crawl-queue-patch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALL = path.join(REPO, "scripts", "box", "2026-10-14-crawl-queue-install.sh");
const cfg = JSON.parse(fs.readFileSync(path.join(REPO, "config", "boxes.json"), "utf-8"));
const anchors = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "box", "2026-10-14-crawl-queue-anchors.json"), "utf-8"));
const CREL = cfg.boxes.box3.remoteDir;
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = (f) => fs.readFileSync(f, "utf-8");

let SB, BIN, SERVER_DIR;
const home = (b) => path.join(SB, b);
const crawler = (b) => path.join(home(b), CREL);
const flagFile = (b) => path.join(crawler(b), "data", "crawl_queue", "flag.json");
const unpatched = (file, text) => patchText(text, anchors.filter((a) => a.file === file), "revert").text;

function buildBox(b, { capable }) {
  const C = crawler(b);
  for (const d of ["scripts", "src", "data/daily_crawl_runs", "dealers/oem-dumps", "config"]) fs.mkdirSync(path.join(C, d), { recursive: true });
  const crawlerSrc = path.join(REPO, "scrapers", "lightsail-crawler");
  fs.writeFileSync(path.join(C, "scripts", "run-daily-crawl.mjs"), unpatched("driver", read(path.join(crawlerSrc, "scripts", "run-daily-crawl.mjs"))));
  for (const f of ["scripts/check-crawl-gate.mjs", "src/pid_lock.js", "src/syncCrawlGate.js", "src/enricher.js", "src/inventory_shards.js"]) fs.copyFileSync(path.join(crawlerSrc, f), path.join(C, f));
  if (!capable) {
    // an old box: no per-brand shard code, no expansion dealer support (what box1/box2 look like today)
    fs.writeFileSync(path.join(C, "src", "inventory_shards.js"), "export function inventoryShardPath() {}\n");
    fs.writeFileSync(path.join(C, "scripts", "run-daily-crawl.mjs"), fs.readFileSync(path.join(C, "scripts", "run-daily-crawl.mjs"), "utf-8").replace("export async function runBrandSharded", "async function runBrandSharded"));
  } else {
    fs.writeFileSync(path.join(C, "src", "legacyShardSplit.js"), "export {};\n");
    fs.writeFileSync(path.join(C, "src", "expansionDealerFiles.js"), "export {};\n");
  }
  for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(C, "scripts", `write-s${i}-dealer-files.mjs`), "");
  const S = path.join(home(b), "inventory-sync");
  fs.mkdirSync(S, { recursive: true });
  fs.writeFileSync(path.join(S, "inventory-sync.mjs"), unpatched("sync", read(path.join(REPO, "scripts", "box", "inventory-sync.mjs"))));
  fs.writeFileSync(path.join(S, ".env"), "TRIMSCOUT_API_KEY=x\nTRIMSCOUT_DEALS_PORT=3004\n");
}

before(() => {
  SB = fs.mkdtempSync(path.join(os.tmpdir(), "cqi-"));
  BIN = path.join(SB, "bin"); SERVER_DIR = path.join(SB, "opt-src");
  fs.mkdirSync(BIN); fs.mkdirSync(SERVER_DIR);
  buildBox("box1", { capable: false }); buildBox("box2", { capable: false }); buildBox("box3", { capable: true }); buildBox("box4", { capable: true });
  fs.writeFileSync(path.join(SERVER_DIR, "deals_api_server.js"), unpatched("server", read(path.join(REPO, "scrapers", "lightsail-crawler", "src", "deals_api_server.js"))));
  const map = Object.entries(cfg.boxes).map(([b, v]) => `  ${v.host}) H="${path.join(SB, b)}";;`).join("\n");
  // stub ssh/scp: run the remote command locally, with HOME set to that box's sandbox directory
  fs.writeFileSync(path.join(BIN, "stub-ssh"), `#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do case "$1" in *@*) h="$1"; shift; break;; *) shift;; esac; done\ncmd="$*"; ip="\${h#*@}"\ncase "$ip" in\n${map}\nesac\nexport HOME="$H"\nexec bash -c "$cmd"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(BIN, "stub-scp"), `#!/usr/bin/env bash\ndst="\${@: -1}"; src="\${@: -2:1}"; ip="\${dst#*@}"; ip="\${ip%%:*}"; p="\${dst#*:}"\ncase "$ip" in\n${map}\nesac\nmkdir -p "$(dirname "$p")"; cp "$src" "$p"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(BIN, "pgrep"), `#!/usr/bin/env bash\n[ -f "$HOME/busy" ] && { echo "4242 node scripts/run-daily-crawl.mjs"; exit 0; }\nexit 1\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(BIN, "pm2"), `#!/usr/bin/env bash\ncase "$1" in jlist) echo '[{"name":"deals-api","pm2_env":{"status":"online","DISABLE_FACET_REBUILD":"1"}}]';; restart) echo "restart $2" >> "$HOME/pm2.log";; esac\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(BIN, "curl"), `#!/usr/bin/env bash\necho 200\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(BIN, "sha256sum"), `#!/usr/bin/env bash\nshasum -a 256 "$@" 2>/dev/null || /usr/bin/sha256sum "$@"\n`, { mode: 0o755 });
});

function run(args, extra = {}) {
  const r = spawnSync("bash", [INSTALL, ...args], { encoding: "utf-8", env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, CQ_SSH: path.join(BIN, "stub-ssh"), CQ_SCP: path.join(BIN, "stub-scp"), CQ_TEST_GO: "1", CQ_SKIP_CLEAN_CHECK: "1", CQ_SERVER_SRC: SERVER_DIR, CQ_SYNC_LOCK_PROBE_CMD: "echo FREE", ...extra }, input: "" });
  if (process.env.CQ_DEBUG) console.log(`--- ${args.join(" ")}\n${r.stdout}${r.stderr}`);
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const snapshot = () => Object.fromEntries(["box1", "box2", "box3", "box4"].flatMap((b) => [path.join(crawler(b), "scripts", "run-daily-crawl.mjs"), path.join(home(b), "inventory-sync", "inventory-sync.mjs")].map((f) => [f, sha(f)])).concat([[path.join(SERVER_DIR, "deals_api_server.js"), sha(path.join(SERVER_DIR, "deals_api_server.js"))]]));

describe("typed GO", () => {
  it("every mutating command refuses without an interactive terminal, and changes nothing", () => {
    const before = snapshot();
    for (const args of [["install"], ["flag", "on"], ["flag", "off"], ["rollback"], ["rollback", "--restore"], ["pilot", "DE"]]) {
      const r = run(args, { CQ_TEST_GO: "0" });
      assert.notEqual(r.code, 0, args.join(" "));
      assert.match(r.out, /needs an interactive terminal: Paul types GO himself/, args.join(" "));
    }
    assert.deepEqual(snapshot(), before);
    assert.equal(fs.existsSync(flagFile("box3")), false);
  });
  it("the test hook does nothing against real ssh: CQ_TEST_GO=1 with a non-stub ssh still refuses", () => {
    const r = run(["flag", "off"], { CQ_SSH: path.join(BIN, "ssh") });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /interactive terminal/);
  });
});

describe("preflight (read-only)", () => {
  it("passes on idle boxes, reports what each box has, and defaults to the boxes that can be workers", () => {
    const before = snapshot();
    const r = run(["preflight"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /workers: box3,box4 {3}host: box2 {3}states left on a fixed cron \(box1\): .*VA/);
    assert.match(r.out, /box1:MISSING .*brandSlug/);
    assert.match(r.out, /PREFLIGHT OK/);
    assert.match(r.out, /DISABLE_FACET_REBUILD=1/);
    assert.deepEqual(snapshot(), before);
    assert.equal(fs.existsSync(path.join(crawler("box3"), "data", "crawl_queue")), false);
  });
  it("fails when any box has a crawl or sync running, or the sync lock is held", () => {
    fs.writeFileSync(path.join(home("box4"), "busy"), "");
    let r = run(["preflight"]);
    fs.rmSync(path.join(home("box4"), "busy"));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /box4 +BUSY; process: 4242 node scripts\/run-daily-crawl\.mjs/);
    assert.match(r.out, /PREFLIGHT FAILED/);
    r = run(["preflight"], { CQ_SYNC_LOCK_PROBE_CMD: "echo HELD by box1" });
    assert.notEqual(r.code, 0);
  });
  it("a lock file with a live pid blocks it too (the real gate script runs on the box)", () => {
    fs.writeFileSync(path.join(crawler("box3"), "data", "daily_crawl_runs", "driver-core.lock"), JSON.stringify({ pid: process.pid }));
    const r = run(["preflight"]);
    fs.rmSync(path.join(crawler("box3"), "data", "daily_crawl_runs", "driver-core.lock"));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /box3 +BUSY.*lock/);
  });
  it("box1 cannot be forced in as a worker while it lacks the per-brand shard code, and the message says what to do", () => {
    const r = run(["preflight", "--workers", "box1,box3,box4"]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /box1 cannot be a worker: MISSING.*Deploy the per-brand shard code there first/);
  });
});

describe("install", () => {
  it("backs up every file it patches, installs with the flag OFF everywhere, restarts deals-api once, and records hashes", () => {
    const before = snapshot();
    const r = run(["install"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /INSTALLED with the flag OFF/);
    for (const b of ["box3", "box4"]) {
      const f = JSON.parse(read(flagFile(b)));
      assert.equal(f.enabled, false); assert.equal(f.role, "worker"); assert.equal(f.slots, 4);
      assert.ok(f.excludeStates.includes("VA") && f.excludeStates.length === 13);
      assert.match(read(path.join(crawler(b), "scripts", "run-daily-crawl.mjs")), /crawl-queue \(flag-gated/);
      assert.match(read(path.join(home(b), "inventory-sync", "inventory-sync.mjs")), /selectShards\(filesAll\)/);
      for (const f2 of ["src/crawlQueueCore.js", "scripts/run-crawl-queue.mjs", "config/crawl_queue_timings.json"]) assert.ok(fs.existsSync(path.join(crawler(b), f2)), f2);
      for (const f2 of ["syncManifest.js", "crawlQueueFlag.js", "crawlQueuePressure.js"]) assert.ok(fs.existsSync(path.join(home(b), "inventory-sync", f2)), f2);
    }
    assert.deepEqual(JSON.parse(read(flagFile("box2"))), { enabled: false, box: "box2", role: "host" });
    assert.match(read(path.join(SERVER_DIR, "deals_api_server.js")), /crawlQueueServer\.js/);
    assert.ok(fs.existsSync(path.join(SERVER_DIR, "crawlQueueServer.js")));
    assert.equal(read(path.join(home("box2"), "pm2.log")).trim().split("\n").length, 1);
    // box1 was not a worker: nothing on it changed at all
    assert.equal(sha(path.join(crawler("box1"), "scripts", "run-daily-crawl.mjs")), before[path.join(crawler("box1"), "scripts", "run-daily-crawl.mjs")]);
    assert.equal(fs.existsSync(flagFile("box1")), false);
    // every patched file has a byte-identical backup next to it, listed in the box's manifest with the after-hash
    for (const [file, hash] of Object.entries(before)) {
      if (sha(file) === hash) continue;
      const baks = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.cq-bak.`));
      assert.equal(baks.length, 1, `${file} backup`);
      assert.equal(sha(path.join(path.dirname(file), baks[0])), hash);
    }
    const m = JSON.parse(read(path.join(home("box3"), "crawl-queue-install", fs.readdirSync(path.join(home("box3"), "crawl-queue-install"))[0], "manifest.json")));
    assert.ok(m.length >= 12 && m.every((e) => /^[0-9a-f]{64}$/.test(e.sha256_after)));
  });
  it("is idempotent: a second install patches nothing again and leaves the flag as it was", () => {
    const mid = snapshot();
    const r = run(["install"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ALREADY-APPLIED/);
    assert.deepEqual(snapshot(), mid);
  });
});

describe("flag on / off / rollback", () => {
  it("flag on enables the same excludeStates on every worker and makes box2 a host", () => {
    const r = run(["flag", "on"]);
    assert.equal(r.code, 0, r.out);
    const a = JSON.parse(read(flagFile("box3"))); const b = JSON.parse(read(flagFile("box4")));
    assert.equal(a.enabled, true); assert.equal(b.enabled, true);
    assert.deepEqual(a.excludeStates, b.excludeStates);
    assert.deepEqual(JSON.parse(read(flagFile("box2"))), { enabled: true, box: "box2", role: "host" });
    assert.equal(fs.existsSync(flagFile("box1")), false, "box1 stays on its fixed cron");
  });
  it("flag on refuses (flag stays as it was) when a box is busy", () => {
    run(["flag", "off"]);
    fs.writeFileSync(path.join(home("box3"), "busy"), "");
    const r = run(["flag", "on"]);
    fs.rmSync(path.join(home("box3"), "busy"));
    assert.notEqual(r.code, 0);
    assert.equal(JSON.parse(read(flagFile("box3"))).enabled, false);
  });
  it("one command turns it off everywhere, keeping a copy of the previous flag file", () => {
    run(["flag", "on"]);
    const r = run(["rollback"]);
    assert.equal(r.code, 0, r.out);
    for (const b of ["box2", "box3", "box4"]) assert.equal(JSON.parse(read(flagFile(b))).enabled, false);
    assert.ok(fs.readdirSync(path.dirname(flagFile("box3"))).some((n) => n.startsWith("flag.json.cq-bak.")));
  });
  it("rollback --restore puts the original driver, sync client and server back byte for byte", () => {
    const r = run(["rollback", "--restore"]);
    assert.equal(r.code, 0, r.out);
    for (const b of ["box3", "box4"]) {
      assert.doesNotMatch(read(path.join(crawler(b), "scripts", "run-daily-crawl.mjs")), /crawl-queue \(flag-gated/);
      assert.doesNotMatch(read(path.join(home(b), "inventory-sync", "inventory-sync.mjs")), /selectShards/);
    }
    assert.doesNotMatch(read(path.join(SERVER_DIR, "deals_api_server.js")), /crawlQueueServer/);
    assert.equal(fs.existsSync(path.join(SERVER_DIR, "crawlQueueServer.js")), false);
  });
});
