#!/usr/bin/env node
// Materialize dealers/ca/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeCaDealerFiles } from '../src/ca_policy.js';

const root = process.cwd();
const written = writeCaDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
