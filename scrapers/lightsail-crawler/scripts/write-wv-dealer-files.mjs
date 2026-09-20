#!/usr/bin/env node
// Materialize dealers/wv/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeWvDealerFiles } from '../src/wv_policy.js';

const root = process.cwd();
const written = writeWvDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
