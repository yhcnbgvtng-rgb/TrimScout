import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isProcessAlive } from '../src/pid_lock.js';

// Extracted out of scripts/run-daily-crawl.mjs so shared_data_lock.js can
// reuse the exact same "is the PID that wrote this lock file still alive"
// check the driver's own overlap guard already relies on (see that
// module's header comment) instead of re-implementing it.
describe('pid_lock', () => {
  it('reports the current process as alive', () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it('reports an implausibly large / almost certainly unused PID as not alive', () => {
    assert.equal(isProcessAlive(999999), false);
  });
});
