// Builds lib/data/zcta.json from the US Census ZCTA gazetteer (public domain).
//   curl -O https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip && unzip 2023_Gaz_zcta_national.zip
//   node scripts/build-zcta.mjs 2023_Gaz_zcta_national.txt
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 7);
const out = {};
for (const c of rows) out[c[0]] = [Number(Number(c[5]).toFixed(4)), Number(Number(c[6]).toFixed(4))];
fs.writeFileSync(new URL("../lib/data/zcta.json", import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, "ZCTAs");
