#!/usr/bin/env node
// Materialize dealers/al/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeAlDealerFiles } from '../src/al_policy.js';

const root = process.cwd();
const written = writeAlDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
