#!/usr/bin/env node
// Materialize dealers/ma/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeMaDealerFiles } from '../src/ma_policy.js';

const root = process.cwd();
const written = writeMaDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
