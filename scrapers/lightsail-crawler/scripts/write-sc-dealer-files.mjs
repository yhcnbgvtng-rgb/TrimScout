#!/usr/bin/env node
// Materialize dealers/sc/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeScDealerFiles } from '../src/sc_policy.js';

const root = process.cwd();
const written = writeScDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
