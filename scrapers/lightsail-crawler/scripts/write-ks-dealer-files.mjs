#!/usr/bin/env node
// Materialize dealers/ks/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeKsDealerFiles } from '../src/ks_policy.js';

const root = process.cwd();
const written = writeKsDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
