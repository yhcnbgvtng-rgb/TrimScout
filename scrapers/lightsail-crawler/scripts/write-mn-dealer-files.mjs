#!/usr/bin/env node
// Materialize dealers/mn/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeMnDealerFiles } from '../src/mn_policy.js';

const root = process.cwd();
const written = writeMnDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
