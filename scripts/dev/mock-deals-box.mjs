// A stand-in for the deals-api (port 3004) that serves a generated, fixed set of cars to the /search page, for looking at the grid without a box:
//   node scripts/dev/mock-deals-box.mjs            then:  LIGHTSAIL_IP=127.0.0.1 LIGHTSAIL_API_KEY=mock OPTIONS_PAID_ONLY=1 npm run dev
// It filters, sorts, pages and counts on the "server" side like the real box does, and reuses the box's own fuel / drivetrain / transmission classifier and
// facet-count folding, so what the grid shows is what a box with the filter-panel patch would send. Set MOCK_BOX_OLD=1 to play a box that has not had
// that patch (no facet-counts endpoint, no catalog extras), MOCK_BOX_PORT to change the port. Not used by any test.
import http from "node:http";
import { classifyDrivetrain, classifyFuel, classifyTransmission } from "../../scrapers/lightsail-crawler/src/inventoryDerived.js";
import { buildFacetCountsResponse, facetedFiltersOf, facetRowsSql } from "../../scrapers/lightsail-crawler/src/facetCounts.js";

const OLD = process.env.MOCK_BOX_OLD === "1";
const PORT = Number(process.env.MOCK_BOX_PORT || 3004);

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const CATALOG = {
  Ford: { F150: ["F-150", ["XL", "XLT", "Lariat", "King Ranch", "Platinum"], "Pickup", "3.5L V6 EcoBoost", 38000, 78000], Bronco: ["Bronco", ["Base", "Big Bend", "Outer Banks", "Badlands 4x4"], "SUV", "2.7L V6", 41000, 72000], Escape: ["Escape", ["S", "SE", "Titanium Hybrid FWD"], "SUV", "2.5L I4", 27000, 41000], MachE: ["Mustang Mach-E", ["Select", "Premium", "GT"], "SUV", "Electric Motor AWD", 38000, 58000] },
  Toyota: { RAV4: ["RAV4", ["LE", "XLE", "Limited", "XSE Hybrid AWD"], "SUV", "2.5L I4", 29000, 45000], Camry: ["Camry", ["LE", "SE", "XSE", "XLE Hybrid"], "Sedan", "2.5L I4", 27000, 40000], Tacoma: ["Tacoma", ["SR", "SR5", "TRD Off-Road 4x4", "Limited"], "Pickup", "2.4L I4 Turbo", 33000, 55000] },
  Kia: { Telluride: ["Telluride", ["LX", "EX", "SX AWD", "X-Pro"], "SUV", "3.8L V6", 38000, 56000], Sportage: ["Sportage", ["LX", "EX", "X-Line AWD", "PHEV"], "SUV", "2.5L I4", 28000, 46000] },
};
const DEALERS = [[1, "Metro Ford", "FL", "Ford"], [2, "Bay Ford", "NJ", "Ford"], [3, "Lakeside Ford", "TX", "Ford"], [4, "Sunrise Toyota", "FL", "Toyota"], [5, "Garden State Toyota", "NJ", "Toyota"], [6, "Alamo Toyota", "TX", "Toyota"], [7, "Coastal Kia", "FL", "Kia"], [8, "Liberty Kia", "NJ", "Kia"]];
const EXT = ["Agate Black", "Oxford White", "Velocity Blue", "Iconic Silver", "Rapid Red", "Carbonized Gray", "Midnight Black Metallic", "Ice Cap"];
const INT = ["Black", "Ebony", "Medium Dark Slate", "Dark Marsala", "Stone"];
const TRANS = ["10-Speed Automatic", "8-Speed Automatic", "CVT", "Single-Speed Automatic", "6-Speed Manual"];
const OPTIONS = [["tow", "Trailer Tow Package", 650], ["pano", "Panoramic Vista Roof", 1595], ["tech", "Technology Package", 1200], ["cold", "Cold Weather Package", 495], ["lux", "Premium Audio", 1050], ["mats", "All-Weather Floor Mats", 0], ["tires", "All-Terrain Tires", 780], ["nav", "Navigation Package", 895]];

