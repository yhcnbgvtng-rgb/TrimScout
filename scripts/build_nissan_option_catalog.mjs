// Builds docs/option-catalogs-2026-10-14/nissan_lineup_options_by_trim.csv from the text of nissanusa.com's own public Build & Price pages.
// Source of record: docs/option-catalogs-2026-10-14/nissan_build_price_pages.json - one entry per Build & Price version page (the rendered <main> text), captured
// in a normal browser session (no login, no cookies, one page every few seconds) from the "Build" links on https://www.nissanusa.com/shopping-tools/build-price?models=<model>.
//   [{ "model": "rogue", "url": "https://www.nissanusa.com/shopping-tools/build-price/c?modelCode=...&versionCode=...&optionkey=...",
//      "finalUrl": "https://www.nissanusa.com/shopping-tools/build-price/crossovers-suvs/rogue/2027/fwd/<config code>", "text": "<main innerText>" }]
// Run: node scripts/build_nissan_option_catalog.mjs [--in <pages.json>] [--out <csv>] [--report <md>]
//
// Rules (same as every option policy): every paid factory sticker line stays; $0 items, accessories, dealer add-ons and subscriptions are dropped.
//   kept     "Premium Colors" (paid paints, two-tones included) and the PACKAGES section lines that show a price.
//   dropped  the Wheels list (Nissan's own page data marks them accessoryFit = DEALER: dealer-installed accessories), everything under ACCESSORIES, "Included" packages,
//            standard colors and interiors. AWD / 4WD is a separate version of the trim, not a sticker line, so it is not a row.
//   review   a package line with no price shown on the page ("Add" with no $) is written at price 0 (so the policy drops it) and flagged for review.
// A trim sold in FWD and AWD (or 2WD/4WD) is one trim: identical lines are written once; a line whose price differs by drivetrain keeps both prices.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const IN = path.resolve(opt("in", path.join(root, "docs/option-catalogs-2026-10-14/nissan_build_price_pages.json")));
const OUT = path.resolve(opt("out", path.join(root, "docs/option-catalogs-2026-10-14/nissan_lineup_options_by_trim.csv")));

export const HEADER = ["year", "model", "trim", "model_code", "trim_base_msrp", "category", "subcategory", "item", "price_usd", "contents", "notes", "source_file", "source_url", "needs_review"];
const esc = (v) => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const clean = (s) => String(s || "").replace(/[®™ ]/g, " ").replace(/\[\*\]/g, " ").replace(/\s+/g, " ").trim();
const money = (s) => { const m = /\$([\d,]+)/.exec(s || ""); return m ? Number(m[1].replace(/,/g, "")) : null; };

/** One Build & Price page -> { year, model, trim, versionCode, modelCode, drive, base, paints[], packages[], included[], wheels[] } */
export function parsePage(p) {
  const t = String(p.text || "");
  const head = t.split("\n").map((x) => x.trim()).filter(Boolean);
  const m = /^(\d{4}(?:\.5)?)\s+(.+)$/.exec(clean(head[0]));
  if (!m) throw new Error(`cannot read the model line "${head[0]}" (${p.url})`);
  const trim = clean(head[1]);
  const q = new URLSearchParams((p.url.split("?")[1] || ""));
  const fin = String(p.finalUrl || "");
  const drive = (/\/\d{4}(?:\.5)?\/([^/]+)\//.exec(fin) || [])[1] || "";
  const gs = t.indexOf("GET STARTED");
  const body = gs >= 0 ? t.slice(gs) : t;
  const sect = (from, to) => { const a = body.search(from); if (a < 0) return ""; const rest = body.slice(a); const b = to ? rest.slice(1).search(to) : -1; return b < 0 ? rest : rest.slice(0, b + 1); };
  const ext = sect(/\nEXTERIOR\n/, /\nINTERIOR\n/);
  const paintsTxt = ext.split(/\nWheels\n/)[0];
  const wheelsTxt = ext.includes("\nWheels\n") ? ext.split(/\nWheels\n/)[1] : "";
  const pairs = (s) => [...s.matchAll(/(?:^|\n)([^\n$][^\n]*)\n\n\$([\d,]+)/g)].map((x) => ({ name: clean(x[1]), price: Number(x[2].replace(/,/g, "")) }));
  const paints = pairs(paintsTxt.slice(paintsTxt.search(/Premium Colors/) >= 0 ? paintsTxt.search(/Premium Colors/) : paintsTxt.length));
  const wheels = pairs(wheelsTxt);
  const interior = pairs(sect(/\nINTERIOR\n/, /\nPACKAGES\n|\nACCESSORIES\n/));
  const pk = sect(/\nPACKAGES\n/, /\nACCESSORIES\n/);
  const packages = [], included = [], noPrice = [];
  const body2 = pk.replace(/^\s*PACKAGES\s*\nPackages\s*\n+/, "");
  const parts = body2.split(/Details\s*\n(Add|Included)\s*/);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const chunk = parts[i], kind = parts[i + 1];
    const price = money(chunk);
    const name = clean(chunk.replace(/\$[\d,]+/g, " "));
    if (!name) continue;
    if (kind === "Included") included.push(name);
    else if (price) packages.push({ name, price });
    else noPrice.push(name);
  }
  const sw = [...t.matchAll(/\n([^\n]+)\n\nStarting MSRP\n\n\$([\d,]+)/g)].map((x) => ({ trim: clean(x[1]), price: Number(x[2].replace(/,/g, "")) }));
  const base = (sw.find((x) => x.trim === trim) || {}).price ?? null;
  return { year: m[1], model: clean(m[2]).replace(/^Nissan /i, ""), trim, modelCode: q.get("modelCode") || "", versionCode: q.get("versionCode") || "", drive, base, paints, interior, packages, included, noPrice, wheels, url: p.url, finalUrl: fin };
}

