#!/usr/bin/env node
// Materialize dealers/id/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeIdDealerFiles } from '../src/id_policy.js';

const root = process.cwd();
const written = writeIdDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
