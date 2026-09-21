#!/usr/bin/env node
// Materialize dealers/wi/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeWiDealerFiles } from '../src/wi_policy.js';

const root = process.cwd();
const written = writeWiDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
