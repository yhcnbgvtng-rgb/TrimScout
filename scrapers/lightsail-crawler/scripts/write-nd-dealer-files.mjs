#!/usr/bin/env node
// Materialize dealers/nd/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeNdDealerFiles } from '../src/nd_policy.js';

const root = process.cwd();
const written = writeNdDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
