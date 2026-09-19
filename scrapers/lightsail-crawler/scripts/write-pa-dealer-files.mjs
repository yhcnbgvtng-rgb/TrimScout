#!/usr/bin/env node
// Materialize dealers/pa/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writePaDealerFiles } from '../src/pa_policy.js';

const root = process.cwd();
const written = writePaDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
