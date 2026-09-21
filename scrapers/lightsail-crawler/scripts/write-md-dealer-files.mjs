#!/usr/bin/env node
// Materialize dealers/md/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeMdDealerFiles } from '../src/md_policy.js';

const root = process.cwd();
const written = writeMdDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
