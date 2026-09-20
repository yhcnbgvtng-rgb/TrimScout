#!/usr/bin/env node
// Materialize dealers/az/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeAzDealerFiles } from '../src/az_policy.js';

const root = process.cwd();
const written = writeAzDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
