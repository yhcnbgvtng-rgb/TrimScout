#!/usr/bin/env node
// Materialize dealers/or/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeOrDealerFiles } from '../src/or_policy.js';

const root = process.cwd();
const written = writeOrDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