const cars = [];
for (let i = 0; i < 900; i++) {
  const d = pick(DEALERS), make = d[3], m = pick(Object.values(CATALOG[make]));
  const cond = rnd() < 0.55 ? "new" : rnd() < 0.8 ? "used" : "cpo";
  const year = cond === "new" ? 2025 + (rnd() < 0.3 ? 1 : 0) : 2018 + Math.floor(rnd() * 7);
  const trimIdx = Math.floor(rnd() * m[1].length);
  const price = Math.round((m[4] + (m[5] - m[4]) * (trimIdx / m[1].length) + rnd() * 4000 - (cond === "new" ? 0 : (2025 - year) * 1800)) / 100) * 100;
  const n = Math.floor(rnd() * 4);
  const options = n === 0 && rnd() < 0.3 ? null : [...OPTIONS].sort(() => rnd() - 0.5).slice(0, n + 1).map(([code, name, p]) => ({ code, name, price: p, kind: "factory" }));
  cars.push({
    vin: `1${make[0]}${String(1000000 + i).padStart(15, "A")}`.slice(0, 17), vehicleId: 1000 + i, dealerId: String(d[0]), dealerName: d[1], dealerCity: "Springfield", dealerState: d[2], condition: cond, year, make,
    model: m[0], trim: m[1][trimIdx], bodyStyle: m[2], exteriorColor: pick(EXT), interiorColor: pick(INT), mileage: cond === "new" ? Math.floor(rnd() * 40) : Math.floor(8000 + rnd() * 70000),
    price, msrp: price + 1500, stockNumber: `S${i}`, vdpUrl: `https://dealer.example/${i}`, imageUrl: null, source: "mock", engine: m[3], transmission: m[3].includes("Electric") ? "Single-Speed Automatic" : pick(TRANS),
    daysOnLot: Math.floor(rnd() * rnd() * 200), oldPrice: null, priceDiff: null, priceChangeType: null, changeType: null, priceHistory: null, options, optionsTotal: options ? options.length : null, baseMsrp: null,
    firstSeenAt: "x", lastSeenAt: "x", removedAt: null, windowStickerUrl: null, crawlFirstSeen: null, sourceBox: "box1",
  });
}
const classes = (c) => ({ fuel: classifyFuel({ trim: c.trim, engine: c.engine, model: c.model }), drive: classifyDrivetrain({ trim: c.trim, engine: c.engine, bodyStyle: c.bodyStyle }), trans: classifyTransmission({ transmission: c.transmission }) });

const all = (sp, k) => sp.getAll(k).filter(Boolean);
const num = (sp, k) => (sp.get(k) ? Number(sp.get(k)) : null);
/** `skipFaceted` leaves out the filters the facet-counts endpoint applies itself. */
function matching(sp, skipFaceted = false) {
  const st = all(sp, "state"), mk = all(sp, "make"), md = all(sp, "model"), tr = all(sp, "trim"), cd = all(sp, "cond");
  const ex = all(sp, "exclude").map((w) => w.toLowerCase()), keys = (sp.get("optionKeys") || "").split(",").filter(Boolean);
  const body = all(sp, "bodyStyle").map((b) => b.toLowerCase()), fuel = all(sp, "fuel"), drv = all(sp, "drivetrain"), trn = all(sp, "transmission"), dl = all(sp, "dealerId");
  const lim = (v, lo, hi) => (lo == null || (v != null && v >= lo)) && (hi == null || (v != null && v <= hi));
  return cars.filter((c) => {
    if (st.length && !st.includes(c.dealerState)) return false;
    if (mk.length && !mk.includes(c.make)) return false;
    if (md.length && !md.includes(c.model)) return false;
    if (tr.length && !tr.includes(c.trim)) return false;
    if (cd.length && !cd.includes(c.condition)) return false;
    if (!lim(c.price, num(sp, "priceMin"), num(sp, "priceMax"))) return false;
    if (sp.get("exteriorColor") && c.exteriorColor !== sp.get("exteriorColor")) return false;
    if (sp.get("interiorColor") && c.interiorColor !== sp.get("interiorColor")) return false;
    if (keys.length && !keys.every((k) => (c.options || []).some((o) => o.code === k))) return false;
    if (ex.length && ex.some((w) => [c.year, c.make, c.model, c.trim, c.exteriorColor, c.interiorColor].join(" ").toLowerCase().includes(w))) return false;
    if (!skipFaceted) {
      if (!lim(c.year, num(sp, "yearMin"), num(sp, "yearMax"))) return false;
      if (!lim(c.mileage, num(sp, "odometerMin"), num(sp, "odometerMax"))) return false;
      if (!lim(c.daysOnLot, num(sp, "minDays"), num(sp, "maxDays"))) return false;
      const k = classes(c);
      if (body.length && !body.includes(c.bodyStyle.toLowerCase())) return false;
      if (fuel.length && !fuel.includes(k.fuel)) return false;
      if (drv.length && !drv.includes(k.drive)) return false;
      if (trn.length && !trn.includes(k.trans)) return false;
      if (dl.length && !dl.includes(c.dealerId)) return false;
    }
    return true;
  });
}
const count = (rows, key, ...labels) => { const m = new Map(); for (const r of rows) { const v = r[key]; if (v) m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ [labels[0]]: v, [labels[1] || "n"]: n })); };
const SORT = { year: "year", make: "make", model: "model", trim: "trim", ext: "exteriorColor", int: "interiorColor", mileage: "mileage", price: "price", dealer: "dealerName", state: "dealerState", days: "daysOnLot", vin: "vin" };

