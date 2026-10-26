// Regenerates scripts/box/2026-10-26-facet-extras.mjs from the edit list and the module in the repo.
//   node scripts/box/gen-facet-extras-patch.mjs          write the patcher
//   node scripts/box/gen-facet-extras-patch.mjs --check  exit 1 if the checked-in patcher is out of date (the test does the same)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export function buildPatcher() {
  const edits = JSON.parse(fs.readFileSync(path.join(here, "facet-extras-edits.json"), "utf8"));
  const moduleText = fs.readFileSync(path.join(here, "../../scrapers/lightsail-crawler/src/facetExtras.js"), "utf8");
  const template = fs.readFileSync(path.join(here, "facet-extras-patch.template.mjs"), "utf8");
  return template.replace("/*EDITS*/null", () => JSON.stringify(edits, null, 1)).replace("/*MODULE_TEXT*/null", () => JSON.stringify(moduleText));
}
export const PATCHER_PATH = path.join(here, "2026-10-26-facet-extras.mjs");
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildPatcher();
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(PATCHER_PATH) || fs.readFileSync(PATCHER_PATH, "utf8") !== out) { console.error("2026-10-26-facet-extras.mjs is out of date: run node scripts/box/gen-facet-extras-patch.mjs"); process.exit(1); }
  } else { fs.writeFileSync(PATCHER_PATH, out); console.log(`wrote ${PATCHER_PATH}`); }
}
