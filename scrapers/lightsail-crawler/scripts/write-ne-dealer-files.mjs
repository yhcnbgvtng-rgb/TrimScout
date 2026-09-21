#!/usr/bin/env node
// Materialize dealers/ne/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeNeDealerFiles } from '../src/ne_policy.js';

const root = process.cwd();
const written = writeNeDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
