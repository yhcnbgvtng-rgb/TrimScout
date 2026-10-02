// scripts/run_nightly_chain.sh is the one cron job box3/box4 run each night: expansion crawl, then
// core crawl, then the inventory sync, each starting the moment the one before it exits. These run
// the real script against stub crawl / core-wait / sync commands (the CHAIN_*_CMD overrides) in a
// scratch directory, so the properties that matter are checked without crawling anything:
//   - the order, and that nothing waits on a clock
//   - the sync can never start before the core crawl has exited (expansion alone can't sync)
//   - the real sync gate (check-crawl-gate.mjs) sees the chain as "a crawl is running" for the whole
//     of both crawls — including the gap between expansion exiting and core's own lock appearing —
//     and not at sync time
//   - a failed stage doesn't stop the later ones
//   - a second chain doesn't stack on a first; a stale marker doesn't block tonight
//   - bad configuration refuses to start; the dry run starts nothing
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/run_nightly_chain.sh', import.meta.url));
const GATE = fileURLToPath(new URL('../scripts/check-crawl-gate.mjs', import.meta.url));
const NIGHT = '2026-10-02';
const EXPANSION_ENV = 'CRAWLER_BRAND_SET=expansion CRAWL_STATES=NJ,NY CRAWLER_MAX_CONCURRENT_STATES=4';
const CORE_ENV = 'CRAWLER_RUN_LABEL=core CRAWL_STATES=AR,MA CRAWLER_MAX_CONCURRENT_STATES=6';

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-chain-'));
  roots.push(root);
  const sb = {
    root,
    crawler: path.join(root, 'crawler'),
    runs: path.join(root, 'crawler', 'data', 'daily_crawl_runs'),
    syncLogs: path.join(root, 'sync-logs'),
    events: path.join(root, 'events.log'),
    release: path.join(root, 'release'),
  };
  sb.marker = path.join(sb.runs, 'driver-nightly-chain.lock');
  fs.mkdirSync(sb.runs, { recursive: true });
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const stub = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
    return p;
  };
  // Prints what the stage saw (label/brand/states from its env, the marker, who owns it) and, when
  // asked, what the real sync gate says at that moment.
  const gate = `if [ -n "\${GATE_SCRIPT:-}" ]; then g=$(node "$GATE_SCRIPT" "$RUNS_DIR" 2>&1); echo "$STAGE gate rc=$? out=$g" >> "$EVENTS"; fi`;
  sb.crawlCmd = stub('crawl-stub.sh', `
STAGE=expansion; [ "\${CRAWLER_RUN_LABEL:-}" = core ] && STAGE=core
mp=$(sed -n 's/.*"pid":\\([0-9]*\\),.*/\\1/p' "$MARKER" 2>/dev/null)
echo "$STAGE start label=\${CRAWLER_RUN_LABEL:-none} brand=\${CRAWLER_BRAND_SET:-none} states=\${CRAWL_STATES:-none} marker=$([ -f "$MARKER" ] && echo present || echo absent) markerIsParent=$([ "$mp" = "$PPID" ] && echo yes || echo no)" >> "$EVENTS"
${gate}
if [ -n "\${OVERWRITE_MARKER:-}" ]; then printf '{"pid":999999,"kind":"someone-else"}\\n' > "$MARKER"; fi
if [ -n "\${HOLD_UNTIL_RELEASE:-}" ]; then while [ ! -f "$RELEASE" ]; do sleep 0.05; done; fi
echo "$STAGE-output-line"
echo "$STAGE end" >> "$EVENTS"
if [ "$STAGE" = core ]; then exit "\${STUB_RC_CORE:-0}"; fi
exit "\${STUB_RC_EXPANSION:-0}"`);
  sb.coreWaitCmd = stub('core-wait-stub.sh', `
STAGE=core-wait
echo "core-wait invoked" >> "$EVENTS"
${gate}
exec "$@"`);
  sb.syncCmd = stub('sync-stub.sh', `
STAGE=sync
echo "sync start marker=$([ -f "$MARKER" ] && echo present || echo absent)" >> "$EVENTS"
${gate}
echo "sync-output-line"
exit "\${STUB_RC_SYNC:-0}"`);
  sb.env = (extra = {}) => ({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CHAIN_CRAWLER_DIR: sb.crawler,
    CHAIN_RUNS_DIR: sb.runs,
    CHAIN_SYNC_LOG_DIR: sb.syncLogs,
    CHAIN_NIGHT: NIGHT,
    CHAIN_CRAWL_CMD: sb.crawlCmd,
    CHAIN_CORE_WAIT_CMD: sb.coreWaitCmd,
    CHAIN_SYNC_CMD: sb.syncCmd,
    CHAIN_EXPANSION_ENV: EXPANSION_ENV,
    CHAIN_CORE_ENV: CORE_ENV,
    EVENTS: sb.events,
    MARKER: sb.marker,
    RUNS_DIR: sb.runs,
    RELEASE: sb.release,
    ...extra,
  });
  sb.run = (extra = {}) => spawnSync('bash', [SCRIPT], { env: sb.env(extra), encoding: 'utf8', cwd: root });
  sb.readEvents = () => (fs.existsSync(sb.events) ? fs.readFileSync(sb.events, 'utf8').split('\n').filter(Boolean) : []);
  sb.stages = () => sb.readEvents().filter((e) => !/ gate rc=/.test(e)).map((e) => e.split(' ').slice(0, 2).join(' '));
  sb.event = (prefix) => sb.readEvents().find((e) => e.startsWith(prefix));
  return sb;
}

