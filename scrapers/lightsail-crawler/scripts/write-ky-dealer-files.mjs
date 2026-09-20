#!/usr/bin/env node
// Materialize dealers/ky/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeKyDealerFiles } from '../src/ky_policy.js';

const root = process.cwd();
const written = writeKyDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
