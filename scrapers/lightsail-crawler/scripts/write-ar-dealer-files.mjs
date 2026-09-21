#!/usr/bin/env node
// Materialize dealers/ar/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeArDealerFiles } from '../src/ar_policy.js';

const root = process.cwd();
const written = writeArDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