const markerPid = (file) => Number(JSON.parse(fs.readFileSync(file, 'utf8')).pid);

describe('run_nightly_chain.sh', () => {
  it('is valid bash', () => {
    const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  describe('order', () => {
    it('runs expansion, then core, then sync — each only after the previous one has exited', () => {
      const sb = makeSandbox();
      const r = sb.run();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.deepEqual(sb.stages(), ['expansion start', 'expansion end', 'core-wait invoked', 'core start', 'core end', 'sync start']);
    });

    it("gives each stage its own env from the crontab line, and the core stage goes through the core wait wrapper", () => {
      const sb = makeSandbox();
      sb.run();
      assert.match(sb.event('expansion start'), /label=none brand=expansion states=NJ,NY /);
      assert.match(sb.event('core start'), /label=core brand=none states=AR,MA /);
      assert.ok(sb.event('core-wait invoked'));
    });

    it('writes each stage to the log name the old separate cron lines used, and narrates stages on stdout', () => {
      const sb = makeSandbox();
      const r = sb.run();
      assert.match(fs.readFileSync(path.join(sb.crawler, 'logs', `run-all-${NIGHT}.log`), 'utf8'), /expansion-output-line/);
      const coreLogs = fs.readdirSync(path.join(sb.crawler, 'logs')).filter((f) => /^run-all-core-\d{4}-\d{2}-\d{2}\.log$/.test(f));
      assert.equal(coreLogs.length, 1);
      assert.match(fs.readFileSync(path.join(sb.crawler, 'logs', coreLogs[0]), 'utf8'), /core-output-line/);
      assert.match(fs.readFileSync(path.join(sb.syncLogs, `sync-${NIGHT}.log`), 'utf8'), /sync-output-line/);
      for (const line of ['stage 1/3 expansion crawl: exited rc=0', 'stage 2/3 core crawl: exited rc=0', 'stage 3/3 sync: exited rc=0']) {
        assert.ok(r.stdout.includes(line), `missing "${line}" in:\n${r.stdout}`);
      }
    });
  });

  describe('the marker and the sync gate', () => {
    it('holds a marker naming the chain through both crawls, and removes it before the sync', () => {
      const sb = makeSandbox();
      sb.run();
      assert.match(sb.event('expansion start'), /marker=present markerIsParent=yes/);
      assert.match(sb.event('core start'), /marker=present markerIsParent=yes/);
      assert.match(sb.event('sync start'), /marker=absent/);
      assert.equal(fs.existsSync(sb.marker), false, 'marker must not outlive the chain');
    });

    it('the real sync gate reads the chain as a running crawl — during both crawls and in the gap between them — and not at sync time', () => {
      const sb = makeSandbox();
      sb.run({ GATE_SCRIPT: GATE });
      for (const stage of ['expansion', 'core-wait', 'core']) {
        const g = sb.event(`${stage} gate`);
        assert.ok(g, `no gate reading during ${stage}`);
        assert.match(g, /gate rc=1 out=lock driver-nightly-chain\.lock held by pid \d+/, stage);
      }
      // 'core-wait' above is the instant after expansion exited and before core's own lock exists.
      assert.doesNotMatch(sb.event('sync gate'), /driver-nightly-chain\.lock/, 'the sync gate must not be blocked by the chain that is starting it');
    });

    it("never deletes a marker that names a different process (a newer chain's)", () => {
      const sb = makeSandbox();
      sb.run({ OVERWRITE_MARKER: '1' });
      assert.equal(markerPid(sb.marker), 999999);
    });
  });

  describe('failures do not cascade', () => {
    it('a crashed expansion crawl still gets its core crawl and the sync', () => {
      const sb = makeSandbox();
      const r = sb.run({ STUB_RC_EXPANSION: '3' });
      assert.deepEqual(sb.stages(), ['expansion start', 'expansion end', 'core-wait invoked', 'core start', 'core end', 'sync start']);
      assert.ok(r.stdout.includes('expansion rc=3'), r.stdout);
      assert.equal(r.status, 0);
    });

    it('a failed core crawl still gets the sync of whatever was crawled', () => {
      const sb = makeSandbox();
      const r = sb.run({ STUB_RC_CORE: '4' });
      assert.equal(sb.stages().at(-1), 'sync start');
      assert.ok(r.stdout.includes('core rc=4'), r.stdout);
    });

    it("exits with the sync's result, so a failed sync shows up in the log and the exit code", () => {
      const sb = makeSandbox();
      const r = sb.run({ STUB_RC_SYNC: '7' });
      assert.equal(r.status, 7);
      assert.ok(r.stdout.includes('stage 3/3 sync: exited rc=7'), r.stdout);
    });
  });

  describe('one chain at a time', () => {
    it('a second chain does not start while the first is still crawling, and leaves the first marker alone', async () => {
      const sb = makeSandbox();
      const first = spawn('bash', [SCRIPT], { env: sb.env({ HOLD_UNTIL_RELEASE: '1' }), cwd: sb.root, stdio: 'ignore' });
      const firstDone = new Promise((resolve) => first.on('close', resolve));
      try {
        const deadline = Date.now() + 10_000;
        while (!sb.event('expansion start') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
        assert.ok(sb.event('expansion start'), 'first chain never started its crawl');

        const second = sb.run();
        assert.equal(second.status, 1, second.stdout + second.stderr);
        assert.match(second.stdout, /another nightly chain \(pid \d+\) is still crawling/);
        assert.equal(sb.readEvents().filter((e) => e.startsWith('expansion start')).length, 1, 'second chain must not start a crawl');
        assert.equal(markerPid(sb.marker), first.pid);
      } finally {
        fs.writeFileSync(sb.release, '');
        await firstDone;
      }
      assert.deepEqual(sb.stages(), ['expansion start', 'expansion end', 'core-wait invoked', 'core start', 'core end', 'sync start']);
    });

    it("a stale marker (dead pid) or one whose pid was recycled by something that isn't a chain does not block tonight", () => {
      const dead = spawnSync('true').pid; // exited, so its pid is dead
      for (const stalePid of [dead, process.pid]) {
        const sb = makeSandbox();
        fs.writeFileSync(sb.marker, `{"pid":${stalePid},"kind":"nightly-chain"}\n`);
        const r = sb.run();
        assert.equal(r.status, 0, `pid ${stalePid}: ${r.stdout}${r.stderr}`);
        assert.equal(sb.stages().at(-1), 'sync start', `pid ${stalePid}`);
        assert.equal(fs.existsSync(sb.marker), false, `pid ${stalePid}: marker replaced then removed`);
      }
    });
  });

  describe('configuration is checked before anything starts', () => {
    const refusals = {
      'no expansion env': { CHAIN_EXPANSION_ENV: '' },
      'no core env': { CHAIN_CORE_ENV: '' },
      'a word that is not KEY=VAL (a stray space would make env run it as the command)': { CHAIN_EXPANSION_ENV: 'CRAWL_STATES=AL, IA' },
      'a core env with no CRAWLER_RUN_LABEL (its lock file and box-report would collide with expansion)': { CHAIN_CORE_ENV: 'CRAWL_STATES=AR,MA' },
      'an expansion env that sets CRAWLER_RUN_LABEL': { CHAIN_EXPANSION_ENV: `${EXPANSION_ENV} CRAWLER_RUN_LABEL=core` },
    };
    for (const [name, extra] of Object.entries(refusals)) {
      it(`refuses (exit 2) and starts nothing: ${name}`, () => {
        const sb = makeSandbox();
        const r = sb.run(extra);
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.deepEqual(sb.readEvents(), []);
        assert.equal(fs.existsSync(sb.marker), false);
        assert.equal(fs.existsSync(path.join(sb.crawler, 'logs')), false);
      });
    }
  });

  describe('dry run', () => {
    it('prints the plan and starts nothing: no stage runs, no marker, no logs', () => {
      const sb = makeSandbox();
      const r = sb.run({ CHAIN_DRY_RUN: '1' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /DRY RUN/);
      assert.match(r.stdout, /stage 1\/3: env CRAWLER_BRAND_SET=expansion CRAWL_STATES=NJ,NY/);
      assert.match(r.stdout, /stage 2\/3: .*core-wait-stub\.sh env CRAWLER_RUN_LABEL=core CRAWL_STATES=AR,MA/);
      assert.match(r.stdout, /stage 3\/3: .*sync-stub\.sh/);
      assert.deepEqual(sb.readEvents(), []);
      assert.equal(fs.existsSync(sb.marker), false);
      assert.equal(fs.existsSync(path.join(sb.crawler, 'logs')), false);
    });

    it('exits 3 and names what is missing, so a bad deploy is caught before the night it matters', () => {
      const sb = makeSandbox();
      const r = sb.run({ CHAIN_DRY_RUN: '1', CHAIN_SYNC_CMD: path.join(sb.root, 'no-such-sync.sh') });
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stdout, /MISSING\s+sync wrapper/);
    });

    it('checks the real crawl entrypoint exists under the crawler directory', () => {
      const sb = makeSandbox();
      const extra = { CHAIN_DRY_RUN: '1', CHAIN_CRAWL_CMD: 'node scripts/run-daily-crawl.mjs' };
      const missing = sb.run(extra);
      assert.equal(missing.status, 3);
      assert.match(missing.stdout, /MISSING\s+crawl entrypoint: scripts\/run-daily-crawl\.mjs/);
      fs.mkdirSync(path.join(sb.crawler, 'scripts'));
      fs.writeFileSync(path.join(sb.crawler, 'scripts', 'run-daily-crawl.mjs'), '');
      const present = sb.run(extra);
      assert.equal(present.status, 0, present.stdout);
      assert.match(present.stdout, /ok\s+crawl entrypoint/);
    });
  });
});
