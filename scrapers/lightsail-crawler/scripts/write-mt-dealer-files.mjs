#!/usr/bin/env node
// Materialize dealers/mt/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeMtDealerFiles } from '../src/mt_policy.js';

const root = process.cwd();
const written = writeMtDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
