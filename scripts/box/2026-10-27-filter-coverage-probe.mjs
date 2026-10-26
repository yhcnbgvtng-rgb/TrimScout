// READ-ONLY probe for the "More filters" panel (2026-10-27-filter-panel.mjs): (1) how complete each stored column is among in-stock retail cars, (2) how the three
// text-inferred filters (fuel, drivetrain, transmission) split the cars, (3) whether the SQL regular expressions and the JS rules agree on a sample of real rows,
// and (4) what the facet-counts row query costs on a few real makes/models. Reader account only; SELECTs only; nothing is written.
// NOT RUN YET. Run it on box2 in an idle window, from /opt/trimscout-deals (needs src/inventoryDerived.js, i.e. after 2026-10-27-filter-panel.mjs --apply, and .env.trimscout-db):
//   node 2026-10-27-filter-coverage-probe.mjs [--sample=2000] [--make=Toyota,Ford] [--explain]
// Takes about a minute (three regex scans of the in-stock set). Output ends with GO / NO-GO: GO means no SQL/JS disagreement above 1% of the sample and every timed facet query under 2 s (or "too broad").
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const SAMPLE = Math.min(Math.max(Number(args.sample) || 2000, 200), 20000);
const SRC = path.resolve(process.cwd(), "src");
const dv = await import(path.join(SRC, "inventoryDerived.js"));
const fc = await import(path.join(SRC, "facetCounts.js"));
const { inventoryListQuery } = await import(path.join(SRC, "inventoryListQuery.js"));
function loadDbEnv() {
  const raw = fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(t.slice(0, eq).trim() in process.env)) process.env[t.slice(0, eq).trim()] = value;
  }
}
loadDbEnv();
const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, database: process.env.DB_NAME, user: process.env.DB_READER_USER, password: process.env.DB_READER_PASSWORD, connectionLimit: 1 });
const run = async (sql, params = []) => { const t = Date.now(); const [rows] = await pool.query(`SET STATEMENT max_statement_time=90 FOR ${sql}`, params); return { rows, ms: Date.now() - t }; };
const pct = (n, d) => (d ? `${((100 * Number(n)) / Number(d)).toFixed(1)}%` : "n/a");
const STOCK = "i.removed_at IS NULL AND i.stale_at IS NULL AND (i.cond IS NULL OR i.cond <> 'wholesale')";
let bad = false;

