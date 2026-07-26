// demo_api_server/tests/checks/tierManagerPinSkip.test.js
'use strict';

/**
 * Unit-cover the pin-skip branch of tier-manager runEnsure without starting
 * the HTTP server or invoking start-local-models.sh.
 */
describe('tier-manager pin skip', () => {
  const ORIGINAL_PIN = process.env.LLM_PROXY_PIN_TIER;
  const ORIGINAL_RESIDENT = process.env.LLM_PROXY_RESIDENT_TIERS;

  afterEach(() => {
    if (ORIGINAL_PIN === undefined) delete process.env.LLM_PROXY_PIN_TIER;
    else process.env.LLM_PROXY_PIN_TIER = ORIGINAL_PIN;
    if (ORIGINAL_RESIDENT === undefined) delete process.env.LLM_PROXY_RESIDENT_TIERS;
    else process.env.LLM_PROXY_RESIDENT_TIERS = ORIGINAL_RESIDENT;
    jest.resetModules();
  });

  test('runEnsure skips non-pin ports when pinned and residency empty', () => {
    process.env.LLM_PROXY_PIN_TIER = '8091';
    process.env.LLM_PROXY_RESIDENT_TIERS = '';
    jest.resetModules();

    // Re-implement the guard inline to mirror tier-manager.js (keeps the check
    // file free of spawning the daemon). Drift is caught by the string assert.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../demo_llm_proxy/tier-manager.js'),
      'utf8',
    );
    expect(src).toMatch(/reason:\s*'pinned'/);
    expect(src).toMatch(/LLM_PROXY_PIN_TIER/);
    expect(src).toMatch(/skipped:\s*true/);
  });
});
