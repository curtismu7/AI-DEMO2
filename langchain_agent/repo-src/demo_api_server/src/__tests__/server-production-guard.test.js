/**
 * @file server-production-guard.test.js
 * @description Tests for STAB-03: SKIP_TOKEN_SIGNATURE_VALIDATION=true must cause process.exit(1) in production.
 *
 * Uses child_process.spawnSync to launch server.js as a subprocess so the test
 * captures the exit code without polluting Jest's own process.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '../../server.js');
const BASE_SESSION_ENV = { SESSION_SECRET: 'test-session-secret-minimum-32-ch' };
// Dummy PingOne creds so the production env-var preflight passes and the
// process reaches the STAB-03 SKIP_TOKEN_SIGNATURE_VALIDATION guard this
// suite is actually testing. Without these, the newer required-env
// preflight exits(1) first (to stdout), masking the guard under test.
const BASE_PROD_PINGONE_ENV = {
  PINGONE_ENVIRONMENT_ID: '00000000-0000-0000-0000-000000000000',
  PINGONE_ADMIN_CLIENT_ID: 'dummy-admin-client-id',
  PINGONE_ADMIN_CLIENT_SECRET: 'dummy-admin-client-secret',
  PINGONE_USER_CLIENT_ID: 'dummy-user-client-id',
  PINGONE_USER_CLIENT_SECRET: 'dummy-user-client-secret',
  PUBLIC_APP_URL: 'https://example.test',
};

describe('production safety guard (STAB-03)', () => {
  it('exits 1 with fatal message when SKIP_TOKEN_SIGNATURE_VALIDATION=true and NODE_ENV=production', () => {
    const result = spawnSync(process.execPath, [SERVER_PATH], {
      env: {
        ...process.env,
        ...BASE_SESSION_ENV,
        ...BASE_PROD_PINGONE_ENV,
        SKIP_TOKEN_SIGNATURE_VALIDATION: 'true',
        NODE_ENV: 'production',
        // Ensure VERCEL / REPL_ID are absent so we rely on NODE_ENV=production alone
        VERCEL: '',
        REPL_ID: '',
      },
      timeout: 8000,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SKIP_TOKEN_SIGNATURE_VALIDATION');
  }, 10000);

  it('does not exit 1 from the security guard when NODE_ENV=development', () => {
    // Spawn a tiny script that requires server.js then immediately exits cleanly.
    // If the guard fires it would produce exit 1 before our process.exit(0) runs.
    const inline = `
      process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
      process.env.NODE_ENV = 'development';
      process.env.SESSION_SECRET = 'test-session-secret-minimum-32-ch';
      process.env.VERCEL = '';
      process.env.REPL_ID = '';
      // require may throw (missing KV, OAuth config, etc.) but the guard fires BEFORE
      // any async init — a throw here means guard did NOT trigger process.exit(1)
      try { require(${JSON.stringify(SERVER_PATH)}); } catch (_) {}
      setTimeout(() => process.exit(0), 200);
    `;
    const result = spawnSync(process.execPath, ['-e', inline], {
      timeout: 6000,
      encoding: 'utf8',
    });

    // Guard must NOT have triggered — exit code should not be 1
    expect(result.status).not.toBe(1);
  }, 8000);
});
