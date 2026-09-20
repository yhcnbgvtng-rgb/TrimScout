#!/usr/bin/env node
// Materialize dealers/ok/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeOkDealerFiles } from '../src/ok_policy.js';

const root = process.cwd();
const written = writeOkDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
