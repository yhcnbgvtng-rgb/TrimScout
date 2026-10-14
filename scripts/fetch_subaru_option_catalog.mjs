// Builds docs/option-catalogs-2026-10-14/subaru_lineup_options_by_trim.csv from subaru.com's own public build-and-price JSON (the same two GET endpoints the
// Build & Price pages call; no login, no cookies, default headers). Model years 2026 and 2027 only.
//   /services/vehicles/models/basicdata                       the model list (year, code, name)
//   /services/vehicles/trims/limiteddetails/<year>/<code>     trims, option packages (msrp), exterior colors (msrp), transmissions (msrp)
// Kept: option packages, exterior colors and transmission upcharges with price > 0. Dropped: $0 items, interior colors (the feed prices none), Starlink
// (a subscription), accessories (not in this feed). One row per sticker line, source URL on every row; a package whose name the site does not publish
// ("Optional Package") is named "Option Package <site code>" and flagged in needs_review.
// Run: node scripts/fetch_subaru_option_catalog.mjs [--out <csv>]    A non-200 (a block, a WAF page) stops the run; nothing is retried or worked around.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const out = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(root, "docs/option-catalogs-2026-10-14/subaru_lineup_options_by_trim.csv"));
const BASE = "https://www.subaru.com";
const YEARS = [2026, 2027];

const get = async (p) => {
  const res = await fetch(BASE + p, { headers: { accept: "application/json" } });
  const ct = res.headers.get("content-type") || "";
  if (res.status !== 200 || !ct.includes("json")) throw new Error(`STOP: ${p} -> HTTP ${res.status} ${ct} (blocked or changed); not retrying or working around`);
  return res.json();
};
const esc = (v) => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export function rowsFor(year, modelName, modelCode, trims, url) {
  const rows = [];
  for (const t of trims) {
    const push = (category, subcategory, item, price, contents, notes, review) =>
      rows.push([year, modelName, t.name, t.code, t.msrp, category, subcategory, item, price, contents, notes, `services/vehicles/trims/limiteddetails/${year}/${modelCode}`, url, review]);
    push("Base", "", "Base Price (trim MSRP)", t.msrp, "", "Destination not in this feed (site shows $0)", "");
    for (const c of t.exteriorColors || []) {
      if (!(c.msrp > 0)) continue;
      const rp = c.requiredPackages || [];
      push("Exterior color", "", strip(c.name), c.msrp, "", rp.length ? `requires package code(s) ${rp.join("/")}` : "", "");
    }
    for (const tr of t.transmissions || []) {
      const tn = strip(tr.name);
      if (tr.msrp > 0) push("Powertrain", "Transmission", tn, tr.msrp, "", "transmission upcharge vs the trim base", "");
      for (const p of tr.optionPackages || []) {
        if (!(p.msrp > 0)) continue;
        const generic = /^Optional Package$/i.test(p.name);
        const name = generic ? `Option Package ${p.code}` : strip(p.name);
        push("Factory package", "", name, p.msrp, (p.features || []).map((f) => strip(f.name)).join("; "), `key=name:${name.toLowerCase()}; site package code ${p.code}`,
          generic ? "Package name built from the site's package code; Subaru's sticker wording is not published on the site" : "");
      }
    }
  }
  return rows;
}

export const HEADER = ["year", "model", "trim", "model_code", "trim_base_msrp", "category", "subcategory", "item", "price_usd", "contents", "notes", "source_file", "source_url", "needs_review"];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const models = (await get("/services/vehicles/models/basicdata")).filter((m) => YEARS.includes(m.year) && m.active);
  const all = [];
  for (const m of models) {
    const p = `/services/vehicles/trims/limiteddetails/${m.year}/${m.code}`;
    all.push(...rowsFor(m.year, m.name, m.code, await get(p), BASE + p));
    await new Promise((r) => setTimeout(r, 400));
  }
  all.sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(b[1]) || String(a[2]).localeCompare(b[2]));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, [HEADER, ...all].map((r) => r.map(esc).join(",")).join("\n") + "\n");
  console.log(`${all.length} rows, ${models.length} model-years -> ${out}`);
}
