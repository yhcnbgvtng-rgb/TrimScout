#!/usr/bin/env node
// Materialize dealers/tn/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeTnDealerFiles } from '../src/tn_policy.js';

const root = process.cwd();
const written = writeTnDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
