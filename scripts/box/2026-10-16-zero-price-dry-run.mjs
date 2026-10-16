// READ-ONLY dry run on the deals box (box2): how big is each global-junk category, and what would the zero-price ($0) rule touch?
// Reader account only (DB_READER_USER), every statement capped at 90 s, throttled, aggregates printed to stdout. Writes nothing (no files, no DB writes),
// keeps no VIN or row anywhere (counts and label text only), restarts nothing. Refuses to run between 21:40 and 23:30 ET or while the sync lock is held.
//
// The box has no checkout, so the script is piped over stdin with the shipped junk list and the Hyundai policy (not on the box) prepended as
// `globalThis.__INLINE__ = { rules, hyundai }`. Run it with (from a repo checkout):  node scripts/box/2026-10-16-zero-price-dry-run.mjs --emit | ssh box2 'cd /opt/trimscout-deals && node --input-type=module -'
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.argv.includes("--emit")) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = path.join(here, "..", "..", "scrapers", "lightsail-crawler", "src");
  const inline = { skipHyundai: process.argv.includes("--skip-hyundai"), rules: JSON.parse(fs.readFileSync(path.join(src, "optionJunkRules.json"), "utf8")), hyundai: JSON.parse(fs.readFileSync(path.join(src, "optionPolicies", "hyundai-2025-2027.json"), "utf8")) };
  const me = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").replace(/^if \(process\.argv\.includes\("--emit"\)\) \{[\s\S]*?\n\}\n/m, "");
  process.stdout.write(`globalThis.__INLINE__ = ${JSON.stringify(inline)};\n${me}`);
  process.exit(0);
}

const mysql = (await import("mysql2/promise")).default; // dynamic so --emit works on a machine without it
const INL = globalThis.__INLINE__;
const SRC = "/opt/trimscout-deals/src/";
const ROWS = await import(pathToFileURL(SRC + "inventoryOptionRows.js").href);
const ALLOW_MOD = await import(pathToFileURL(SRC + "factoryOptionAllowlist.js").href);
const normalize = ROWS.normalizeOptionKey;

