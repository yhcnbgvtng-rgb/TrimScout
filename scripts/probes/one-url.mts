import { importPastedFactoryVehicle } from "../../lib/pasteImport";
const url = process.argv[2];
if (!url) { console.error("usage: npx tsx scripts/probes/one-url.mts <url-or-vin>"); process.exit(1); }
const localFetch: typeof fetch = (input, init) =>
  fetch(typeof input === "string" && input.startsWith("/") ? "http://localhost:3000" + input : input, init);
const r: any = await importPastedFactoryVehicle(url, localFetch);
if (!r.ok) { console.log("FAIL:", r.reason ?? "(no reason)", "—", r.error); }
else { const v = r.vehicle; console.log(`OK: "${[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")}" vin=${v.vin} dealer=${v.location?.dealerName || "(none)"} confidence=${r.buildConfidence}`); }
