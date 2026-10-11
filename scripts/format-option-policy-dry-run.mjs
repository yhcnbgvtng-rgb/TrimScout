// Turns the JSON from scripts/box/2026-10-11-ford-option-policy-dry-run.mjs into the before/after report.
//   node scripts/format-option-policy-dry-run.mjs <main.json> <what-if.json|-> <out.md> "<title>" "<run description>" [<previous-run.json> "<previous label>"]
import fs from "node:fs";
const [mainPath, altPath, outPath, title = "Option policy dry run", runNote = "", prevPath = null, prevLabel = "the previous run"] = process.argv.slice(2);
const prev = prevPath ? JSON.parse(fs.readFileSync(prevPath, "utf8")) : null;
const main = JSON.parse(fs.readFileSync(mainPath, "utf8"));
const alt = altPath && altPath !== "-" ? JSON.parse(fs.readFileSync(altPath, "utf8")) : null;
const n = (x) => Number(x).toLocaleString("en-US");
const name = (scope) => ({ "ford|f 150|2026": "F-150", "ford|maverick|2026": "Maverick", "ford|ranger|2026": "Ranger", "ford|bronco sport|2026": "Bronco Sport", "ford|bronco|2026": "Bronco" }[scope] || scope);
const order = ["ford|f 150|2026", "ford|maverick|2026", "ford|ranger|2026", "ford|bronco sport|2026", "ford|bronco|2026"].filter((s) => main.scopes[s]);
const md = [];
md.push(`# ${title}`, "", runNote, "");
md.push(`Read-only on box2: ${n(main.dealers)} dealers with Ford stock, ${n(main.cars2026)} in-stock 2026 Fords read in ${n(main.queries)} queries (batches of ${main.batch} dealers, 20 s cap per query), ${main.timeouts} timeouts, slowest query ${n(main.slowestQueryMs)} ms, ${main.elapsedS} s total. Nothing was written, no lock was taken, no facets were rebuilt.`, "");
md.push("## Before and after, per model", "");
md.push("Before = the option rows stored today (`dealer_inventory_options`, what the facets and filters read). After = what the policy keeps from the same vehicle's option list. Kept / removed split the stored rows by whether the policy keeps that line for the vehicle's trim (several stored lines can fold into one policy entry, so kept can exceed the after count).", "");
md.push("| Model | Vehicles | Rows before | Rows kept | Rows removed | Rows after (policy) | Cars with 0 options before | Cars with 0 options after | No trusted trim |", "|---|---|---|---|---|---|---|---|---|");
let T = { v: 0, b: 0, k: 0, r: 0, a: 0 };
for (const s of order) { const v = main.scopes[s]; T.v += v.vehicles; T.b += v.rowsBefore; T.k += v.rowsKept; T.r += v.rowsRemoved; T.a += v.rowsAfter;
  md.push(`| ${name(s)} | ${n(v.vehicles)} | ${n(v.rowsBefore)} | ${n(v.rowsKept)} | ${n(v.rowsRemoved)} | ${n(v.rowsAfter)} | ${v.zeroOptionsBeforePct}% | ${v.zeroOptionsAfterPct}% | ${n(v.noTrustedTrim)} (${(100 * v.noTrustedTrim / v.vehicles).toFixed(1)}%) |`); }
md.push(`| **All five** | ${n(T.v)} | ${n(T.b)} | ${n(T.k)} | ${n(T.r)} | ${n(T.a)} | | | |`, "");
if (prev) {
  md.push(`## Change versus ${prevLabel}`, "", "| Model | Cars with 0 options before | 0 options after: previous | 0 options after: now | Change (points) | Rows after: previous | Rows after: now | No trusted trim: previous | No trusted trim: now |", "|---|---|---|---|---|---|---|---|---|");
  for (const s of order) { const a = prev.scopes[s], b = main.scopes[s]; const d = +(b.zeroOptionsAfterPct - a.zeroOptionsAfterPct).toFixed(1);
    md.push(`| ${name(s)} | ${b.zeroOptionsBeforePct}% | ${a.zeroOptionsAfterPct}% | ${b.zeroOptionsAfterPct}% | ${d > 0 ? "+" : ""}${d} | ${n(a.rowsAfter)} | ${n(b.rowsAfter)} | ${n(a.noTrustedTrim)} | ${n(b.noTrustedTrim)} |`); }
  md.push("");
}
md.push("Average option lines per vehicle in the dealers' feeds, and dealer add-ons set aside (never shown on the website):", "", "| Model | Raw lines / vehicle | Dealer add-ons set aside |", "|---|---|---|");
for (const s of order) md.push(`| ${name(s)} | ${main.scopes[s].rawLinesPerVehicle} | ${n(main.scopes[s].dealerAddons)} |`);
md.push("", "## Top 10 options that remain, per model (vehicles carrying each)", "");
for (const s of order) { md.push(`### ${name(s)}`, "", "| # | Option | Kind | Vehicles |", "|---|---|---|---|"); main.scopes[s].topAfter.forEach((o, i) => md.push(`| ${i + 1} | ${o.label} | ${o.kind} | ${n(o.vehicles)} |`)); md.push(""); }
md.push("## Trims that are not trusted (these cars get no options)", "", "Per the rule \"no trusted trim means no options\". These are the commonest untrusted trims left. As with the Toyota policies, an alias is added only after approval.", "");
for (const s of order) { const v = main.scopes[s]; md.push(`- **${name(s)}** (${n(v.noTrustedTrim)} cars): ${v.topUntrustedTrims.slice(0, 10).map(([t, c]) => `\`${t}\` ${n(c)}`).join(", ")}`); }
md.push("", "Only the approved aliases are applied (see POLICY_REPORT.md); every string above stays untrusted.", "");
if (alt) {
  md.push("## What the \"no interior items\" rule costs", "", "Ford's configurator tags 27 priced options \"Interior\" (Power Moonroof, Integrated Trailer Brake Controller, Pro Power Onboard, Slide-Out Tailgate, Aux Switches and Wiring...). The policy drops them. Same read-only run with them kept:", "", "| Model | Rows after (rule applied) | Rows after (interior kept) | Cars with 0 options after (rule applied) | Cars with 0 options after (interior kept) | Cars that would gain an option |", "|---|---|---|---|---|---|");
  for (const s of order) { const a = main.scopes[s], b = alt.scopes[s]; md.push(`| ${name(s)} | ${n(a.rowsAfter)} | ${n(b.rowsAfter)} | ${a.zeroOptionsAfterPct}% | ${b.zeroOptionsAfterPct}% | ~${n(Math.round(a.vehicles * (a.zeroOptionsAfterPct - b.zeroOptionsAfterPct) / 100))} |`); }
  md.push("", "Top options with the interior items kept:", "");
  for (const s of order) md.push(`- **${name(s)}**: ${alt.scopes[s].topAfter.map((o) => `${o.label} ${n(o.vehicles)}`).join("; ")}`);
  md.push("");
}
md.push("## Untouched", "", `Fords outside the five models, or other model years, were read but not classified: ${main.untouched.slice(0, 12).map(([m, c]) => `${m} ${n(c)}`).join(", ")}.`, "");
fs.writeFileSync(outPath, `${md.join("\n")}\n`);
console.log(`wrote ${outPath}`);
