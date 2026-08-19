'use strict';

/**
 * dotenvxBootstrap — the BFF's pre-newrelic decrypt bootstrap (2026-08-18
 * incident: demo_api_server/.env was encrypted with no in-process decrypt path;
 * the BFF read raw ciphertext — login client secret literally `encrypted:...`,
 * ConfigStore key mismatch, and New Relic resolving
 * `collector.encrypted:....nr-data.net` because the NR agent derives its
 * collector host FROM NR_LICENSE_KEY at require time).
 *
 * Covered:
 *   1. plaintext `.env` — pass-through with today's precedence (pre-set env
 *      wins; root `.env` wins over service `.env`), silent (no new logs)
 *   2. encrypted `.env` + DOTENV_PRIVATE_KEY — decrypts into env; the key is
 *      deleted after (hygiene, matching the other services' loaders)
 *   3. Docker shape — a pre-set env value that IS the raw ciphertext (compose
 *      env_file injects the encrypted file verbatim) is REPLACED by the
 *      decrypted value
 *   4. encrypted `.env`, NO key — never throws; existing plaintext env wins
 *   5. missing files — silent no-op
 *   6. static load order — server.js requires the bootstrap BEFORE
 *      require('newrelic') (the exact ordering the incident proved matters)
 *
 * The encrypted fixture is GENERATED at test time with dotenvx.set() into a tmp
 * dir (its `.env.keys` is deleted so the key travels only via the seeded env,
 * as in Docker) — no keypair is ever committed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const dotenvx = require('@dotenvx/dotenvx');
const { bootstrapDotenvx } = require('../../services/dotenvxBootstrap');

const SERVER_JS = path.resolve(__dirname, '..', '..', 'server.js');

let tmpRoot;
let encryptedEnvPath;
let ciphertext;
let privateKey;

function mockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// dotenvx derives the private-key NAME from the env filename (`.env` →
// DOTENV_PRIVATE_KEY; `foo.env` → DOTENV_PRIVATE_KEY_FOO), so every fixture
// must be a literal `.env` in its own subdir — exactly like production.
function writeEnv(subdir, entries) {
  const dir = path.join(tmpRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, '.env');
  fs.writeFileSync(
    p,
    Object.entries(entries).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
  );
  return p;
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvx-bootstrap-'));

  // Build the encrypted fixture: one plaintext config value + one encrypted
  // secret, keypair generated fresh in the tmp dir.
  const encDir = path.join(tmpRoot, 'enc');
  fs.mkdirSync(encDir);
  encryptedEnvPath = path.join(encDir, '.env');
  const keysPath = path.join(encDir, '.env.keys');
  fs.writeFileSync(encryptedEnvPath, 'PLAIN_CONFIG=plain-config-value\n');
  await dotenvx.set('SECRET_ONE', 'decrypted-secret-value', {
    path: [encryptedEnvPath],
    envKeysFile: keysPath,
    noArmor: true,
    noNative: true,
    quiet: true,
  });
  privateKey = fs.readFileSync(keysPath, 'utf8').match(/DOTENV_PRIVATE_KEY="?([0-9a-f]+)"?/)[1];
  ciphertext = fs.readFileSync(encryptedEnvPath, 'utf8').match(/^SECRET_ONE="?(encrypted:[^"\n]+)"?/m)[1];
  // The key must reach the bootstrap ONLY via env (Docker/native delivery
  // channel) — never via a co-located .env.keys dotenvx would auto-discover.
  fs.unlinkSync(keysPath);
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('plaintext .env (today) — exact pass-through', () => {
  test('values land in env; pre-set env wins; root wins over service; silent', () => {
    const rootEnv = writeEnv('rootdir', { SHARED_NAME: 'from-root', ROOT_ONLY: 'r1' });
    const serviceEnv = writeEnv('svcdir', {
      SHARED_NAME: 'from-service',
      SERVICE_ONLY: 's1',
      PRESET_NAME: 'from-file',
    });
    const env = { PRESET_NAME: 'from-real-env' };
    const logger = mockLogger();

    const result = bootstrapDotenvx({ envPaths: [rootEnv, serviceEnv], env, logger });

    expect(result.loaded).toBe(true);
    expect(env.ROOT_ONLY).toBe('r1');
    expect(env.SERVICE_ONLY).toBe('s1');
    // Documented local-dev precedence: root .env wins over demo_api_server/.env.
    expect(env.SHARED_NAME).toBe('from-root');
    // Pre-set (real) env always wins over file values — unchanged behavior.
    expect(env.PRESET_NAME).toBe('from-real-env');
    // Backward-compat: the plaintext path must be SILENT (no new boot noise).
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('missing env files — silent no-op, never throws', () => {
    const env = {};
    const logger = mockLogger();
    const result = bootstrapDotenvx({
      envPaths: [path.join(tmpRoot, 'nope-a.env'), path.join(tmpRoot, 'nope-b.env')],
      env,
      logger,
    });
    expect(result).toEqual({ loaded: true, applied: 0, decrypted: 0 });
    expect(Object.keys(env)).toHaveLength(0);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('encrypted .env + DOTENV_PRIVATE_KEY (post-cutover)', () => {
  test('decrypts into env and deletes the key after (hygiene)', () => {
    const env = { DOTENV_PRIVATE_KEY: privateKey };
    const logger = mockLogger();

    const result = bootstrapDotenvx({ envPaths: [encryptedEnvPath], env, logger });

    expect(result.loaded).toBe(true);
    expect(env.SECRET_ONE).toBe('decrypted-secret-value');
    expect(env.PLAIN_CONFIG).toBe('plain-config-value');
    // Hygiene: the decrypt key must not survive in env (same leak-window shrink
    // as the agent/gateway/oauth-mcp loaders).
    expect(env.DOTENV_PRIVATE_KEY).toBeUndefined();
    // Positive log evidence (the cutover runbook's D.1 greps for this line).
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[dotenvx] bootstrap: decrypted .env applied'));
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('Docker shape: pre-set ciphertext env value is REPLACED by the decrypted value', () => {
    // compose env_file: injects the RAW encrypted .env verbatim at container
    // creation — so at boot process.env holds `encrypted:...` strings. The
    // in-process decrypt must win over exactly (and only) those.
    const env = {
      DOTENV_PRIVATE_KEY: privateKey,
      SECRET_ONE: ciphertext,          // container-level ciphertext
      PLAIN_CONFIG: 'container-value', // container-level plaintext — must win
    };
    const result = bootstrapDotenvx({ envPaths: [encryptedEnvPath], env, logger: mockLogger() });

    expect(env.SECRET_ONE).toBe('decrypted-secret-value');
    expect(env.PLAIN_CONFIG).toBe('container-value');
    expect(result.decrypted).toBe(1);
  });

  test('NO key: never throws; pre-set plaintext env untouched; error logged once', () => {
    const env = { SECRET_ONE: 'value-from-vault-path' };
    const logger = mockLogger();

    expect(() => bootstrapDotenvx({ envPaths: [encryptedEnvPath], env, logger })).not.toThrow();

    // Without a key the bootstrap must not clobber a value another load path
    // (e.g. the still-intact vault) provided.
    expect(env.SECRET_ONE).toBe('value-from-vault-path');
    expect(env.DOTENV_PRIVATE_KEY).toBeUndefined();
    // The incident signature is loud but non-fatal (vault path still boots us).
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('continuing with existing env'));
  });

  test('key present but .env unreadable: leftover ciphertext is reported as an incident', () => {
    // The 2026-08-19 live outage, reproduced. The BFF started while .env was
    // absent/mid-rewrite: existsSync() was false, the loop `continue`d, and the
    // only output was the success line saying "0 value(s) set". The container
    // env still held `encrypted:...` for the login client secret, so every
    // end-user sign-in failed `invalid_client` for 3.5 minutes with nothing in
    // the log naming the cause.
    const env = {
      DOTENV_PRIVATE_KEY: privateKey,
      PINGONE_USER_CLIENT_SECRET: ciphertext, // container-level, never decrypted
      PLAIN_CONFIG: 'container-value',
    };
    const logger = mockLogger();

    bootstrapDotenvx({ envPaths: [path.join(tmpRoot, 'does-not-exist.env')], env, logger });

    // Loud, and it must name the variable — a count alone sends you reading the
    // wrong service. Values are never logged.
    const [msg] = logger.error.mock.calls.find(([m]) => m.includes('STILL ciphertext')) || [];
    expect(msg).toBeDefined();
    expect(msg).toContain('PINGONE_USER_CLIENT_SECRET');
    expect(msg).toContain('invalid_client');
    expect(msg).not.toContain(ciphertext);
    // Non-fatal by design: the vault path may still supply secrets and a
    // plaintext rollback must never be blocked here.
    expect(env.PLAIN_CONFIG).toBe('container-value');
  });

  test('NO key at all + container ciphertext: still loud (the silent case)', () => {
    // The gap the first guard missed. With no key there is no success line
    // either — bootstrapDotenvx logged NOTHING while every secret stayed
    // ciphertext and sign-in was broken. Silence is the worst possible output
    // for this state, so it must report regardless of the key.
    const env = { PINGONE_USER_CLIENT_SECRET: ciphertext };
    const logger = mockLogger();

    bootstrapDotenvx({ envPaths: [path.join(tmpRoot, 'does-not-exist.env')], env, logger });

    const [msg] = logger.error.mock.calls.find(([m]) => m.includes('STILL ciphertext')) || [];
    expect(msg).toBeDefined();
    expect(msg).toContain('PINGONE_USER_CLIENT_SECRET');
    // Must name the ACTUAL cause for this variant, not the mid-rewrite one.
    expect(msg).toContain('DOTENV_PRIVATE_KEY is NOT set');
    expect(msg).not.toContain(ciphertext);
  });

  test('fully decrypted boot logs no incident', () => {
    const env = { DOTENV_PRIVATE_KEY: privateKey, SECRET_ONE: ciphertext };
    const logger = mockLogger();

    bootstrapDotenvx({ envPaths: [encryptedEnvPath], env, logger });

    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('server.js load order (static)', () => {
  test('the dotenvx bootstrap is required BEFORE require(\'newrelic\')', () => {
    // The incident's proof that order matters: require('newrelic') reads
    // NR_LICENSE_KEY from process.env at require time to derive its collector
    // hostname. Decryption must therefore already have happened.
    const src = fs.readFileSync(SERVER_JS, 'utf8');
    // Match the STATEMENTS at column 0 (comments also mention these requires).
    const bootstrapStmt = /^require\('\.\/services\/dotenvxBootstrap'\)\.bootstrapDotenvx\(\);/m.exec(src);
    const newrelicStmt = /^require\('newrelic'\);/m.exec(src);
    expect(bootstrapStmt).not.toBeNull();
    expect(newrelicStmt).not.toBeNull();
    expect(bootstrapStmt.index).toBeLessThan(newrelicStmt.index);
  });
});