function route(url) {
  const sp = url.searchParams;
  if (url.pathname === "/api/inventory/facets") {
    const base = new URLSearchParams(); if (sp.get("state")) base.set("state", sp.get("state"));
    const byState = matching(new URLSearchParams(sp.get("make") ? { make: sp.get("make") } : {}));
    const rows = matching(base);
    const mkRows = sp.get("make") ? matching(new URLSearchParams([...base, ["make", sp.get("make")]])) : [];
    const mdRows = sp.get("model") ? matching(new URLSearchParams([...base, ["make", sp.get("make")], ["model", sp.get("model")]])) : [];
    return { states: count(byState, "dealerState", "state"), makes: count(rows, "make", "make"), models: sp.get("make") ? count(mkRows, "model", "model") : [], trims: sp.get("model") ? count(mdRows, "trim", "trim") : [] };
  }
  if (url.pathname === "/api/inventory/catalog") {
    const q = new URLSearchParams(); for (const k of ["make", "model", "trim"]) if (sp.get(k)) q.set(k, sp.get(k));
    const rows = matching(q);
    const opt = new Map();
    for (const c of rows) for (const o of c.options || []) { const e = opt.get(o.code) || { key: o.code, label: o.name, vehicleCount: 0, minPrice: o.price, maxPrice: o.price }; e.vehicleCount++; opt.set(o.code, e); }
    const out = { options: sp.get("model") ? [...opt.values()].sort((a, b) => b.vehicleCount - a.vehicleCount) : [], exteriorColors: count(rows, "exteriorColor", "color").map((x) => x.color), interiorColors: count(rows, "interiorColor", "color").map((x) => x.color) };
    if (!OLD && sp.get("make")) {
      out.exteriorColorCounts = count(rows, "exteriorColor", "color"); out.interiorColorCounts = count(rows, "interiorColor", "color");
      out.conditionCounts = { new: rows.filter((c) => c.condition === "new").length, used: rows.filter((c) => c.condition === "used").length, cpo: rows.filter((c) => c.condition === "cpo").length };
      const hist = (rs) => { const h = Array(31).fill(0); for (const c of rs) h[Math.min(30, Math.floor(c.price / 5000))]++; return h; };
      out.priceHistogram = { width: 5000, top: 150000, all: hist(rows), new: hist(rows.filter((c) => c.condition === "new")), used: hist(rows.filter((c) => c.condition === "used")), cpo: hist(rows.filter((c) => c.condition === "cpo")) };
    }
    return out;
  }
  if (url.pathname === "/api/inventory/facet-counts") {
    if (OLD) return null;
    const rows = matching(sp, true).map((c) => { const k = classes(c); return { year: c.year, mileage: c.mileage, body: c.bodyStyle, days: c.daysOnLot, dealer_id: c.dealerId, dealer_name: c.dealerName, fuel: k.fuel, drive: k.drive, trans: k.trans }; });
    return buildFacetCountsResponse(rows, 40000, facetedFiltersOf(sp));
  }
  if (url.pathname === "/api/inventory") {
    if (!sp.get("make")) return { error: "make required" };
    let rows = matching(sp);
    const sort = (sp.get("sort") || "").split(":");
    const col = SORT[sort[0]];
    if (col) { const dir = sort[1] === "desc" ? -1 : 1; rows = [...rows].sort((a, b) => ((a[col] ?? "") > (b[col] ?? "") ? 1 : (a[col] ?? "") < (b[col] ?? "") ? -1 : 0) * dir); }
    const limit = Math.min(Number(sp.get("limit")) || 50, 100), offset = Number(sp.get("offset")) || 0;
    const applied = ["odometerMin", "bodyStyle", "fuel", "drivetrain", "transmission", "dealerId", "vinPattern"].filter((k) => !OLD && sp.has(k));
    return { total: rows.length, totalCapped: false, limit, offset, vehicles: rows.slice(offset, offset + limit), excludeApplied: sp.getAll("exclude"), ...(OLD ? {} : { filtersApplied: applied }) };
  }
  return { error: "not mocked" };
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const body = route(url);
  const status = body === null ? 404 : body.error ? 400 : 200;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body ?? { error: "not found" }));
}).listen(PORT, "127.0.0.1", () => console.log(`mock deals box on :${PORT}${OLD ? " (old box: no filter-panel patch)" : ""}, ${cars.length} cars`));
