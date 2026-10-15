// Builds docs/option-catalogs-2026-10-14/mazda_lineup_options_by_trim.csv from mazdausa.com's own public Build & Price data.
// Source of record: docs/option-catalogs-2026-10-14/mazda_build_price_data.json - the paid lines (and nothing else) of each trim, condensed from the
// JSON the public Build & Price page loads for itself: https://www.mazdausa.com/api/bp?m=<model code>&t=<trim code>  (plain GET, no login, no cookies, robots.txt
// allows it, one request per second). Nothing is fetched through a browser and nothing is captured that a plain client is refused.
//   node scripts/build_mazda_option_catalog.mjs --fetch      re-read mazdausa.com and rewrite the capture (stops on the first 403 / challenge / non-JSON answer)
//   node scripts/build_mazda_option_catalog.mjs              rebuild the CSV from the capture
// Rules (same as every option policy): every paid factory sticker line stays; $0 items, accessories, dealer add-ons and subscriptions are dropped.
//   kept     paid exterior colors, paid interior colors / materials, paid packages. Trim base MSRP is the Base row (destination is not in it).
//   dropped  the "accessories" lists (port / dealer-installed), $0 colors and packages, standard features.
//   2027     the site answers {"response":{}} for every 2027 model code (no 2027 Build & Price yet): recorded in the capture as a model-year gap, no rows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(root, "docs/option-catalogs-2026-10-14");
const CAPTURE = path.join(DIR, "mazda_build_price_data.json");
const OUT = path.join(DIR, "mazda_lineup_options_by_trim.csv");
export const HEADER = ["year", "model", "trim", "model_code", "trim_base_msrp", "category", "subcategory", "item", "price_usd", "contents", "notes", "source_file", "source_url", "needs_review"];
// model-year prefix + model code -> [DB-style model name, trim codes]. Trim codes are the ones the site links from each vehicle page.
export const MODELS = {
  "CX5": ["CX-5", ["CX525S", "CX5SE", "CX5PF", "CX5PR", "CX5PP"]],
  "C30": ["CX-30", ["C3025S", "C30SES", "C30PF", "C30PR", "C30CE", "C30AE", "C30AET", "C30PPT"].map((c) => c)],
  "C50": ["CX-50", ["C5025T", "C50SE", "C50PF", "C50PR", "C50MR", "C50MRT", "C50PPT"]],
  "50H": ["CX-50 Hybrid", ["50HPF", "50HPR", "50HPP"]],
  "C70": ["CX-70", ["C70PF", "C70PR", "C70PP", "C70SPR", "C70SPP"]],
  "C7P": ["CX-70 PHEV", ["C7PSC", "C7PSCP"]],
  "C90": ["CX-90", ["C90SE", "C90PF", "C90PR", "C90PP", "C90SPR", "C90SPP"]],
  "C9P": ["CX-90 PHEV", ["C9PPF", "C9PPR", "C9PPP"]],
  "M3S": ["Mazda3 Sedan", ["M3S25S", "M3SSES", "M3SPF", "M3SCE", "M3SPPT"]],
  "M3H": ["Mazda3 Hatchback", ["M3H25S", "M3HSES", "M3HPF", "M3HPR", "M3HCE", "M3HPPT"]],
  "MX5": ["MX-5 Miata", ["MX5SP", "MX5CL", "MX5GT"]],
  "MXR": ["MX-5 Miata RF", ["MXRCL", "MXRGT"]],
};
// The model code is the year + family; the CX-50 Hybrid family is "650H" -> "2650H" on the site (year + 50H).
const modelCode = (yy, fam) => `${yy}${fam}`;
const trimCode = (yy, c) => `${yy}${c}`;
const YEARS = [{ yy: "26", year: 2026 }, { yy: "27", year: 2027 }];
const UA = "Mozilla/5.0 (compatible; TrimScout-catalog/1.0)";

