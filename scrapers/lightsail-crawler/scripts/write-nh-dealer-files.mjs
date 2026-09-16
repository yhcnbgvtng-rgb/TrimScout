#!/usr/bin/env node
// Materialize dealers/nh/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeNhDealerFiles } from '../src/nh_policy.js';

const root = process.cwd();
const written = writeNhDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
