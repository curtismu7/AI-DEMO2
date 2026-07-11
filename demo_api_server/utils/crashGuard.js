/**
 * WR-21 + demo-hardening Phase 4: decide whether an unhandledRejection should
 * hard-exit the BFF. Production always logs-and-continues. CRASH_GUARD=1 gives
 * demo runs the same resilience — required because every demo runtime (run.sh,
 * docker-compose, SE k8s) deliberately runs NODE_ENV=development so the
 * simulated Authorize service loads (see k8s/20-api-server-deployment.yaml).
 * Dev/test without the flag keeps the hard exit so bugs surface loudly.
 */
'use strict';

function shouldHardExitOnUnhandledRejection(env = process.env) {
  if (env.NODE_ENV === 'production') return false;
  if (env.CRASH_GUARD === '1') return false;
  return true;
}

module.exports = { shouldHardExitOnUnhandledRejection };
