// OFFLINE replay of an option-policy dry run: reads the NDJSON.gz a dry-run script saved with --dump and runs the same matcher over it, so a policy or alias
// change can be measured without reading the live database again. No network, no database.
//   node 2026-10-14-option-policy-replay.mjs --dump subaru.ndjson.gz [--policy <policy.json>] [--out result.json] [--make Subaru]
// The output has the same shape as the dry-run scripts' result (scopes, untouched, carsInScope ...), plus the cars that would change per scope.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { buildAllowlist, loadBundledModelPoliciesRaw } from "../../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";
import { newTally, addVehicle, finalize } from "../lib/optionPolicyDryRun.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

/** Replays `lines` (an async iterable of NDJSON strings) against `allow`. */
export async function replay(lines, allow, onlyMake = null) {
  const tally = newTally();
  let carsInScope = 0;
  for await (const line of lines) {
    if (!line) continue;
    const c = JSON.parse(line);
    if (onlyMake && c.make !== onlyMake) continue;
    carsInScope++;
    addVehicle(tally, allow, { vin: c.vin, make: c.make, model: c.model, year: c.year, trim: c.trim }, c.options, c.stored || []);
  }
  return { carsInScope, ...finalize(tally) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dumpPath = opt("dump");
  if (!dumpPath) { console.error("--dump <file.ndjson.gz>"); process.exit(2); }
  const policyArg = opt("policy");
  const allow = buildAllowlist(null, policyArg ? JSON.parse(fs.readFileSync(path.resolve(policyArg), "utf8")) : loadBundledModelPoliciesRaw());
  const rl = readline.createInterface({ input: fs.createReadStream(path.resolve(dumpPath)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const result = { replayedAt: new Date().toISOString(), dump: path.basename(dumpPath), ...(await replay(rl, allow, opt("make"))) };
  const outFile = path.resolve(opt("out", "replay_result.json"));
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
  console.log(`${result.carsInScope} cars replayed from ${path.basename(dumpPath)} -> ${outFile}`);
}
