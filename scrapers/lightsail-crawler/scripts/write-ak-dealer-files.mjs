#!/usr/bin/env node
// Materialize dealers/ak/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeAkDealerFiles } from '../src/ak_policy.js';

const root = process.cwd();
const written = writeAkDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
