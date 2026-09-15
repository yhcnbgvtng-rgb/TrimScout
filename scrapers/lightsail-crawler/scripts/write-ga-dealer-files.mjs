#!/usr/bin/env node
// Materialize dealers/ga/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeGaDealerFiles } from '../src/ga_policy.js';

const root = process.cwd();
const written = writeGaDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
