#!/usr/bin/env node
// Materialize dealers/nc/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeNcDealerFiles } from '../src/nc_policy.js';

const root = process.cwd();
const written = writeNcDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
