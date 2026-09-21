#!/usr/bin/env node
// Materialize dealers/va/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeVaDealerFiles } from '../src/va_policy.js';

const root = process.cwd();
const written = writeVaDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
