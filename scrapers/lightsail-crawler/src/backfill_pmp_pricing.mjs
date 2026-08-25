#!/usr/bin/env node
// The original Paul Miller Porsche Finder pilot (217 VINs) sourced options
// from finder.porsche.com, which has real, itemized option names but no
// per-option pricing. Paul Miller Porsche's own site (paulmillerporsche.com)
// is a Dealer.com site and — once the null-bucket price-filtering bug was
// fixed — DOES have real, priced options for these same VINs (confirmed on
// VIN WP0AA2YAXTL007731: dealer page lists "Premium Package" at $7,620 with
// itemized $-priced sub-options). This backfills real pricing from the
// dealer's own page while keeping the richer Finder-sourced
// standardEquipment list as supplementary context.

import { gotScraping } from "got-scraping";
import fs from "node:fs";
import vm from "node:vm";

const INVENTORY_PATH =
  "/Users/paul/Claude - GitHub/TrimScout/data/lightsail_inventory.json";

function extractDealerListedOptions(raw) {
  const items = [];
  if (!Array.isArray(raw.packages)) return items;

  for (const pkg of raw.packages) {
    const isNamedPackage = Boolean(pkg.packageName) && pkg.packageName !== "null";

    if (isNamedPackage) {
      items.push({
        code: `PKG-${pkg.id ?? pkg.packageName}`,
        name: pkg.packageName,
        price: typeof pkg.msrp === "number" ? pkg.msrp : 0,
        category: "package",
      });
    }

    const optionList = Array.isArray(pkg.includedOptionList)
      ? pkg.includedOptionList
      : Array.isArray(pkg.includedOptions)
      ? pkg.includedOptions
      : [];

    for (const opt of optionList) {
      const description = opt.textMap && opt.textMap.description;
      if (!description) continue;
      const price = typeof opt.msrPrice === "number" ? opt.msrPrice : 0;
      if (!isNamedPackage && price <= 0) continue;
      items.push({
        code: opt.textMap.id && opt.textMap.id !== "null" ? `OPT-${opt.textMap.id}` : "OPT",
        name: description,
        price,
        category: "option",
      });
    }
  }

  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.code}|${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf-8"));
  const targets = inventory.filter(
    (v) => v.optionsSource === "PORSCHE_FINDER" && v.url && !v.url.includes(".porsche.com/")
  );

  console.log(`Targets: ${targets.length}`);

  let updated = 0;
  let noPricedData = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const v = targets[i];
    process.stdout.write(`[${i + 1}/${targets.length}] ${v.vin} `);
    try {
      const res = await gotScraping(v.url, { timeout: { request: 15000 }, retry: { limit: 1 } });
      const ddcMatch =
        res.body.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/) ||
        res.body.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);
      if (!ddcMatch) {
        console.log("-> no DDC data on dealer page, keeping Finder-only data");
        noPricedData++;
        continue;
      }
      const sandbox = {};
      vm.runInNewContext("vehicles = " + ddcMatch[1], sandbox);
      const raw = sandbox.vehicles && sandbox.vehicles[0];
      const priced = raw ? extractDealerListedOptions(raw) : [];
      if (priced.length === 0) {
        console.log("-> DDC present but no priced options, keeping Finder-only data");
        noPricedData++;
        continue;
      }

      v.factoryOptions = priced;
      v.optionCodes = priced.map((o) => o.code);
      v.totalOptionsPrice = priced.reduce((sum, o) => sum + (o.price || 0), 0);
      v.optionsSource = "DEALER_VDP";
      // standardEquipment / finderUrl deliberately left untouched — still
      // real, still valuable, just no longer the pricing source.
      v.enrichedAt = new Date().toISOString();
      updated++;
      console.log(`-> updated with real pricing (${priced.length} options, $${v.totalOptionsPrice.toLocaleString()})`);
    } catch (err) {
      failed++;
      console.log(`-> ERROR ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory));

  console.log("\n=== DONE ===");
  console.log(`Updated with real pricing: ${updated}`);
  console.log(`No priced dealer data found (kept as-is): ${noPricedData}`);
  console.log(`Failed: ${failed}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
