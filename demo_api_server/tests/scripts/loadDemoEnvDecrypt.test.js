'use strict';

/**
 * loadDemoEnv must DECRYPT, not just read.
 *
 * After the dotenvx cutover `.env` values ship as `encrypted:...`. server.js
 * decrypts via bootstrapDotenvx() before anything reads env, but a CLI script
 * never loads server.js — so with a plain `dotenv.config()` every script got the
 * ciphertext verbatim. The first use of a secret then failed as
 * `invalid_client` (HTTP 401) from PingOne, which reads as "bad credentials"
 * rather than "this process never decrypted them", and cost a session chasing a
 * policy import that was fine.
 *
 * The fixture is encrypted by the real dotenvx CLI with a freshly generated
 * keypair — not a hand-written `encrypted:` string, which would prove only that
 * we can recognise a prefix.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DOTENVX_BIN = path.resolve(__dirname, '../../node_modules/.bin/dotenvx');

let tmpDir;
const savedEnv = {};
const TOUCHED = ['DEMO_API_ENV_FILE', 'DOTENV_PRIVATE_KEY', 'LOAD_DEMO_ENV_SECRET', 'LOAD_DEMO_ENV_PLAIN'];

function freshLoader() {
  jest.resetModules();
  return require('../../scripts/loadDemoEnv');
}

beforeEach(() => {
  for (const k of TOUCHED) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-demo-env-'));
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('an encrypted .env value reaches process.env as PLAINTEXT', () => {
  const envFile = path.join(tmpDir, '.env');
  const keysFile = path.join(tmpDir, '.env.keys');
  fs.writeFileSync(envFile, 'LOAD_DEMO_ENV_SECRET=super-secret-value\n');

  // Real encryption with a real generated keypair.
  execFileSync(DOTENVX_BIN, ['encrypt', '-f', envFile, '-fk', keysFile], { stdio: 'ignore' });

  // Precondition: the file really is ciphertext, so a pass would be meaningful.
  const onDisk = fs.readFileSync(envFile, 'utf8');
  expect(onDisk).toMatch(/LOAD_DEMO_ENV_SECRET="?encrypted:/);
  expect(onDisk).not.toContain('super-secret-value');

  const privateKey = require('dotenv').parse(fs.readFileSync(keysFile)).DOTENV_PRIVATE_KEY;
  expect(privateKey).toBeTruthy();

  process.env.DEMO_API_ENV_FILE = envFile;
  process.env.DOTENV_PRIVATE_KEY = privateKey;

  freshLoader().loadDemoEnv();

  expect(process.env.LOAD_DEMO_ENV_SECRET).toBe('super-secret-value');
  expect(process.env.LOAD_DEMO_ENV_SECRET).not.toMatch(/^encrypted:/);
});

test('a plaintext .env is an exact pass-through (unencrypted checkouts unaffected)', () => {
  const envFile = path.join(tmpDir, '.env');
  fs.writeFileSync(envFile, 'LOAD_DEMO_ENV_PLAIN=plain-value\n');

  process.env.DEMO_API_ENV_FILE = envFile;

  freshLoader().loadDemoEnv();

  expect(process.env.LOAD_DEMO_ENV_PLAIN).toBe('plain-value');
});

test('a real environment value still wins over the file (override:false contract)', () => {
  const envFile = path.join(tmpDir, '.env');
  fs.writeFileSync(envFile, 'LOAD_DEMO_ENV_PLAIN=from-file\n');

  process.env.DEMO_API_ENV_FILE = envFile;
  process.env.LOAD_DEMO_ENV_PLAIN = 'from-environment';

  freshLoader().loadDemoEnv();

  expect(process.env.LOAD_DEMO_ENV_PLAIN).toBe('from-environment');
});

// The key is injected onto process.env for the duration of the bootstrap call
// (bootstrapDotenvx resolves it from the env object it is handed). It must not
// survive the call: these CLIs spawn child processes, which inherit process.env.
//
// bootstrapDotenvx deletes the key itself on success, but NOT on its
// `module_unavailable` early return — which fires when @dotenvx/dotenvx cannot be
// required — because that return happens before the cleanup. Both paths are
// asserted here; only the failure path regressed.
describe('DOTENV_PRIVATE_KEY does not survive loadDemoEnv', () => {
  test('is absent after a normal (successful) load', () => {
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, 'LOAD_DEMO_ENV_PLAIN=plain-value\n');
    process.env.DEMO_API_ENV_FILE = envFile;
    process.env.DOTENV_PRIVATE_KEY = 'not-a-real-key';
    delete process.env.DOTENV_PRIVATE_KEY; // simulate "no key in the real env"

    // Force the shared-keys path to yield something so the bootstrap runs.
    jest.resetModules();
    jest.doMock('../../services/dotenvxBootstrap', () => ({
      bootstrapDotenvx: () => ({ loaded: true, applied: 0, decrypted: 0 }),
    }));
    const loader = require('../../scripts/loadDemoEnv');
    jest.spyOn(loader, 'resolveKeysCandidates');
    loader.loadDemoEnv();

    expect(process.env.DOTENV_PRIVATE_KEY).toBeUndefined();
    jest.dontMock('../../services/dotenvxBootstrap');
  });

  test('is absent even when the bootstrap bails out early (module unavailable)', () => {
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, 'LOAD_DEMO_ENV_PLAIN=plain-value\n');
    process.env.DEMO_API_ENV_FILE = envFile;

    jest.resetModules();
    // Exactly the shape of the real early return: no decryption, no cleanup.
    jest.doMock('../../services/dotenvxBootstrap', () => ({
      bootstrapDotenvx: () => ({ loaded: false, applied: 0, decrypted: 0, reason: 'module_unavailable' }),
    }));
    const loader = require('../../scripts/loadDemoEnv');

    // Only meaningful where a shared .env.keys exists to be picked up.
    if (loader.resolveKeysCandidates().length === 0) return;

    loader.loadDemoEnv();

    expect(process.env.DOTENV_PRIVATE_KEY).toBeUndefined();
    jest.dontMock('../../services/dotenvxBootstrap');
  });

  test('an externally-supplied key is left exactly as it was', () => {
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, 'LOAD_DEMO_ENV_PLAIN=plain-value\n');
    process.env.DEMO_API_ENV_FILE = envFile;
    process.env.DOTENV_PRIVATE_KEY = 'externally-supplied';

    jest.resetModules();
    jest.doMock('../../services/dotenvxBootstrap', () => ({
      bootstrapDotenvx: () => ({ loaded: false, applied: 0, decrypted: 0, reason: 'module_unavailable' }),
    }));
    require('../../scripts/loadDemoEnv').loadDemoEnv();

    expect(process.env.DOTENV_PRIVATE_KEY).toBe('externally-supplied');
    jest.dontMock('../../services/dotenvxBootstrap');
  });
});

// scripts/extract-browser-token.js writes .env.test-tokens and jest's
// globalSetup reads it, but the CLI verifiers never did — so each told you to
// log in again with a freshly extracted token already on disk. They also
// disagreed on the name: verify-token-exchange wanted
// INTEGRATION_SUBJECT_ACCESS_TOKEN (what the extractor writes),
// verify-act-claims wanted ACCESS_TOKEN (what nothing writes).
describe('readTestToken', () => {
  const TOKEN_FILE = path.resolve(__dirname, '../../.env.test-tokens');
  let preExisting = null;

  beforeEach(() => {
    // Never clobber a real token file if one happens to exist.
    preExisting = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE) : null;
  });
  afterEach(() => {
    if (preExisting !== null) fs.writeFileSync(TOKEN_FILE, preExisting);
    else fs.rmSync(TOKEN_FILE, { force: true });
  });

  test('reads INTEGRATION_SUBJECT_ACCESS_TOKEN — the name the extractor writes', () => {
    fs.writeFileSync(TOKEN_FILE, 'INTEGRATION_SUBJECT_ACCESS_TOKEN=header.payload.sig\n');
    expect(freshLoader().readTestToken()).toBe('header.payload.sig');
  });

  test('also accepts ACCESS_TOKEN, the name verify-act-claims documented', () => {
    fs.writeFileSync(TOKEN_FILE, 'ACCESS_TOKEN=alt.token.value\n');
    expect(freshLoader().readTestToken()).toBe('alt.token.value');
  });

  test('returns null when no token file exists (callers must still explain themselves)', () => {
    fs.rmSync(TOKEN_FILE, { force: true });
    expect(freshLoader().readTestToken()).toBeNull();
  });
});

// .env and .env.keys are gitignored, so a worktree has neither and must borrow
// the main checkout's. The pre-existing relative guesses only covered a worktree
// one or two levels down; this repo's live at `.claude/worktrees/<branch>/`
// (three), so a CLI run from one reported "missing PINGONE_ENVIRONMENT_ID" —
// which reads as unconfigured rather than as the wrong directory.
test('candidate resolution reaches the main checkout from any worktree depth', () => {
  const { resolveEnvCandidates, resolveKeysCandidates } = freshLoader();

  const gitCommon = execFileSync(
    'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: __dirname, encoding: 'utf8' },
  ).trim();
  const mainRoot = path.dirname(gitCommon);

  // Only meaningful where the main checkout actually holds the gitignored files.
  if (fs.existsSync(path.join(mainRoot, 'demo_api_server', '.env'))) {
    expect(resolveEnvCandidates()).toContain(path.join(mainRoot, 'demo_api_server', '.env'));
  }
  if (fs.existsSync(path.join(mainRoot, '.env.keys'))) {
    expect(resolveKeysCandidates()).toContain(path.join(mainRoot, '.env.keys'));
  }
});
