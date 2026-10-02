'use strict';

/**
 * The BFF runs with VAULT_INTERNAL_STRICT=true under docker-compose: it refuses
 * to START while BFF_INTERNAL_SECRET is the committed public default. So the
 * launcher must guarantee a real value before `compose up`, or a fresh clone
 * deadlocks. Nine services read that secret, each from its own env file, and
 * they must all hold the SAME value — minting it for the BFF alone would leave
 * every internal hop answering 403.
 *
 * The load-bearing property is the other direction: a stack that already has a
 * real secret is never touched (no rotation, no rewrite).
 *
 * All values here are fixtures — never real credentials.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ensureInternalSecret,
  INTERNAL_SECRET_ENV_FILES,
} = require('../../scripts/ensure-service-keys');

const DEFAULT = 'dev-shared-secret-change-me';
const KEY = 'BFF_INTERNAL_SECRET';
/** One env-file line for the key under test. */
const line = (value = '') => `${KEY}=${value}\n`;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'esk-is-'));
}

function envFile(dir, name, contents) {
  const file = path.join(dir, name);
  if (contents != null) fs.writeFileSync(file, contents);
  return file;
}

function readKey(file, key = KEY) {
  if (!fs.existsSync(file)) return undefined;
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1] : null;
}

const noVault = () => null;
const mint = () => 'minted-fixture-secret';

describe('ensureInternalSecret', () => {
  test('a real secret already in demo_api_server/.env is kept, and nothing is written anywhere', () => {
    const dir = tmpDir();
    const apiEnvPath = envFile(dir, 'api.env', 'OTHER=1\n' + line('real-existing-secret'));
    const consumer = envFile(dir, 'agent.env', line('some-other-value'));
    const before = fs.readFileSync(apiEnvPath, 'utf8');
    const vaultGet = jest.fn(() => { throw new Error('vault must not be consulted'); });

    const result = ensureInternalSecret({ apiEnvPath, consumerEnvPaths: [consumer], vaultGet, mint });

    expect(result).toEqual({ action: 'kept', written: [] });
    expect(fs.readFileSync(apiEnvPath, 'utf8')).toBe(before);
    expect(readKey(consumer)).toBe('some-other-value');
    expect(vaultGet).not.toHaveBeenCalled();
  });

  test('a dotenvx-encrypted value counts as real and is left alone', () => {
    const dir = tmpDir();
    const apiEnvPath = envFile(dir, 'api.env', line('encrypted:BJx0fixturefixture'));

    const result = ensureInternalSecret({ apiEnvPath, consumerEnvPaths: [], vaultGet: noVault, mint });

    expect(result.action).toBe('kept');
    expect(readKey(apiEnvPath)).toBe('encrypted:BJx0fixturefixture');
  });

  test.each([
    ['empty', line()],
    ['the committed default', line(DEFAULT)],
    ['absent from the file', 'OTHER=1\n'],
    ['no file at all', null],
  ])('with the secret %s and no vault value, one secret is minted for the BFF and every consumer', (_label, contents) => {
    const dir = tmpDir();
    const apiEnvPath = envFile(dir, 'api.env', contents);
    const withStale = envFile(dir, 'agent.env', 'KEEP=me\n' + line(DEFAULT));
    const notYetCreated = envFile(dir, 'gateway.env', null);

    const result = ensureInternalSecret({
      apiEnvPath, consumerEnvPaths: [withStale, notYetCreated], vaultGet: noVault, mint,
    });

    expect(result.action).toBe('minted');
    expect(result.written).toEqual([apiEnvPath, withStale, notYetCreated]);
    for (const file of [apiEnvPath, withStale, notYetCreated]) {
      expect(readKey(file)).toBe('minted-fixture-secret');
    }
    // Other lines in a consumer's file survive.
    expect(readKey(withStale, 'KEEP')).toBe('me');
  });

  test('a minted secret is written exactly once per file, with no duplicate lines', () => {
    const dir = tmpDir();
    const apiEnvPath = envFile(dir, 'api.env', 'A=1\n' + line(DEFAULT) + 'B=2\n');

    ensureInternalSecret({ apiEnvPath, consumerEnvPaths: [], vaultGet: noVault, mint });

    const lines = fs.readFileSync(apiEnvPath, 'utf8').split('\n').filter((l) => l.startsWith(`${KEY}=`));
    expect(lines).toEqual([line('minted-fixture-secret').trim()]);
  });

  test('a real secret held only in the vault is copied to the BFF env, not replaced by a new one', () => {
    // The strict check runs when the BFF's routes load, long before the vault
    // is opened — so a vault-only secret would still read as the default there.
    const dir = tmpDir();
    const apiEnvPath = envFile(dir, 'api.env', line());
    const consumer = envFile(dir, 'agent.env', line('vault-held-secret'));

    const result = ensureInternalSecret({
      apiEnvPath, consumerEnvPaths: [consumer], vaultGet: () => 'vault-held-secret', mint,
    });

    expect(result).toEqual({ action: 'copied-from-vault', written: [apiEnvPath] });
    expect(readKey(apiEnvPath)).toBe('vault-held-secret');
    expect(readKey(consumer)).toBe('vault-held-secret');
  });

  test('a vault that throws, or holds only the default, is treated as no value', () => {
    for (const vaultGet of [() => { throw new Error('locked'); }, () => DEFAULT]) {
      const dir = tmpDir();
      const apiEnvPath = envFile(dir, 'api.env', line());

      const result = ensureInternalSecret({ apiEnvPath, consumerEnvPaths: [], vaultGet, mint });

      expect(result.action).toBe('minted');
    }
  });

  test('a minted file is not world-readable', () => {
    const dir = tmpDir();
    const apiEnvPath = envFile(dir, 'api.env', null);

    ensureInternalSecret({ apiEnvPath, consumerEnvPaths: [], vaultGet: noVault, mint });

    expect(fs.statSync(apiEnvPath).mode & 0o077).toBe(0);
  });

  test('the real mint is long, random, and never the default', () => {
    const dir = tmpDir();
    const a = envFile(dir, 'a.env', null);
    const b = envFile(dir, 'b.env', null);

    ensureInternalSecret({ apiEnvPath: a, consumerEnvPaths: [], vaultGet: noVault });
    ensureInternalSecret({ apiEnvPath: b, consumerEnvPaths: [], vaultGet: noVault });

    expect(readKey(a)).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(readKey(a)).not.toBe(readKey(b));
  });
});

describe('INTERNAL_SECRET_ENV_FILES', () => {
  test('lists the env file of every compose service whose code reads the secret', () => {
    // If a service starts reading BFF_INTERNAL_SECRET, add its env file here or a
    // fresh install leaves it on the public default while the BFF holds a real one.
    expect(INTERNAL_SECRET_ENV_FILES).toEqual([
      'demo_agent_service/.env',
      'demo_mcp_gateway/.env',
      'ping-gateway/.env',
      'oauth-mcp/.env',
      'demo_hitl_service/.env',
      'demo_mcp_resource_server/.env',
      'langchain_agent/.env',
      'demo_authz_server/.env',
    ]);
  });
});
