// Guards the crash that caused five llm-proxy restarts on the SE cluster
// (2026-08-28). Every one logged:
//
//   [llm-proxy] pin warm-up failed: tier-manager timeout
//   Error: tier-manager timeout ... exit code 1
//
// i.e. the failure was caught and logged as non-fatal, then killed the process
// one line later.
//
// Cause: swapTo attached `promise.finally(cleanup)` without a catch. `.finally()`
// returns a NEW promise that ADOPTS the rejection, so a failing swap left that
// derived promise unhandled and Node (>=15) exits on unhandledRejection. The
// existing `swapChain = promise.catch(...)` and the caller's own `.catch()` each
// cover a DIFFERENT branch — neither covers the one .finally() creates.
//
// A slow tier-manager at startup must never take the router down: every agent
// depends on :8090.

const test = require('node:test');
const assert = require('node:assert');

// Point the tier-manager at a closed port so callTierManager rejects on connect
// rather than waiting out SWAP_TIMEOUT_MS (180s).
process.env.TIER_MANAGER_URL = 'http://127.0.0.1:1';

const { swapTo, TIERS } = require('./router.js');

test('a failing swap does not leave an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    // Caller handles its own branch, exactly as the pin warm-up does.
    await assert.rejects(() => swapTo(TIERS.length - 1));

    // Unhandled rejections are reported on a later turn of the microtask queue,
    // so give Node a moment to have noticed one before asserting there was none.
    await new Promise((r) => setTimeout(r, 100));

    assert.deepStrictEqual(
      unhandled.map((e) => (e && e.message) || String(e)),
      [],
      'a failing swap must not produce an unhandled rejection — that is what killed the process',
    );
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
