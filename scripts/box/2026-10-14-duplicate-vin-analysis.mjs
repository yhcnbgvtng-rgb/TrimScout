// READ-ONLY analysis of VINs that sit on more than one live (removed_at IS NULL) row of dealer_inventory: how many, and why.
//   node 2026-10-14-duplicate-vin-analysis.mjs --env /opt/trimscout-deals/.env.trimscout-db --out ./out [--name duplicate_vin_analysis.json]
// Reader login, read-only session, 20 s cap per query, live rows read in dealer-id ranges (idx_inv_stock_dealer_id), a failed range stops the run (no retry).
// Keeps counts and 10 example VINs only; no row dump is written. Deletes nothing, takes no lock.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const env = {};
for (const line of fs.readFileSync(opt("env", "/opt/trimscout-deals/.env.trimscout-db"), "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const conn = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, database: env.DB_NAME });
await conn.query("SET SESSION max_statement_time=20");
await conn.query("SET SESSION TRANSACTION READ ONLY");
const RANGE = 200, FRESH_MS = 48 * 3600_000;
const norm = (v) => String(v || "").trim().toUpperCase();
const nname = (s) => String(s || "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const top = (m, n = 15) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const t0 = Date.now();

// Pass 1: which normalized VINs are live under 2+ (vin, dealer_id) rows. First holder per VIN is kept as an int; only VINs seen twice get a list.
const [[mx]] = await conn.query("SELECT MAX(dealer_id) AS m FROM dealer_inventory");
const first = new Map(), dup = new Map();
let live = 0, rawNotNormal = 0, queries = 1;
for (let a = 0; a <= mx.m; a += RANGE) {
  const [r] = await conn.query("SELECT vin, dealer_id AS d FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id BETWEEN ? AND ?", [a, a + RANGE - 1]);
  queries++; live += r.length;
  for (const x of r) {
    const v = norm(x.vin); if (v !== x.vin) rawNotNormal++;
    const f = first.get(v);
    if (f === undefined) first.set(v, x.d);
    else { const e = dup.get(v); if (e) e.push(x.d); else dup.set(v, [f, x.d]); }
  }
}
first.clear();
console.log(`pass 1: live rows ${live}, distinct VINs ${live ? "" : ""}${dup.size} duplicated VINs (rows with a non-canonical VIN text: ${rawNotNormal}) in ${Math.round((Date.now() - t0) / 1000)}s, ${queries} queries`);

// Pass 2: the rows of those VINs, in batches (single-column IN on the VIN primary-key prefix).
const vins = [...dup.keys()];
const agg = { dupVins: vins.length, dupRows: 0, surplusRows: 0, sizes: new Map(), class: new Map(), pairBox: new Map(), pairState: new Map(), source: new Map(), mixedSource: 0, freshBoth: 0, stale: 0, zeroBucket: 0, nonCanon: 0, stores: new Map(), storePairs: new Map(), sameName: new Map(), sameHost: 0, classBox: new Map() };
const examples = { sameStoreTwoIds: [], sequential: [], concurrent: [], other: [], zeroBucket: [] };
const ex = (k, vin, rows) => { if (examples[k].length < 3 && examples.sameStoreTwoIds.length + examples.sequential.length + examples.concurrent.length + examples.other.length + examples.zeroBucket.length < 12) examples[k].push({ vin, rows: rows.map((r) => ({ dealerId: r.d, dealer: r.name, state: r.state, box: r.box, source: r.source, stock: r.stock, firstSeen: r.first, lastSeen: r.last, host: r.host })) }); };
for (let i = 0; i < vins.length; i += 300) {
  const part = vins.slice(i, i + 300);
  const [rows] = await conn.query("SELECT vin, dealer_id AS d, dealer_name AS name, state, source_box AS box, source, stock_number AS stock, first_seen_at AS fs, last_seen_at AS ls, vdp_url AS url FROM dealer_inventory WHERE removed_at IS NULL AND vin IN (?)", [part]);
  queries++;
  const by = new Map();
  for (const r of rows) { const v = norm(r.vin); const o = { d: r.d, name: r.name, nname: nname(r.name), state: r.state, box: r.box || "?", source: r.source || "?", stock: r.stock, first: r.fs, last: r.ls, host: host(r.url), raw: r.vin }; (by.get(v) || by.set(v, []).get(v)).push(o); }
  for (const [vin, rs] of by) {
    if (rs.length < 2) continue;
    agg.dupRows += rs.length; agg.surplusRows += rs.length - 1; bump(agg.sizes, rs.length);
    for (const r of rs) { bump(agg.source, r.source); bump(agg.stores, `${r.name} [${r.d}]`); }
    if (new Set(rs.map((r) => r.source)).size > 1) agg.mixedSource++;
    const maxLast = Math.max(...rs.map((r) => +new Date(r.last)));
    const fresh = rs.filter((r) => maxLast - +new Date(r.last) <= FRESH_MS);
    if (fresh.length === rs.length) agg.freshBoth++; else agg.stale++;
    const bx = [...new Set(rs.map((r) => r.box))].sort().join("+"); bump(agg.pairBox, bx);
    const st = new Set(rs.map((r) => r.state)); bump(agg.pairState, st.size === 1 ? "same state" : "different states");
    if (rs.some((r) => r.d === 0)) agg.zeroBucket++;
    if (rs.some((r) => r.raw !== norm(r.raw))) agg.nonCanon++;
    const sorted = rs.slice().sort((a, b) => +new Date(a.first) - +new Date(b.first));
    const sameName = new Set(rs.map((r) => r.nname)).size < rs.length && new Set(rs.map((r) => r.d)).size > 1;
    const hosts = rs.map((r) => r.host).filter(Boolean); const sameHost = hosts.length > 1 && new Set(hosts).size < hosts.length;
    if (sameHost) agg.sameHost++;
    const disjoint = sorted.every((r, k) => k === 0 || +new Date(sorted[k - 1].last) < +new Date(r.first));
    let cls;
    if (rs.some((r) => r.d === 0)) cls = "row in the 'no store matched' bucket (dealer_id 0)";
    else if (sameName || sameHost) cls = "same store under two IDs (same dealer name or same site host)";
    else if (disjoint) cls = "sequential: older row's last sighting is before the newer row's first (car moved / re-listed, old row never retired)";
    else if (fresh.length === rs.length) cls = "concurrent: two different stores both listing it now";
    else cls = "different stores, one row stale (no longer seen) while the other is current";
    bump(agg.class, cls); bump(agg.classBox, `${cls.split(":")[0].split(" (")[0]} | ${bx}`);
    const key = cls.startsWith("same store") ? "sameStoreTwoIds" : cls.startsWith("sequential") ? "sequential" : cls.startsWith("row in") ? "zeroBucket" : cls.startsWith("concurrent") ? "concurrent" : "other";
    ex(key, vin, rs);
    if (rs.length === 2) bump(agg.storePairs, rs.map((r) => r.name).sort().join("  <->  "));
  }
}
const out = {
  generatedAt: new Date().toISOString(), liveRows: live, duplicatedVins: agg.dupVins, rowsOnDuplicatedVins: agg.dupRows, surplusRows: agg.surplusRows, rowsWithNonCanonicalVinText: rawNotNormal, duplicatedVinsWithNonCanonicalText: agg.nonCanon,
  sizes: top(agg.sizes), classes: top(agg.class), byBoxPair: top(agg.pairBox), classByBoxPair: top(agg.classBox, 24), byState: top(agg.pairState), bySource: top(agg.source), vinsWithMixedSources: agg.mixedSource,
  bothRowsFresh: agg.freshBoth, oneRowStale: agg.stale, vinsWithDealerIdZeroRow: agg.zeroBucket, vinsWhereSiteHostMatches: agg.sameHost, topStores: top(agg.stores, 20), topStorePairs: top(agg.storePairs, 15), examples, queries, elapsedS: Math.round((Date.now() - t0) / 1000),
};
fs.mkdirSync(path.resolve(opt("out", "./out")), { recursive: true });
fs.writeFileSync(path.join(path.resolve(opt("out", "./out")), opt("name", "duplicate_vin_analysis.json")), JSON.stringify(out, null, 1));
console.log(`DONE ${out.elapsedS}s, ${queries} queries`);
await conn.end();