const strip = (s) => String(s ?? "").replace(/<sup[^>]*>.*?<\/sup>/gis, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
// The site spells some trims in capitals ("2.5 S PREMIUM PLUS"); mixed-case titles are kept as they are.
const titleCase = (s) => (/[a-z]/.test(s) ? s : s.split(" ").map((w) => (/^(PHEV|SC|S)$/.test(w) || /\d/.test(w) ? w : w[0] + w.slice(1).toLowerCase())).join(" "));
const esc = (v) => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

async function fetchAll() {
  const out = { source: "https://www.mazdausa.com/api/bp?m=<model code>&t=<trim code> (public Build & Price JSON)", fetchedAt: new Date().toISOString(), gaps: [], trims: [] };
  for (const { yy, year } of YEARS) {
    for (const [fam, [model, trims]] of Object.entries(MODELS)) {
      let missing = true;
      for (const tc of trims) {
        const m = modelCode(yy, fam), t = trimCode(yy, tc);
        const res = await fetch(`https://www.mazdausa.com/api/bp?m=${m}&t=${t}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
        const type = res.headers.get("content-type") || "";
        if (res.status === 403 || res.status === 429 || !/json/i.test(type)) throw new Error(`BLOCKED or not JSON (${res.status} ${type}) for ${m}/${t} - stopping on this brand`);
        const body = await res.json();
        await new Promise((r) => setTimeout(r, 1000));
        const d = body.response;
        if (!d || !d.trims) break; // {"response":{}}: this model year is not on the site
        missing = false;
        const tr = d.trims.find((x) => x.code === t);
        if (!tr) throw new Error(`${m}/${t}: trim not in its own response`);
        out.trims.push({
          year, model, modelCode: m, trimCode: t, trim: tr.title, baseMsrp: tr.basePrice.amount, url: `https://www.mazdausa.com/shopping-tools/build-and-price#/${m}/${t}`, api: `api/bp?m=${m}&t=${t}`,
          paints: (d.exterior?.exteriorColors?.options || []).filter((c) => c.price > 0).map((c) => ({ code: c.code, title: strip(c.title), price: c.price })),
          roofs: (d.exterior?.roofColors?.options || []).filter((c) => c.price > 0).map((c) => ({ code: c.code, title: strip(c.title), price: c.price })),
          interiors: (d.interior?.interiorColors?.options || []).filter((c) => c.price > 0).map((c) => ({ code: c.code, title: strip(c.title), price: c.price })),
          packages: (d.packagesAccessories?.packages || []).filter((p) => p.price > 0).map((p) => ({ code: p.code, title: strip(p.title), price: p.price })),
          accessoriesDropped: (d.packagesAccessories?.accessories || []).length,
        });
      }
      if (missing) out.gaps.push({ year, model, reason: "mazdausa.com returns an empty Build & Price response for this model year" });
    }
  }
  fs.writeFileSync(CAPTURE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`captured ${out.trims.length} trims, ${out.gaps.length} model-year gaps`);
}

export function buildCsv(capture) {
  const rows = [];
  const base = (t, extra) => [t.year, t.model, titleCase(t.trim), t.trimCode, t.baseMsrp, ...extra, "mazda_build_price_data.json", t.url];
  for (const t of capture.trims) {
    rows.push(base(t, ["Base", "", "Base Price (trim MSRP)", t.baseMsrp, "", "Destination not included"]).concat([""]));
    const add = (category, sub, list, label) => { for (const c of list) rows.push(base(t, [category, sub, c.title, c.price, "", `key=${c.code}; ${label}`]).concat([/\(/.test(c.title) ? "name carries a condition in parentheses; confirm it is the same package on every trim" : ""])); };
    add("Exterior color", "", t.paints, "paid exterior color");
    add("Exterior color", "Roof", t.roofs, "paid roof color");
    add("Factory option", "Interior", t.interiors, "paid interior color / material");
    add("Factory package", "", t.packages, "paid package");
  }
  return `${[HEADER, ...rows].map((r) => r.map(esc).join(",")).join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--fetch")) await fetchAll();
  const capture = JSON.parse(fs.readFileSync(CAPTURE, "utf8"));
  fs.writeFileSync(OUT, buildCsv(capture));
  console.log(`wrote ${path.relative(root, OUT)}`);
}
