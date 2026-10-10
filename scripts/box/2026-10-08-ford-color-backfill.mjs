// Fills BLANK exterior_color / interior_color / transmission on Ford inventory from Ford's public window sticker (never overwrites a value).
//
// Source: https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=<VIN> — Ford Direct's public lookup, no key or login.
// Paint, interior and transmission all come off the same PDF in the same fetch (no extra request). They are parsed by scrapers/lightsail-crawler/src/fordStickerColors.js (see its header for the layout).
//
// Two stages, because only the first needs a PDF reader (unpdf, from the repo's node_modules) and only the second needs the DB:
//
//   1. DRY RUN (default; run from a repo checkout, e.g. your Mac, with an SSH tunnel to the deals box API):
//        ssh -N -L 3004:127.0.0.1:3004 ubuntu@52.202.234.65 &
//        TRIMSCOUT_API_KEY=... node scripts/box/2026-10-08-ford-color-backfill.mjs --state NJ [--limit 200 | --sample 300]
//      --limit takes the first N blank rows (model order); --sample takes N spread evenly across the state (a repeatable hash order).
//      Lists in-stock Ford rows in the state whose exterior colour, interior colour or transmission is blank, looks each VIN up (one request at a time,
//      --delay-ms apart, each sticker cached by VIN in --cache-dir), and writes a plan (--out, default ford_color_plan_<STATE>.json)
//      plus <plan>.misses.jsonl. Prints the counts. Touches nothing.
//
//   2. APPLY (run on the deals box, from /opt/trimscout-deals, after the plan is copied there; only on a GO in an idle window):
//        node 2026-10-08-ford-color-backfill.mjs --apply --plan ford_color_plan_NJ.json --fleet-idle
//      Takes the deals-API sync lock (own owner id, heartbeated, released at the end; exits 4 if held), saves the before-state of
//      every row (colours AND transmission) to <plan>.rollback-<ts>.json, then updates ONLY the fields that are still blank at write
//      time (a value a crawl wrote since the dry run is left alone). Refuses to run against a retired IP (docs/BOXES.md), refuses between 18:30 and
//      06:00 America/New_York, and needs the sync lock free on two probes 30s apart before it takes the lock for real.
//      It restarts nothing and rebuilds no facets.
//
// Respect for Ford: sequential requests with a delay, a descriptive User-Agent, no retries beyond one cached miss per day. A 403 / 429 /
// 503 is a block: that VIN is skipped (not cached), and after 3 blocks in a row the run stops. Nothing here tries to get around one.
// A sticker that is missing, not yet released, or not the expected shape is logged as a miss and its row is left blank — no colour is invented.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const APPLY = flag("apply");
import { pointsAtDeadIp } from "../../config/boxes.mjs"; // retired IPs (docs/BOXES.md "Do not use")
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const blank = (v) => v == null || String(v).trim() === "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, eq).trim()] = v;
    }
  } catch { /* missing file */ }
  return out;
}

