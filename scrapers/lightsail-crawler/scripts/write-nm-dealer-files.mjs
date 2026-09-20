#!/usr/bin/env node
// Materialize dealers/nm/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeNmDealerFiles } from '../src/nm_policy.js';

const root = process.cwd();
const written = writeNmDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
