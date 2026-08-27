'use strict';
/**
 * The autonomous-agent tuning knobs must be settable from .env.
 *
 * getEffective() resolves env vars through ENV_FALLBACK_MAP, not by uppercasing
 * the key, so a knob with no entry silently ignores its environment variable —
 * the value is accepted, nothing errors, and the default is used anyway. That
 * is what made the PARKED case impossible to stage: a sweep parks only when the
 * amount lands between the mandate and the absolute ceiling, and reaching that
 * band means moving BALANCE_SWEEP_FLOOR.
 */

const { ENV_FALLBACK_MAP } = require('../../services/configStore');

// Every knob the jobs and scheduler actually read, with the env name each must
// answer to. If a knob is added to a job without an alias, add it here too.
const KNOBS = {
  balance_sweep_floor: 'BALANCE_SWEEP_FLOOR',
  fraud_watch_threshold: 'FRAUD_WATCH_THRESHOLD',
  fraud_watch_window_hours: 'FRAUD_WATCH_WINDOW_HOURS',
  autonomous_mandate_max_amount: 'AUTONOMOUS_MANDATE_MAX_AMOUNT',
  autonomous_fraud_watch_cron: 'AUTONOMOUS_FRAUD_WATCH_CRON',
  autonomous_balance_sweep_cron: 'AUTONOMOUS_BALANCE_SWEEP_CRON',
};

describe('autonomous-agent tuning knobs', () => {
  test.each(Object.entries(KNOBS))('%s is settable via %s', (key, envName) => {
    expect(ENV_FALLBACK_MAP).toHaveProperty(key);
    expect(ENV_FALLBACK_MAP[key]).toContain(envName);
  });

  // Guard the derivation: if ENV_FALLBACK_MAP stops being exported or is
  // renamed, every assertion above would pass vacuously against undefined.
  test('the alias map is actually reachable', () => {
    expect(ENV_FALLBACK_MAP).toBeDefined();
    expect(Object.keys(ENV_FALLBACK_MAP).length).toBeGreaterThan(10);
  });
});
