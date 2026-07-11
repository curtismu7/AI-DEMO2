/**
 * CircuitBreaker (P1AZ hardening amendment §E) — deterministic via injected time.
 */
const { CircuitBreaker } = require('../../utils/circuitBreaker');

function mk(overrides = {}) {
  let t = 0;
  const cb = new CircuitBreaker({ threshold: 3, openMs: 60_000, now: () => t, ...overrides });
  return { cb, advance: (ms) => { t += ms; }, at: () => t };
}

test('closed while under threshold; opens on the Nth consecutive failure', () => {
  const { cb } = mk();
  expect(cb.canRequest()).toBe(true);
  cb.recordFailure();
  cb.recordFailure();
  expect(cb.canRequest()).toBe(true); // 2 < 3
  cb.recordFailure();                  // 3rd → open
  expect(cb.canRequest()).toBe(false); // fast-fail
});

test('a success resets the failure count', () => {
  const { cb } = mk();
  cb.recordFailure();
  cb.recordFailure();
  cb.recordSuccess();
  cb.recordFailure();
  cb.recordFailure();
  expect(cb.canRequest()).toBe(true); // only 2 since reset
});

test('stays open for the cooldown, then admits exactly ONE half-open probe', () => {
  const { cb, advance } = mk();
  cb.recordFailure(); cb.recordFailure(); cb.recordFailure(); // open
  expect(cb.canRequest()).toBe(false);
  advance(59_000);
  expect(cb.canRequest()).toBe(false); // still cooling down
  advance(1_000);                       // 60s elapsed
  expect(cb.canRequest()).toBe(true);   // the single probe
  expect(cb.canRequest()).toBe(false);  // everyone else fast-fails while probe in flight
  expect(cb.canRequest()).toBe(false);
});

test('a failed half-open probe reopens for a fresh cooldown', () => {
  const { cb, advance } = mk();
  cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
  advance(60_000);
  expect(cb.canRequest()).toBe(true); // probe admitted
  cb.recordFailure();                 // probe failed → reopen
  expect(cb.canRequest()).toBe(false);
  advance(59_000);
  expect(cb.canRequest()).toBe(false); // fresh 60s cooldown, not elapsed
  advance(1_000);
  expect(cb.canRequest()).toBe(true);  // next probe
});

test('a successful half-open probe closes the breaker', () => {
  const { cb, advance } = mk();
  cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
  advance(60_000);
  expect(cb.canRequest()).toBe(true); // probe
  cb.recordSuccess();                 // probe ok → closed
  expect(cb.canRequest()).toBe(true);
  expect(cb.canRequest()).toBe(true); // fully closed, no single-probe gating
});

test('reset() returns to closed', () => {
  const { cb } = mk();
  cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
  cb.reset();
  expect(cb.canRequest()).toBe(true);
});