// ------------------------------------------------------------------------------------------------ stage 1: dry run
async function dryRun() {
  const state = (opt("state") || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) { console.error("usage: ... --state NJ [--limit N] [--delay-ms 1500] [--cache-dir dir] [--out plan.json] [--deals http://127.0.0.1:3004]"); process.exit(1); }
  const limit = Number(opt("limit")) > 0 ? Number(opt("limit")) : Infinity;
  const sample = Number(opt("sample")) > 0 ? Number(opt("sample")) : 0;
  const delayMs = Math.max(500, Number(opt("delay-ms")) || 1500);
  const cacheDir = path.resolve(opt("cache-dir", ".ford-sticker-cache"));
  const outFile = path.resolve(opt("out", `ford_color_plan_${state}.json`));
  const deals = opt("deals", process.env.DEALS_URL || "http://127.0.0.1:3004");
  const apiKey = process.env.TRIMSCOUT_API_KEY || readEnvFile(path.resolve(".env")).TRIMSCOUT_API_KEY;
  if (pointsAtDeadIp(deals)) { console.error(`Refusing to run: this points at a retired box IP (see docs/BOXES.md "Do not use").`); process.exit(1); }
  const { parseStickerColors, stickerUrlForVin, normalizeInterior, normalizeExterior } = await import("../../scrapers/lightsail-crawler/src/fordStickerColors.js");
  const { normalizeTransmissionStrict } = await import("../../scrapers/lightsail-crawler/src/transmission.js");
  const { extractText } = await import("unpdf");
  fs.mkdirSync(cacheDir, { recursive: true });

  // 1. candidates: in-stock Ford rows in the state with a blank exterior or interior colour.
  const cands = [];
  const junk = {}; // dealer -> { exterior: {value: n}, interior: {value: n} } — present-but-not-a-colour values, counted and left alone
  const isJunk = (v) => !blank(v) && (String(v).trim().length <= 4 || /^[A-Za-z]{0,2}\d{1,3}[A-Za-z]?$/.test(String(v).trim()));
  let scanned = 0;
  for (let offset = 0; ; offset += 2000) {
    const qs = new URLSearchParams({ state, make: "Ford", inStock: "1", sort: "model:asc", limit: "2000", offset: String(offset) });
    const r = await fetch(`${deals}/api/inventory?${qs}`, { headers: apiKey ? { "X-Trimscout-Api-Key": apiKey } : {} });
    if (!r.ok) { console.error(`inventory list HTTP ${r.status} — is the tunnel up and TRIMSCOUT_API_KEY set?`); process.exit(2); }
    const page = (await r.json()).vehicles || [];
    scanned += page.length;
    for (const v of page) {
      const vin = String(v.vin || "").toUpperCase();
      if (!VIN_RE.test(vin) || String(v.make || "").toLowerCase() !== "ford") continue;
      for (const [field, val] of [["exterior", v.exteriorColor], ["interior", v.interiorColor]]) {
        if (isJunk(val)) { const d = (junk[v.dealerName] ||= { exterior: {}, interior: {} }); d[field][String(val).trim()] = (d[field][String(val).trim()] || 0) + 1; }
      }
      if (blank(v.exteriorColor) || blank(v.interiorColor) || blank(v.transmission)) cands.push({ vin, dealerId: v.dealerId, dealerName: v.dealerName, condition: v.condition, year: v.year, model: v.model, exteriorColor: v.exteriorColor ?? null, interiorColor: v.interiorColor ?? null, transmission: v.transmission ?? null });
    }
    if (page.length < 2000) break;
  }
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const work = (sample ? [...cands].sort((a, b) => hash(a.vin) - hash(b.vin)).slice(0, sample) : cands).slice(0, limit);
  console.log(`${state} Ford: ${scanned} in-stock rows scanned, ${cands.length} with a blank colour or transmission, ${work.length} to look up (--limit ${Number.isFinite(limit) ? limit : "none"}${sample ? `, --sample ${sample}` : ""}).`);
  const byCond = (rows) => rows.reduce((m, r) => ((m[r.condition || "?"] = (m[r.condition || "?"] || 0) + 1), m), {});
  console.log(`  blank-field rows by condition: ${JSON.stringify(byCond(cands))}   in this lookup: ${JSON.stringify(byCond(work))}`);

  // 2. stickers, one at a time, cached by VIN.
  const stats = { cacheHit: 0, fetched: 0, ok: 0, blocked: 0, aborted: false };
  const misses = {};
  const missLog = [];
  const colors = new Map();
  let consecutiveBlocks = 0;
  const day = 24 * 3600 * 1000;
  for (const c of work) {
    const f = path.join(cacheDir, `${c.vin}.json`);
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(f, "utf-8")); } catch { /* not cached */ }
    // v3 records carry the printed transmission. A v2 record (colours only) is still good for a row that needs no transmission;
    // for a row with a blank transmission it is fetched again (once), because the old cache never kept that line.
    const reusable = rec && (rec.v === 3 || (rec.v === 2 && !blank(c.transmission)));
    if (reusable && (rec.status === "ok" || Date.now() - rec.fetchedAt < day)) {
      stats.cacheHit++;
    } else {
      stats.fetched++;
      let res;
      try {
        res = await fetch(stickerUrlForVin(c.vin), { headers: { Accept: "application/pdf", "User-Agent": "Mozilla/5.0 (compatible; TrimScout/1.0; +https://www.trimscout.com)" }, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        rec = { status: "miss", reason: "network", fetchedAt: Date.now() };
        res = null;
      }
      if (res && [403, 429, 503].includes(res.status)) {
        stats.blocked++; consecutiveBlocks++;
        missLog.push({ vin: c.vin, reason: `blocked_${res.status}` });
        console.log(`  ${c.vin} blocked (HTTP ${res.status}) — skipped, not retried`);
        if (res.status === 429 || consecutiveBlocks >= 3) { stats.aborted = true; console.log("  stopping: Ford is limiting us. Nothing was bypassed."); break; }
        await sleep(delayMs);
        continue;
      }
      consecutiveBlocks = 0;
      if (res) {
        if (!res.ok) rec = { status: "miss", reason: `http_${res.status}`, fetchedAt: Date.now() };
        else {
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) rec = { status: "miss", reason: "not_pdf", fetchedAt: Date.now() };
          else {
            let text = "";
            try { const t = (await extractText(bytes, { mergePages: true })).text; text = Array.isArray(t) ? t.join("\n") : String(t || ""); } catch { /* unreadable */ }
            const p = parseStickerColors(text);
            rec = p.exteriorRaw || p.interiorRaw || p.transmissionRaw ? { status: "ok", ...p, fetchedAt: Date.now() } : { status: "miss", reason: "no_vehicle_description", fetchedAt: Date.now() };
          }
        }
      }
      fs.writeFileSync(f, JSON.stringify({ v: 3, vin: c.vin, ...rec }));
      await sleep(delayMs + Math.floor(Math.random() * 400));
    }
    if (rec.status === "ok") { stats.ok++; colors.set(c.vin, rec); }
    else { misses[rec.reason] = (misses[rec.reason] || 0) + 1; missLog.push({ vin: c.vin, reason: rec.reason }); }
  }

  // 3. plan: only the blank fields a sticker answered.
  const rows = [];
  for (const c of work) {
    const s = colors.get(c.vin);
    if (!s) continue;
    // A value already on the row (from the dealer's listing) always wins: only a blank field is ever planned.
    // Re-derived from the cached printed text, so parser improvements apply to stickers fetched earlier without another request.
    const sExt = normalizeExterior(s.exteriorRaw);
    const sInt = s.interiorRaw ? normalizeInterior(s.interiorRaw) : null;
    const ext = blank(c.exteriorColor) && sExt ? sExt : null;
    let int = blank(c.interiorColor) && sInt ? sInt : null;
    if (blank(c.interiorColor) && s.interiorRaw && !sInt) { misses.interior_unnormalized = (misses.interior_unnormalized || 0) + 1; missLog.push({ vin: c.vin, reason: "interior_unnormalized", raw: s.interiorRaw }); }
    // Transmission: re-derived from the printed words, planned only where the row's is blank, and only when the words are fully understood.
    const sTrans = normalizeTransmissionStrict(s.transmissionRaw);
    const trans = blank(c.transmission) && sTrans ? sTrans : null;
    if (blank(c.transmission) && s.transmissionRaw && !sTrans) { misses.transmission_unnormalized = (misses.transmission_unnormalized || 0) + 1; missLog.push({ vin: c.vin, reason: "transmission_unnormalized", raw: s.transmissionRaw }); }
    if (ext || int || trans) rows.push({ vin: c.vin, dealerId: c.dealerId, dealerName: c.dealerName, condition: c.condition, year: c.year, model: c.model, fill: { exterior_color: ext, interior_color: int, transmission: trans }, sticker: { exteriorRaw: s.exteriorRaw, interiorRaw: s.interiorRaw, transmissionRaw: s.transmissionRaw ?? null } });
  }
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  fs.writeFileSync(`${outFile}.junk.json`, JSON.stringify(junk, null, 1));
  fs.writeFileSync(`${outFile}.misses.jsonl`, missLog.map((m) => JSON.stringify(m)).join("\n") + (missLog.length ? "\n" : ""));
  const both = rows.filter((r) => r.fill.exterior_color && r.fill.interior_color).length;
  const extOnly = rows.filter((r) => r.fill.exterior_color && !r.fill.interior_color).length;
  const intOnly = rows.filter((r) => !r.fill.exterior_color && r.fill.interior_color).length;
  console.log(`\nDRY RUN ${state} Ford — nothing was written to any database.`);
  console.log(`  candidates looked up:   ${work.length}  (cache hits ${stats.cacheHit}, fetched ${stats.fetched}${stats.aborted ? ", STOPPED EARLY" : ""})`);
  console.log(`  sticker colours found:  ${stats.ok}`);
  console.log(`  misses:                 ${Object.entries(misses).map(([k, v]) => `${k} ${v}`).join(", ") || "0"}  blocked ${stats.blocked}`);
  console.log(`  filled rows by condition: ${JSON.stringify(byCond(rows))}`);
  console.log(`  transmission filled in plan: ${rows.filter((r) => r.fill.transmission).length}  ${JSON.stringify(rows.reduce((m, r) => (r.fill.transmission && (m[r.fill.transmission] = (m[r.fill.transmission] || 0) + 1), m), {}))}`);
  console.log(`  rows the plan would fill: ${rows.length}  (both colours ${both}, exterior only ${extOnly}, interior only ${intOnly})`);
  const junkTotals = {}; for (const d of Object.values(junk)) for (const f of ["exterior", "interior"]) for (const [k, n] of Object.entries(d[f])) junkTotals[`${f}:${k}`] = (junkTotals[`${f}:${k}`] || 0) + n;
  console.log(`  junk values left alone (${Object.keys(junk).length} dealers): ${JSON.stringify(junkTotals)}`);
  console.log(`  plan: ${outFile}\n  misses: ${outFile}.misses.jsonl\n  junk by dealer: ${outFile}.junk.json`);
}

