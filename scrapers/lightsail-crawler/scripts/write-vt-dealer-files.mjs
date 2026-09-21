#!/usr/bin/env node
// Materialize dealers/vt/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeVtDealerFiles } from '../src/vt_policy.js';

const root = process.cwd();
const written = writeVtDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
