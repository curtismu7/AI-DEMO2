'use strict';

/**
 * vault → dotenvx cutover (Task 7): ensure-service-keys must move the
 * mortgage/invest service key's home into demo_api_server/.env, writing all
 * four DEMO_*_KEY names, and — the load-bearing property — REUSE an existing
 * value verbatim (no rotation). A regenerated service key silently breaks the
 * apikey-dispatch chips, so "an existing value is preserved" is the invariant
 * this suite locks down.
 *
 * All values here are fixtures — never real credentials.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveExistingServiceKey,
  decideNeedsMint,
  upsertApiEnvServiceKeys,
  SERVICE_KEY_ENV_NAMES,
} = require('../../scripts/ensure-service-keys');

function tmpEnv(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'esk-sk-')), '.env');
  if (contents != null) fs.writeFileSync(file, contents);
  return file;
}

function readKey(file, key) {
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1] : null;
}

describe('SERVICE_KEY_ENV_NAMES', () => {
  test('provisions the two live cutover names (legacy aliases pruned 2026-08-21)', () => {
    expect(SERVICE_KEY_ENV_NAMES).toEqual([
      'DEMO_API_RESOURCE_SERVER_KEY',
      'DEMO_MCP_RESOURCE_SERVER_KEY',
    ]);
  });
});

describe('resolveExistingServiceKey', () => {
  test('returns the demo_api_server/.env value and never touches the vault', () => {
    const apiEnvPath = tmpEnv('DEMO_API_RESOURCE_SERVER_KEY=mortgage-existingreal01\n');
    const rootEnvPath = tmpEnv('API_RESOURCE_SERVER_API_KEY=mortgage-rootreal02\n');
    const vaultGet = jest.fn(() => { throw new Error('vault must not be consulted'); });

    const value = resolveExistingServiceKey({ apiEnvPath, rootEnvPath, vaultGet });

    expect(value).toBe('mortgage-existingreal01');
    expect(vaultGet).not.toHaveBeenCalled();
  });

  test('skips a committed default in demo_api_server/.env and falls to root .env', () => {
    const apiEnvPath = tmpEnv('DEMO_API_RESOURCE_SERVER_KEY=demo-mortgage-key-0000\n');
    const rootEnvPath = tmpEnv('API_RESOURCE_SERVER_API_KEY=mortgage-rootreal03\n');
    const vaultGet = jest.fn(() => 'mortgage-vaultreal04');

    const value = resolveExistingServiceKey({ apiEnvPath, rootEnvPath, vaultGet });

    expect(value).toBe('mortgage-rootreal03');
    expect(vaultGet).not.toHaveBeenCalled();
  });

  test('falls through to the vault when both env files hold only defaults', () => {
    const apiEnvPath = tmpEnv('DEMO_API_RESOURCE_SERVER_KEY=demo-mortgage-key-0000\n');
    const rootEnvPath = tmpEnv('API_RESOURCE_SERVER_API_KEY=mortgage-compose-dev-key\n');
    const vaultGet = jest.fn(() => 'mortgage-vaultreal05');

    const value = resolveExistingServiceKey({ apiEnvPath, rootEnvPath, vaultGet });

    expect(value).toBe('mortgage-vaultreal05');
    expect(vaultGet).toHaveBeenCalledTimes(1);
  });

  test('returns null when nothing but defaults/absent exist (fresh setup)', () => {
    const apiEnvPath = tmpEnv('SOMETHING_ELSE=1\n');
    const rootEnvPath = tmpEnv('API_RESOURCE_SERVER_API_KEY=\n');
    const vaultGet = jest.fn(() => null);

    expect(resolveExistingServiceKey({ apiEnvPath, rootEnvPath, vaultGet })).toBeNull();
  });
});

describe('decideNeedsMint', () => {
  test('does NOT mint when a real value already exists (no rotation)', () => {
    expect(decideNeedsMint('mortgage-real', false)).toBe(false);
  });
  test('mints on a truly fresh setup (null)', () => {
    expect(decideNeedsMint(null, false)).toBe(true);
  });
  test('mints on a committed default', () => {
    expect(decideNeedsMint('demo-mortgage-key-0000', false)).toBe(true);
  });
  test('force overrides an existing real value', () => {
    expect(decideNeedsMint('mortgage-real', true)).toBe(true);
  });
});

describe('upsertApiEnvServiceKeys', () => {
  test('writes the SAME value to all four names in a fresh file', () => {
    const file = tmpEnv('SESSION_SECRET=abc\n');
    upsertApiEnvServiceKeys(file, SERVICE_KEY_ENV_NAMES, 'mortgage-shared06');
    for (const name of SERVICE_KEY_ENV_NAMES) {
      expect(readKey(file, name)).toBe('mortgage-shared06');
    }
    // Unrelated keys are preserved.
    expect(readKey(file, 'SESSION_SECRET')).toBe('abc');
  });

  test('updates an existing name in place — no duplicate lines', () => {
    const file = tmpEnv('DEMO_API_RESOURCE_SERVER_KEY=old-value\n');
    const fixture = 'mortgage-new07'; // gitleaks:allow — test fixture, not a credential
    upsertApiEnvServiceKeys(file, SERVICE_KEY_ENV_NAMES, fixture);
    const occurrences = fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('DEMO_API_RESOURCE_SERVER_KEY=')).length;
    expect(occurrences).toBe(1);
    expect(readKey(file, 'DEMO_API_RESOURCE_SERVER_KEY')).toBe(fixture);
  });

  test('end-to-end: an existing value is preserved verbatim (NO rotation)', () => {
    // demo_api_server/.env already holds a real, non-default key.
    const apiEnvPath = tmpEnv('DEMO_API_RESOURCE_SERVER_KEY=mortgage-preserveme08\n');
    const rootEnvPath = tmpEnv('API_RESOURCE_SERVER_API_KEY=mortgage-preserveme08\n');
    const vaultGet = () => { throw new Error('unused'); };

    const existing = resolveExistingServiceKey({ apiEnvPath, rootEnvPath, vaultGet });
    expect(decideNeedsMint(existing, false)).toBe(false);
    const value = existing; // main() reuses `existing` when not minting

    upsertApiEnvServiceKeys(apiEnvPath, SERVICE_KEY_ENV_NAMES, value);

    // Every provisioned name equals the ORIGINAL value — proof no new key was minted.
    for (const name of SERVICE_KEY_ENV_NAMES) {
      expect(readKey(apiEnvPath, name)).toBe('mortgage-preserveme08');
    }
  });
});