// ------------------------------------------------------------------------------------------------ stage 2: apply
async function apply() {
  const planFile = opt("plan");
  if (!planFile) { console.error("usage: ... --apply --plan <plan.json> --fleet-idle"); process.exit(1); }
  if (!flag("fleet-idle")) { console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }
  const mysql = (await import("mysql2/promise")).default;
  const dbEnv = readEnvFile(path.resolve(process.cwd(), ".env.trimscout-db"));
  const appEnv = readEnvFile(path.resolve(process.cwd(), ".env"));
  const API_KEY = process.env.TRIMSCOUT_API_KEY || appEnv.TRIMSCOUT_API_KEY || dbEnv.TRIMSCOUT_API_KEY || null;
  const DB_HOST = dbEnv.DB_HOST || process.env.DB_HOST;
  const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || dbEnv.DEALS_API_PORT || 3004}`;
  if (pointsAtDeadIp(DB_HOST, DEALS, process.env.TRIMSCOUT_DEALS_HOST)) { console.error(`Refusing to run: this points at a retired box IP (see docs/BOXES.md "Do not use").`); process.exit(1); }
  if (!API_KEY) { console.error("No TRIMSCOUT_API_KEY found: refusing to apply without being able to take the sync lock."); process.exit(3); }
  const plan = JSON.parse(fs.readFileSync(planFile, "utf-8"));
  if (!Array.isArray(plan) || plan.some((r) => !VIN_RE.test(r.vin) || !Number.isInteger(Number(r.dealerId)) || !r.fill)) { console.error("plan must be an array of { vin, dealerId, fill: { exterior_color, interior_color, transmission } }"); process.exit(1); }
  const pool = mysql.createPool({ host: DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout", user: dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER, password: dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD, connectionLimit: 2 });
  const lockCall = async (action, owner, extra = {}) => {
    const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
    if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
    return r.json();
  };
  const owner = `ford-color-backfill-${process.pid}`;
  // Never in the overnight window: 18:30-06:00 America/New_York (crawls and the nightly sync live there).
  const et = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hh = Number(et.find((x) => x.type === "hour").value) % 24, mm = Number(et.find((x) => x.type === "minute").value);
  if (hh * 60 + mm >= 18 * 60 + 30 || hh * 60 + mm < 6 * 60) { console.error(`Refusing to apply: it is ${hh}:${String(mm).padStart(2, "0")} ET, inside the 18:30-06:00 no-apply window. Nothing was changed.`); await pool.end(); process.exit(5); }
  // Two probes of the sync lock, 30s apart, both free, before the real acquire. (A probe is an acquire that is released at once.)
  for (let i = 1; i <= 2; i++) {
    const probe = await lockCall("acquire", `${owner}-probe${i}`);
    if (!probe.acquired) { console.log(`HELD, LOCK BUSY on probe ${i} — ${JSON.stringify(probe)}. Nothing was changed.`); await pool.end(); process.exit(4); }
    await lockCall("release", `${owner}-probe${i}`);
    console.log(`  lock probe ${i}/2: free`);
    if (i === 1) await sleep(30_000);
  }
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`Sync lock taken as ${owner}; ${plan.length} planned rows.`);
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
  process.on("SIGTERM", async () => { await release(); process.exit(143); });
  try {
    const before = [];
    for (const r of plan) {
      const [rows] = await pool.query("SELECT vin, dealer_id, make, exterior_color, interior_color, transmission, removed_at FROM dealer_inventory WHERE vin = ? AND dealer_id = ?", [r.vin, Number(r.dealerId)]);
      if (rows[0]) before.push(rows[0]);
    }
    const rb = `${planFile}.rollback-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    fs.writeFileSync(rb, JSON.stringify(before, null, 1));
    console.log(`  before-state of ${before.length} rows saved to ${rb}`);
    let ext = 0, int = 0, trn = 0;
    for (const r of plan) {
      // Each column is only written where it is blank RIGHT NOW (guard in the WHERE of its own statement): a crawl that
      // filled it since the dry run wins, and nothing here can overwrite an existing value.
      if (r.fill.exterior_color) {
        const [res] = await pool.query("UPDATE dealer_inventory SET exterior_color = ? WHERE vin = ? AND dealer_id = ? AND (exterior_color IS NULL OR exterior_color = '')", [r.fill.exterior_color, r.vin, Number(r.dealerId)]);
        ext += res.affectedRows;
      }
      if (r.fill.interior_color) {
        const [res] = await pool.query("UPDATE dealer_inventory SET interior_color = ? WHERE vin = ? AND dealer_id = ? AND (interior_color IS NULL OR interior_color = '')", [r.fill.interior_color, r.vin, Number(r.dealerId)]);
        int += res.affectedRows;
      }
      if (r.fill.transmission) {
        const [res] = await pool.query("UPDATE dealer_inventory SET transmission = ? WHERE vin = ? AND dealer_id = ? AND (transmission IS NULL OR transmission = '')", [r.fill.transmission, r.vin, Number(r.dealerId)]);
        trn += res.affectedRows;
      }
      await sleep(40);
    }
    console.log(`exterior_color filled: ${ext}   interior_color filled: ${int}   transmission filled: ${trn}   (a field that was no longer blank was skipped)`);
  } finally {
    await release();
    console.log("Sync lock released.");
  }
  await pool.end();
}

(APPLY ? apply() : dryRun()).catch((e) => { console.error(e); process.exit(1); });
