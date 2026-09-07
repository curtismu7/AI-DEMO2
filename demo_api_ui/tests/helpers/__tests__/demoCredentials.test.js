/**
 * The bug this guards: tests/e2e/.env.e2e held a hand-copied duplicate of the
 * demo passwords, it went stale, and every *.real.spec.js failed at the PingOne
 * login step — indistinguishable from an auth outage. Precedence is the whole
 * fix, so precedence is what gets pinned.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

// The helper is CommonJS on purpose — playwright.config.js requires it before
// any ESM loader is in play.
const { seedDemoCredentials, parseEnvFile } = createRequire(import.meta.url)('../demoCredentials.js');

const VARS = ['E2E_CUSTOMER_USERNAME', 'E2E_CUSTOMER_PASSWORD', 'E2E_ADMIN_USERNAME', 'E2E_ADMIN_PASSWORD'];

let tmpDir;
let saved;

function writeServerEnv(body) {
  const p = path.join(tmpDir, '.env');
  fs.writeFileSync(p, body);
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'democreds-'));
  saved = {};
  for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v]; }
});

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('seedDemoCredentials', () => {
  it('seeds all four demo credentials from demo_api_server/.env', () => {
    const env = writeServerEnv([
      'DEMO_USER_USERNAME=demoUser',
      'DEMO_USER_PASSWORD=user-secret',
      'DEMO_ADMIN_USERNAME=demoAdmin',
      'DEMO_ADMIN_PASSWORD=admin-secret',
    ].join('\n'));

    expect(seedDemoCredentials(env).sort()).toEqual(VARS.slice().sort());
    expect(process.env.E2E_CUSTOMER_USERNAME).toBe('demoUser');
    expect(process.env.E2E_CUSTOMER_PASSWORD).toBe('user-secret');
    expect(process.env.E2E_ADMIN_USERNAME).toBe('demoAdmin');
    expect(process.env.E2E_ADMIN_PASSWORD).toBe('admin-secret');
  });

  // The escape hatch: a deliberate one-off must still beat the repo default.
  it('never overrides a value already in the environment', () => {
    process.env.E2E_CUSTOMER_PASSWORD = 'from-shell';
    const env = writeServerEnv('DEMO_USER_PASSWORD=from-server-env');

    expect(seedDemoCredentials(env)).not.toContain('E2E_CUSTOMER_PASSWORD');
    expect(process.env.E2E_CUSTOMER_PASSWORD).toBe('from-shell');
  });

  // A quoted value in .env is read unquoted by the BFF; copying the quotes
  // through would log in with a literal " and read as a wrong password.
  it('strips surrounding quotes, matching how the BFF reads the file', () => {
    const env = writeServerEnv('DEMO_USER_PASSWORD="quoted-secret"');
    seedDemoCredentials(env);
    expect(process.env.E2E_CUSTOMER_PASSWORD).toBe('quoted-secret');
  });

  // dotenvx ciphertext only decrypts inside the BFF process.
  it('skips dotenvx-encrypted values rather than passing ciphertext to a login form', () => {
    const env = writeServerEnv('DEMO_USER_PASSWORD=encrypted:BKPabc123');
    expect(seedDemoCredentials(env)).not.toContain('E2E_CUSTOMER_PASSWORD');
    expect(process.env.E2E_CUSTOMER_PASSWORD).toBeUndefined();
  });

  it('is a no-op when demo_api_server/.env is absent', () => {
    expect(seedDemoCredentials(path.join(tmpDir, 'nope.env'))).toEqual([]);
    expect(process.env.E2E_CUSTOMER_PASSWORD).toBeUndefined();
  });

  it('ignores comments and blank lines', () => {
    const env = writeServerEnv('# comment\n\nDEMO_USER_PASSWORD=ok\n');
    expect(parseEnvFile(env)).toEqual({ DEMO_USER_PASSWORD: 'ok' });
  });
});