try {
  // 1. column completeness
  const { rows: [c] } = await run(`SELECT COUNT(*) AS n, SUM(i.year IS NOT NULL) AS year, SUM(i.mileage IS NOT NULL) AS mileage, SUM(i.mileage > 0) AS mileage_pos,
      SUM(i.body_style IS NOT NULL AND i.body_style <> '') AS body, SUM(i.engine IS NOT NULL AND i.engine <> '') AS engine, SUM(i.transmission IS NOT NULL AND i.transmission <> '') AS trans,
      SUM(i.days_on_lot IS NOT NULL) AS days, SUM(i.exterior_color IS NOT NULL AND i.exterior_color <> '') AS ext, SUM(i.interior_color IS NOT NULL AND i.interior_color <> '') AS intr
    FROM dealer_inventory i WHERE ${STOCK}`);
  console.log(`\nIn-stock retail cars: ${Number(c.n).toLocaleString()}`);
  console.table(Object.fromEntries(["year", "mileage", "mileage_pos", "body", "engine", "trans", "days", "ext", "intr"].map((k) => [k, { cars: Number(c[k]), share: pct(c[k], c.n) }])));
  // 2. the inferred splits
  for (const [name, expr] of [["fuel", dv.FUEL_SQL], ["drivetrain", dv.DRIVETRAIN_SQL], ["transmission", dv.TRANSMISSION_SQL]]) {
    const { rows, ms } = await run(`SELECT ${expr} AS k, COUNT(*) AS n FROM dealer_inventory i WHERE ${STOCK} GROUP BY k ORDER BY n DESC`);
    console.log(`\n${name} (${ms} ms)`);
    console.table(rows.map((r) => ({ class: r.k ?? "(says nothing)", cars: Number(r.n), share: pct(r.n, c.n) })));
  }
  // 3. SQL vs JS on a sample
  const { rows: sample } = await run(`SELECT i.trim, i.engine, i.model, i.body_style, i.transmission, ${dv.FUEL_SQL} AS f, ${dv.DRIVETRAIN_SQL} AS d, ${dv.TRANSMISSION_SQL} AS t FROM dealer_inventory i WHERE ${STOCK} AND MOD(CRC32(i.vin), 40) = 0 LIMIT ${SAMPLE}`);
  const diffs = [];
  for (const r of sample) {
    const js = { f: dv.classifyFuel({ trim: r.trim, engine: r.engine, model: r.model }), d: dv.classifyDrivetrain({ trim: r.trim, engine: r.engine, bodyStyle: r.body_style }), t: dv.classifyTransmission({ transmission: r.transmission }) };
    for (const k of ["f", "d", "t"]) if ((r[k] ?? null) !== js[k]) diffs.push({ kind: k, sql: r[k], js: js[k], trim: r.trim, engine: r.engine, model: r.model, transmission: r.transmission });
  }
  console.log(`\nSQL vs JS rules on ${sample.length} random cars: ${diffs.length} disagreements (${pct(diffs.length, sample.length * 3)} of classifications)`);
  if (diffs.length) console.table(diffs.slice(0, 15));
  if (diffs.length > sample.length * 3 * 0.01) bad = true;
  // 4. the facet-counts row query on real sets
  const { rows: makes } = await run(`SELECT make, COUNT(*) AS n FROM dealer_inventory i WHERE ${STOCK} AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 40`);
  const chosen = typeof args.make === "string" ? makes.filter((m) => args.make.split(",").includes(m.make)) : [makes[0], makes[Math.floor(makes.length / 4)], makes[Math.floor(makes.length / 2)], makes[makes.length - 1]].filter(Boolean);
  const cap = fc.rowCapOf();
  const sets = [];
  for (const m of chosen) {
    sets.push({ label: `${m.make} (whole make)`, qs: `make=${encodeURIComponent(m.make)}&inStock=1&retailOnly=1` });
    const { rows: [top] } = await run(`SELECT model, COUNT(*) AS n FROM dealer_inventory i WHERE ${STOCK} AND make = ? AND model IS NOT NULL GROUP BY model ORDER BY n DESC LIMIT 1`, [m.make]);
    if (top) sets.push({ label: `${m.make} ${top.model}`, qs: `make=${encodeURIComponent(m.make)}&model=${encodeURIComponent(top.model)}&inStock=1&retailOnly=1` });
  }
  const timing = [];
  for (const s of sets) {
    const { countSql, args: a } = inventoryListQuery(fc.paramsWithoutFaceted(new URLSearchParams(s.qs)));
    const sql = fc.facetRowsSql(countSql, cap);
    if (args.explain && timing.length === 0) { const [plan] = await pool.query(`EXPLAIN ${sql}`, a); console.log("EXPLAIN (first set):"); console.table(plan.map((p) => ({ table: p.table, type: p.type, key: p.key, rows: p.rows, Extra: p.Extra }))); }
    const { rows, ms } = await run(sql, a);
    timing.push({ set: s.label, rows: rows.length > cap ? `>${cap} (too broad)` : rows.length, ms, verdict: rows.length > cap ? "answers too broad" : ms < 2000 ? "ok" : "SLOW" });
    if (rows.length <= cap && ms >= 2000) bad = true;
  }
  console.log(`\nfacet-counts row query (cap ${cap}):`); console.table(timing);
  console.log(bad ? "\nNO-GO: see the disagreements / SLOW rows above. Do not point the web app at this box yet." : "\nGO: the rules agree with the SQL and the row query is fast on the sample.");
} finally { await pool.end(); }
