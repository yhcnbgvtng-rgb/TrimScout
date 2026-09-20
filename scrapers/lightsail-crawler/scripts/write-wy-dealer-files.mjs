#!/usr/bin/env node
// Materialize dealers/wy/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeWyDealerFiles } from '../src/wy_policy.js';

const root = process.cwd();
const written = writeWyDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