export function buildRows(pages) {
  const rows = [];
  const seen = new Map(); // year|model|trim|category|item|price -> row index (a trim sold in two drivetrains is one trim)
  const report = { versions: 0, wheelsDropped: 0, includedPackages: 0, noPrice: [], twoPointFive: 0 };
  for (const p of pages.map(parsePage)) {
    report.versions++;
    const dbYear = String(Math.trunc(Number(p.year)));
    if (p.year.endsWith(".5")) report.twoPointFive++;
    const baseNote = `version ${p.versionCode}${p.drive ? ` (${p.drive})` : ""}${p.year.endsWith(".5") ? `; marketed as ${p.year}` : ""}`;
    const add = (category, item, price, extra, review) => {
      const key = [dbYear, p.model, p.trim, category, item.toLowerCase(), price].join("|");
      if (seen.has(key)) { rows[seen.get(key)].versions.push(p.versionCode); return; }
      seen.set(key, rows.length);
      rows.push({ year: dbYear, model: p.model, trim: p.trim, modelCode: p.modelCode, base: p.base ?? "", category, item, price, extra, review, url: p.url, versions: [p.versionCode], baseNote });
    };
    add("Base", "Base Price (trim MSRP)", p.base ?? 0, "Destination not included", p.base == null ? "Trim starting MSRP not found on the page (trim switcher uses a different label); base price left blank, no option rows depend on it" : "");
    for (const c of p.paints) add(/two-tone/i.test(c.name) ? "Exterior color" : "Exterior color", c.name, c.price, /two-tone/i.test(c.name) ? "two-tone" : "", "");
    for (const c of p.interior) add("Factory option", c.name, c.price, "interior", "");
    for (const k of p.packages) add("Factory package", k.name, k.price, "", "");
    for (const n of p.noPrice) { add("Factory package", n, 0, "", "Package line shows no price on the page (Add with no $): written at $0, so the policy drops it; confirm whether it is no-charge"); report.noPrice.push(`${dbYear} ${p.model} ${p.trim}: ${n}`); }
    report.wheelsDropped += p.wheels.length; report.includedPackages += p.included.length;
  }
  return { rows, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pages = JSON.parse(fs.readFileSync(IN, "utf8"));
  const { rows, report } = buildRows(pages);
  rows.sort((a, b) => a.year - b.year || a.model.localeCompare(b.model) || a.trim.localeCompare(b.trim) || (a.category === "Base" ? -1 : b.category === "Base" ? 1 : 0));
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    const notes = [r.category === "Base" ? r.extra : "", r.category !== "Base" && r.extra ? r.extra : "", r.category !== "Base" ? `key=name:${r.item.toLowerCase()}` : "", r.baseNote, r.versions.length > 1 ? `same on versions ${[...new Set(r.versions)].join("/")}` : ""].filter(Boolean).join("; ");
    lines.push([r.year, r.model, r.trim, r.modelCode, r.base, r.category, "", r.item, r.price, "", notes, path.basename(IN), r.url, r.review].map(esc).join(","));
  }
  fs.writeFileSync(OUT, lines.join("\n") + "\n");
  console.log(`${rows.length} rows from ${report.versions} version pages -> ${OUT}`);
  console.log(JSON.stringify({ wheelsDropped: report.wheelsDropped, includedPackages: report.includedPackages, noPriceLines: report.noPrice.length, marketedAs2026_5: report.twoPointFive }));
}
