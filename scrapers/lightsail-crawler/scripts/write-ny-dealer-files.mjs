#!/usr/bin/env node
// Materialize dealers/ny/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeNyDealerFiles } from '../src/ny_policy.js';

const root = process.cwd();
const written = writeNyDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
