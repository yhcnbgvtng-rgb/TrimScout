#!/usr/bin/env node
// Materialize dealers/ri/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeRiDealerFiles } from '../src/ri_policy.js';

const root = process.cwd();
const written = writeRiDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
