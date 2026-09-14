#!/usr/bin/env node
// Materialize dealers/nj/<brand>.json from the curated seed so cron can
// point CRAWLER_DEALERS_FILE at one brand file.

import fs from 'node:fs/promises';
import path from 'node:path';
import { NJ_BRANDS_IN, loadNjDealers, canonicalBrandName } from '../src/nj_policy.js';

const root = path.resolve(process.cwd());
const outDir = path.join(root, 'dealers', 'nj');
await fs.mkdir(outDir, { recursive: true });

for (const brand of NJ_BRANDS_IN) {
  const dealers = loadNjDealers({ cwd: root, brand });
  const slug = canonicalBrandName(brand).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dest = path.join(outDir, `${slug}.json`);
  await fs.writeFile(dest, `${JSON.stringify(dealers, null, 2)}\n`);
  const replaced = dealers.filter((d) => d.previousDomain);
  console.log(`wrote ${dest} (${dealers.length} rooftops${replaced.length ? `, ${replaced.length} domain overlay(s)` : ''})`);
  for (const d of replaced) {
    console.log(`  ${d.name}: ${d.previousDomain} -> ${d.domain} (${d.domainSource})`);
  }
}
