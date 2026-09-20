#!/usr/bin/env node
// Materialize dealers/mo/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeMoDealerFiles } from '../src/mo_policy.js';

const root = process.cwd();
const written = writeMoDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
