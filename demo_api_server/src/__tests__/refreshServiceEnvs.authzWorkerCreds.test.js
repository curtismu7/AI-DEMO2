/**
 * @file refreshServiceEnvs.authzWorkerCreds.test.js
 *
 * scripts/refresh-service-envs.js generates demo_authz_server/.env. It never
 * emitted PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET, which
 * pingOneUserLookup.js's Rule 0a2 user-existence check needs to call the
 * PingOne Management API. Without them, every decision request throws
 * "PingOne worker credentials not configured", which the mock authz server
 * turns into a DENY (`user_lookup_failed: unable to verify user status`) —
 * an infra fault presented as a policy denial, and (since the mock engine
 * denies by default on lookup failure) it silently killed every A2A
 * specialist delegation (UC2 / UC2.5), even once the actor-chain and
 * gateway-policy checks were passing.
 *
 * The generator calls main() at require time (it is a CLI), so it cannot be
 * imported and driven in-process — same static-source approach as
 * refreshServiceEnvs.intentSecret.test.js / refreshServiceEnvs.delegationRoute.test.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GENERATOR = path.join(__dirname, '..', '..', 'scripts', 'refresh-service-envs.js');

function authzServerEnvBlock() {
  const src = fs.readFileSync(GENERATOR, 'utf8');
  const start = src.indexOf("'demo_authz_server', '.env'");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("Wrote demo_authz_server/.env", start);
  expect(end).toBeGreaterThan(start);
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('refresh-service-envs — demo_authz_server/.env worker credentials', () => {
  it('emits PINGONE_WORKER_CLIENT_ID so pingOneUserLookup can call the Management API', () => {
    expect(authzServerEnvBlock()).toMatch(/PINGONE_WORKER_CLIENT_ID\s*:\s*fb\('PINGONE_WORKER_CLIENT_ID'\)/);
  });

  it('emits PINGONE_WORKER_CLIENT_SECRET so pingOneUserLookup can call the Management API', () => {
    expect(authzServerEnvBlock()).toMatch(/PINGONE_WORKER_CLIENT_SECRET\s*:\s*fb\('PINGONE_WORKER_CLIENT_SECRET'\)/);
  });
});
