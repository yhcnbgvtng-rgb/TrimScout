#!/usr/bin/env node
// Materialize dealers/ia/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeIaDealerFiles } from '../src/ia_policy.js';

const root = process.cwd();
const written = writeIaDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
