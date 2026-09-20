#!/usr/bin/env node
// Materialize dealers/co/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeCoDealerFiles } from '../src/co_policy.js';

const root = process.cwd();
const written = writeCoDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
