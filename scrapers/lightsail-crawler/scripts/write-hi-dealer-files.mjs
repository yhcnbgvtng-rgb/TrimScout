#!/usr/bin/env node
// Materialize dealers/hi/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeHiDealerFiles } from '../src/hi_policy.js';

const root = process.cwd();
const written = writeHiDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
