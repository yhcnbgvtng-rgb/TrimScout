#!/usr/bin/env node
// Materialize dealers/tx/<brand>.json from in-repo OEM locators and
// listing-verified hosts. No brandofcity guesses.

import { writeTxDealerFiles } from '../src/tx_policy.js';

const root = process.cwd();
const written = writeTxDealerFiles(root);
for (const row of written) {
  console.log(`wrote ${row.dest} (${row.count} rooftops)`);
}