// ---- guards ----
const etMinutes = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()); return Number(p.find((x) => x.type === "hour").value) % 24 * 60 + Number(p.find((x) => x.type === "minute").value); };
const lockHeld = () => {
  const f = "/home/ubuntu/.pm2/logs/deals-api-out.log", fd = fs.openSync(f, "r"), size = fs.fstatSync(fd).size, len = Math.min(size, 4_000_000), buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
  const last = buf.toString("utf8").split("\n").filter((l) => l.includes("[sync-lock]")).pop() || "";
  return /\bacquire\b/.test(last);
};
const guard = () => { const m = etMinutes(); if (m >= 21 * 60 + 40 && m <= 23 * 60 + 30) throw new Error("ABORT: inside the 21:40-23:30 ET window"); if (lockHeld()) throw new Error("ABORT: sync lock is held"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- reader connection ----
const env = {};
for (const line of fs.readFileSync("/opt/trimscout-deals/.env.trimscout-db", "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (!env.DB_READER_USER) throw new Error("no reader account");
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, connectionLimit: 1 });
let queries = 0;
const q = async (sql, p) => { guard(); queries++; const r = (await pool.query(`SET STATEMENT max_statement_time=90 FOR ${sql}`, p))[0]; await sleep(1500); return r; };

// ---- policies exactly as live (the 15 files on the box) plus Hyundai, which the live OPTION_MODEL_POLICY_PATH lacks ----
const POL_DIR = SRC + "optionPolicies/";
const liveFiles = fs.readdirSync(POL_DIR).filter((f) => f.endsWith(".json"));
const rawPolicies = {};
for (const f of liveFiles) Object.assign(rawPolicies, JSON.parse(fs.readFileSync(POL_DIR + f, "utf8")));
const hyundaiOnBox = liveFiles.some((f) => /hyundai/i.test(f));
Object.assign(rawPolicies, INL.hyundai);
const ALLOW = ALLOW_MOD.buildAllowlist(null, rawPolicies);

// ---- the shipped junk list (same regexes the write path compiles) ----
const RULES = INL.rules.rules.map((r) => ({ name: r.name, res: r.patterns.map((p) => new RegExp(p, "i")) }));
const junkCategory = (label) => { const t = String(label).replace(/^[^a-z0-9]+/i, ""); for (const r of RULES) if (r.res.some((re) => re.test(t))) return r.name; return null; };
const EXEMPTIONS = (INL.rules.exemptions || []).map((x) => ({ name: x.name, res: x.patterns.map((p) => new RegExp(p, "i")) }));
const REWRITES = (INL.rules.rewrites || []).map((w) => ({ name: w.name, re: new RegExp(w.pattern, "i"), to: w.to }));
const exemptionOf = (label) => { const t = String(label).replace(/^[^a-z0-9]+/i, ""); return EXEMPTIONS.find((x) => x.res.some((re) => re.test(t)))?.name || null; };
const rewriteOf = (label) => { const t = String(label).replace(/^[^a-z0-9]+/i, ""); return REWRITES.find((w) => w.re.test(t))?.name || null; };
const isZero = (p) => p === 0 || (typeof p === "string" && /^\$?0+(?:\.0+)?$/.test(p.trim()));
const decor = (l) => l.replace(/\$\s?[\d,]+(?:\.\d+)?/g, " ").replace(/\([^)]*\)/g, " ").replace(/®|™/g, "");
const paid = (e) => Boolean(e) && (e.price > 0 || (e.priceByDrivetrain && Object.values(e.priceByDrivetrain).some((v) => v > 0)));
const legacyCache = new Map();
const legacyDrops = (part) => { if (!legacyCache.has(part)) legacyCache.set(part, ROWS.optionRowsFromOptions([{ name: part }]).junkDropped > 0); return legacyCache.get(part); };

const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const parseOpts = (j) => { try { const o = typeof j === "string" ? JSON.parse(j) : j; return Array.isArray(o) ? o : []; } catch { return []; } };

// Is this label a PAID line of a policy that covers the car? anyTrim = on some trim of the covering policy; ownTrim = on the car's own resolved trim.
function listed(policies, owns, label, code) {
  const cleaned = normalize(decor(label)), head = label.includes(":") ? normalize(decor(label.split(":")[0])) : null, codeKey = code ? normalize(code) : null;
  let anyTrim = false, ownTrim = false;
  for (const [i, p] of policies.entries()) {
    const own = owns[i];
    for (const t of p.trims.values()) {
      const e = t.index.get(cleaned) || (head && t.index.get(head)) || (codeKey && p.orderCode.test(String(code).trim()) && t.index.get(codeKey)) || null;
      if (paid(e)) { anyTrim = true; if (t === own) ownTrim = true; }
    }
  }
  return { anyTrim, ownTrim };
}

const BRANDS = ["Toyota", "Ford", "Chevrolet", "GMC", "Honda", "Kia", "Hyundai", "Subaru", "Nissan", "Mazda", "BMW", "Mercedes-Benz", "Audi", "Buick", "Cadillac"];
const TARGET = 2000;
const A = { cars: 0, lines: 0, zero: 0, zeroFeature: 0, nullPrice: 0, zeroCovered: 0, zeroUncovered: 0, dangerAny: 0, dangerOwn: 0, dangerLabels: new Map(), dangerBrands: new Map(),
  marginalUncovered: 0, marginalCovered: 0, marginalAlreadyDropped: 0, marginalLabels: new Map(), marginalByBrand: new Map(), zeroTotalByBrand: new Map(),
  exm: new Map(), exmTotals: new Map(),
  cat: new Map(), catCars: new Map(), catProtected: new Map(), catByBrand: new Map(), catLabels: new Map(), catUncovered: new Map(), catCovered: new Map() };
const perBrand = [];

for (const brand of BRANDS) {
  const [{ c }] = await q("SELECT COUNT(*) c FROM dealer_inventory WHERE make = ? AND removed_at IS NULL", [brand]);
  const K = Math.max(1, Math.ceil(Number(c) / TARGET));
  const cars = await q("SELECT dealer_id, year, model, `trim`, options_json FROM dealer_inventory WHERE make = ? AND removed_at IS NULL AND options_json IS NOT NULL AND MOD(CRC32(vin), ?) = 0", [brand, K]);
  let covered = 0;
  const brandMarginal = new Map();
  for (const car of cars) {
    const opts = parseOpts(car.options_json); if (!opts.length) continue;
    A.cars++;
    const policies = ALLOW_MOD.modelPoliciesFor(ALLOW, { make: brand, model: car.model, year: car.year });
    const isCovered = policies.length > 0; if (isCovered) covered++;
    const carCats = new Set();
    const owns = policies.map((p) => ALLOW_MOD.resolvePolicyTrim(p, car.trim, car.model)?.trim || null);
    for (const o of opts) {
      const name = o && typeof o.name === "string" ? o.name.trim() : ""; if (!name) continue;
      const parts = ROWS.splitOptionLabel(name);
      for (const part of parts) {
        A.lines++;
        const cat = junkCategory(part);
        const zero = parts.length === 1 && isZero(o.price);
        const feature = String(o.code ?? "").trim().toUpperCase() === "FEATURE";
        if (o.price == null) A.nullPrice++;
        const l = isCovered ? listed(policies, owns, part, o.code) : { anyTrim: false, ownTrim: false };
        const exName = exemptionOf(part), rwName = rewriteOf(part);
        if (exName || rwName) {
          const kind = exName ? `exempt:${exName}` : `rewrite:${rwName}`, k = `${kind}|${part.trim().slice(0, 100)}`;
          const e = A.exm.get(k) || A.exm.set(k, { n: 0, priced: 0, paidPolicyLabel: 0, wouldTrip: cat, legacyDeny: legacyDrops(part), brands: new Map() }).get(k);
          e.n++; if (typeof o.price === "number" && o.price > 0) e.priced++; if (l.anyTrim) e.paidPolicyLabel++; bump(e.brands, brand); bump(A.exmTotals, kind);
        }
        if (cat) {
          bump(A.cat, cat); carCats.add(cat); bump(A.catByBrand, `${brand}|${cat}`); bump(A.catLabels, `${cat}|${part.slice(0, 80)}`);
          bump(isCovered ? A.catCovered : A.catUncovered, cat);
          if (l.anyTrim) bump(A.catProtected, cat);
        }
        if (!zero) continue;
        if (feature) { A.zeroFeature++; continue; }
        A.zero++; bump(A.zeroTotalByBrand, brand); A[isCovered ? "zeroCovered" : "zeroUncovered"]++;
        if (l.anyTrim) { A.dangerAny++; if (l.ownTrim) A.dangerOwn++; bump(A.dangerLabels, part.trim().slice(0, 90)); bump(A.dangerBrands, brand); continue; }
        // Not a paid policy line. Would the $0 rule add anything over what already drops it?
        if (cat || legacyDrops(part)) { A.marginalAlreadyDropped++; continue; }
        if (isCovered) { A.marginalCovered++; continue; } // a covered car's non-listed lines are dropped by the policy anyway ("standard-or-unknown")
        A.marginalUncovered++; bump(A.marginalLabels, part.trim().slice(0, 90)); bump(brandMarginal, part.trim().slice(0, 90)); bump(A.marginalByBrand, brand);
      }
    }
    for (const c2 of carCats) bump(A.catCars, c2);
  }
  A[`marg:${brand}`] = top(brandMarginal, 8);
  perBrand.push({ brand, live: Number(c), K, sampled: cars.length, covered });
  console.error(`done ${brand}: live ${c}, K ${K}, sampled ${cars.length}`);
}

// ---- Hyundai cars first seen after the 2026-10-13 apply: do they still carry junk? ----
const SINCE = "2026-10-13 00:00:00";
const [{ n: hyNew }] = INL.skipHyundai ? [{ n: 0 }] : await q("SELECT COUNT(*) n FROM dealer_inventory WHERE make = 'Hyundai' AND removed_at IS NULL AND first_seen_at >= ?", [SINCE]);
const HK = Math.max(1, Math.ceil(Number(hyNew) / 12000));
const hy = INL.skipHyundai ? [] : await q("SELECT vin, dealer_id, year, model, `trim`, options_json, first_seen_at FROM dealer_inventory WHERE make = 'Hyundai' AND removed_at IS NULL AND first_seen_at >= ? AND MOD(CRC32(vin), ?) = 0", [SINCE, HK]);
const H = { sampled: hy.length, withStoredRows: 0, noStoredRows: 0, junkStored: 0, junkStoredTrusted: 0, junkStoredUncovered: 0, storedExceedsPolicy: 0, policyCovered: 0, trimTrusted: 0, firstSeenOct14Plus: 0, junkOct14Plus: 0, cat: new Map(), carsWithCat: new Map() };
for (let i = 0; i < hy.length; i += 100) {
  const batch = hy.slice(i, i + 100);
  const stored = await q(`SELECT vin, dealer_id, label FROM dealer_inventory_options WHERE ${batch.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")}`, batch.flatMap((c) => [c.vin, c.dealer_id]));
  const byCar = new Map(); for (const r of stored) { const k = `${r.vin}|${r.dealer_id}`; (byCar.get(k) || byCar.set(k, []).get(k)).push(r.label); }
  for (const car of batch) {
    const labels = byCar.get(`${car.vin}|${car.dealer_id}`) || [];
    const policies = ALLOW_MOD.modelPoliciesFor(ALLOW, { make: "Hyundai", model: car.model, year: car.year });
    const res = policies.length ? ALLOW_MOD.policyOptionRows(policies[0], { make: "Hyundai", model: car.model, year: car.year, trim: car.trim }, parseOpts(car.options_json)) : null;
    if (res) { H.policyCovered++; if (res.trimTrusted) H.trimTrusted++; }
    const oct14 = new Date(car.first_seen_at) >= new Date("2026-10-14T00:00:00-04:00"); if (oct14) H.firstSeenOct14Plus++;
    if (!labels.length) { H.noStoredRows++; continue; }
    H.withStoredRows++;
    const cats = new Set(labels.map(junkCategory).filter(Boolean));
    labels.forEach((l) => { const c3 = junkCategory(l); if (c3) bump(H.cat, c3); });
    if (cats.size) { H.junkStored++; if (res?.trimTrusted) H.junkStoredTrusted++; if (!res) H.junkStoredUncovered++; if (oct14) H.junkOct14Plus++; for (const c3 of cats) bump(H.carsWithCat, c3); }
    if (res && res.trimTrusted && labels.length > res.rows.length) H.storedExceedsPolicy++;
  }
}
const scale = Object.fromEntries(perBrand.map((b) => [b.brand, b.K]));
const out = {
  ranAtET: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }), queries, readerAccount: true, wrote: "nothing",
  livePolicyFiles: liveFiles, hyundaiPolicyFileOnBox: hyundaiOnBox, hyundaiInLiveOptionModelPolicyPath: hyundaiOnBox,
  sample: perBrand,
  totals: { carsSampled: A.cars, optionLines: A.lines, linesWithNullPrice: A.nullPrice, explicitZero: A.zero, explicitZeroExemptFEATURE: A.zeroFeature, zeroOnCoveredCars: A.zeroCovered, zeroOnUncoveredCars: A.zeroUncovered },
  a_danger: { zeroLinesOnPaidPolicyLabel_anyTrim: A.dangerAny, zeroLinesOnPaidPolicyLabel_carsOwnTrim: A.dangerOwn, byBrand: top(A.dangerBrands, 20), top50Labels: top(A.dangerLabels, 50) },
  b_marginal: { dropWouldBeNewOnUncoveredCars: A.marginalUncovered, onCoveredCars_alreadyDroppedByPolicy: A.marginalCovered, alreadyDroppedByOtherRules: A.marginalAlreadyDropped, byBrand: top(A.marginalByBrand, 20), top50Labels: top(A.marginalLabels, 50), top8PerBrand: Object.fromEntries(BRANDS.map((b) => [b, A[`marg:${b}`]])) },
  c_hyundai: { sinceApply: SINCE, newHyundaiLive: Number(hyNew), sampleStride: HK, ...H, cat: top(H.cat, 10), carsWithCat: top(H.carsWithCat, 10) },
  d_categories: { lines: top(A.cat, 20), carsWithAtLeastOne: top(A.catCars, 20), onCoveredCars: top(A.catCovered, 20), onUncoveredCars: top(A.catUncovered, 20), linesAlsoPaidPolicyLabel_wouldBeProtected: top(A.catProtected, 20), byBrand: top(A.catByBrand, 120), topLabelsPerCategory: top(A.catLabels, 60) },
  strideByBrand: scale,
  e_exemptions: { totals: top(A.exmTotals, 10), labels: [...A.exm.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 120).map(([k, v]) => ({ key: k, n: v.n, linesWithPricePositive: v.priced, linesOnPaidPolicyLabel: v.paidPolicyLabel, wouldTripWithoutExemption: v.wouldTrip, alreadyDroppedByLegacyDenyRule: v.legacyDeny, brands: top(v.brands, 6) })) },
};
console.log(JSON.stringify(out, null, 1));
await pool.end();
