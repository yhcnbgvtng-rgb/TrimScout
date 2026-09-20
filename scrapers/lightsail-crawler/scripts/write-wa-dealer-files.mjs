#!/usr/bin/env node
// Materialize dealers/wa/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeWaDealerFiles } from '../src/wa_policy.js';

const root = process.cwd();
const written = writeWaDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
