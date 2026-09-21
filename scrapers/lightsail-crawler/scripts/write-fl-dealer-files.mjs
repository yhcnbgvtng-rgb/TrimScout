#!/usr/bin/env node
// Materialize dealers/fl/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeFlDealerFiles } from '../src/fl_policy.js';

const root = process.cwd();
const written = writeFlDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
