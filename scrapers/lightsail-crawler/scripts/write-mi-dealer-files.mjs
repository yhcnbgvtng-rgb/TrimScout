#!/usr/bin/env node
// Materialize dealers/mi/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeMiDealerFiles } from '../src/mi_policy.js';

const root = process.cwd();
const written = writeMiDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
