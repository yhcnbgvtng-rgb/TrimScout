#!/usr/bin/env node
// Materialize dealers/ct/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeCtDealerFiles } from '../src/ct_policy.js';

const root = process.cwd();
const written = writeCtDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
