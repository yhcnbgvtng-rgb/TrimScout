#!/usr/bin/env node
// Materialize dealers/il/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeIlDealerFiles } from '../src/il_policy.js';

const root = process.cwd();
const written = writeIlDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
