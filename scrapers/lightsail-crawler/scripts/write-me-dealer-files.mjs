#!/usr/bin/env node
// Materialize dealers/me/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeMeDealerFiles } from '../src/me_policy.js';

const root = process.cwd();
const written = writeMeDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
