#!/usr/bin/env node
// Materialize dealers/nv/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeNvDealerFiles } from '../src/nv_policy.js';

const root = process.cwd();
const written = writeNvDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
