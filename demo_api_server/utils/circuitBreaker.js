'use strict';

/**
 * Small reusable circuit breaker (P1AZ hardening amendment §E).
 *
 * Corrects two flaws in the ad-hoc module-level breakers elsewhere in the repo:
 *  - it is an INSTANCE, so callers can hold one per endpoint (a failure streak
 *    on one decision endpoint must not fast-fail an unrelated healthy one), and
 *  - half-open admits EXACTLY ONE probe; other callers keep fast-failing until
 *    that probe resolves, so an ongoing outage does not re-stall N concurrent
 *    callers for a full timeout each.
 *
 * The caller decides what counts as a failure (only outages — timeout/network/
 * 5xx — should call recordFailure; a reachable 4xx should call recordSuccess so
 * the engine's own error handlers keep running).
 *
 * Time is injected (`now`) so tests are deterministic; defaults to Date.now.
 */
class CircuitBreaker {
  constructor({ threshold = 3, openMs = 60_000, now = () => Date.now() } = {}) {
    this.threshold = threshold;
    this.openMs = openMs;
    this._now = now;
    this.reset();
  }

  reset() {
    this.state = 'closed'; // 'closed' | 'open' | 'half_open'
    this.failures = 0;
    this.openedAt = 0;
    this._probeInFlight = false;
  }

  /** True if a request may proceed. Transitions open->half_open and admits one probe. */
  canRequest() {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (this._now() - this.openedAt >= this.openMs) {
        this.state = 'half_open';
        this._probeInFlight = true;
        return true; // the single half-open probe
      }
      return false;
    }
    // half_open: only the in-flight probe is allowed; everyone else fast-fails.
    if (this._probeInFlight) return false;
    this._probeInFlight = true;
    return true;
  }

  recordSuccess() {
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = 0;
    this._probeInFlight = false;
  }

  recordFailure() {
    if (this.state === 'half_open') {
      // The probe failed — reopen for a fresh cooldown.
      this.state = 'open';
      this.openedAt = this._now();
      this._probeInFlight = false;
      return;
    }
    this.failures += 1;
    this._probeInFlight = false;
    if (this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = this._now();
    }
  }
}

module.exports = { CircuitBreaker };
