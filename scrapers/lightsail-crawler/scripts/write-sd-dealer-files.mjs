#!/usr/bin/env node
// Materialize dealers/sd/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeSdDealerFiles } from '../src/sd_policy.js';

const root = process.cwd();
const written = writeSdDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
