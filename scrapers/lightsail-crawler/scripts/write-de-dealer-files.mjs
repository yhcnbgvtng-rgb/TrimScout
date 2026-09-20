#!/usr/bin/env node
// Materialize dealers/de/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeDeDealerFiles } from '../src/de_policy.js';

const root = process.cwd();
const written = writeDeDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
