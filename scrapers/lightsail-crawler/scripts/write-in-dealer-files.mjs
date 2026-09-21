#!/usr/bin/env node
// Materialize dealers/in/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeInDealerFiles } from '../src/in_policy.js';

const root = process.cwd();
const written = writeInDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
