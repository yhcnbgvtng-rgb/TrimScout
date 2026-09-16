// Single source of truth for which states this crawler covers today.
//
// Adding a new state means: append it here, add a <state>_policy.js loader
// (mirroring ny_policy.js, which itself mirrors nj_policy.js), a
// scripts/write-<state>-dealer-files.mjs script, a loader entry in
// scripts/dealer-bot-report.mjs and scripts/run-daily-crawl.mjs, and
// state-specific zip/city seeds in scripts/fetch-oem-dealer-locators.mjs.
// Nothing else in the pipeline should hardcode a state list — standalone.js
// already reads CRAWLER_STATE / the dealer record's own `state` field and
// needs no change per state.
export const SUPPORTED_STATES = ['NJ', 'NY', 'FL', 'GA', 'TX', 'SC', 'VA', 'NC', 'RI', 'VT', 'NH'];

export function isSupportedState(state) {
  return SUPPORTED_STATES.includes(String(state || '').trim().toUpperCase());
}
