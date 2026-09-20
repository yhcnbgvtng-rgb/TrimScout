#!/usr/bin/env node
// Materialize dealers/la/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeLaDealerFiles } from '../src/la_policy.js';

const root = process.cwd();
const written = writeLaDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
