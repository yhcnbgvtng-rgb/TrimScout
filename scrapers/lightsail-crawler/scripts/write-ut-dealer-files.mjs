#!/usr/bin/env node
// Materialize dealers/ut/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeUtDealerFiles } from '../src/ut_policy.js';

const root = process.cwd();
const written = writeUtDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
