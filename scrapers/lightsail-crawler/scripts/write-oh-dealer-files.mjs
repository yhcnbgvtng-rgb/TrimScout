#!/usr/bin/env node
// Materialize dealers/oh/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeOhDealerFiles } from '../src/oh_policy.js';

const root = process.cwd();
const written = writeOhDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
