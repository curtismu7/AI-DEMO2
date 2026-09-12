'use strict';

// C3: propagateServiceEnvs (= main) is awaited by the rotation CLI AFTER the
// irreversible PingOne rotate and the vault write. Its four "nothing to do"
// process.exit(0) calls killed that whole process mid-rotation — no verify, no
// restart guidance, no DONE line, and exit status 0, which reads as success.
// They throw now, tagged `skipped`, and the direct-CLI path still exits 0.

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const API_ENV = path.join(ROOT, 'demo_api_server', '.env');
const SCRIPT = path.join(ROOT, 'demo_api_server', 'scripts', 'refresh-service-envs.js');

const { propagateServiceEnvs } = require('../scripts/refresh-service-envs');

const FULL_ENV = [
  'PINGONE_ENVIRONMENT_ID=env-1',
  'PINGONE_REGION=com',
  'PINGONE_WORKER_CLIENT_ID=worker-id',
  'PINGONE_WORKER_CLIENT_SECRET=worker-secret',
].join('\n');

let realExists;
let realRead;

/** Make demo_api_server/.env appear to hold `text` (or not exist at all). */
function fakeApiEnv(text) {
  fs.existsSync = (p) => (p === API_ENV ? text !== null : realExists(p));
  fs.readFileSync = (p, enc) => (p === API_ENV ? text : realRead(p, enc));
}

/** Fake https.request whose behaviour is driven by a per-call handler. */
function stubHttps(handler) {
  jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
      process.nextTick(() => {
        const outcome = handler(opts);
        if (outcome.error) return req.emit('error', new Error(outcome.error));
        const res = new EventEmitter();
        res.statusCode = outcome.status;
        cb(res);
        res.emit('data', JSON.stringify(outcome.body || {}));
        res.emit('end');
        return undefined;
      });
    };
    return req;
  });
}

describe('propagateServiceEnvs skip conditions throw instead of exiting', () => {
  let exitSpy;

  beforeEach(() => {
    realExists = fs.existsSync;
    realRead = fs.readFileSync;
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit() was called — it must not be');
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    fs.existsSync = realExists;
    fs.readFileSync = realRead;
    jest.restoreAllMocks();
  });

  test('skip 1: demo_api_server/.env missing', async () => {
    fakeApiEnv(null);
    await expect(propagateServiceEnvs()).rejects.toMatchObject({
      skipped: true, message: expect.stringMatching(/bootstrap not yet run/),
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('skip 2: worker credentials absent', async () => {
    fakeApiEnv('PINGONE_REGION=com');
    await expect(propagateServiceEnvs()).rejects.toMatchObject({
      skipped: true, message: expect.stringMatching(/Missing PINGONE_ENVIRONMENT_ID/),
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('skip 3: the worker token request fails', async () => {
    fakeApiEnv(FULL_ENV);
    stubHttps(() => ({ error: 'getaddrinfo ENOTFOUND' }));
    await expect(propagateServiceEnvs()).rejects.toMatchObject({
      skipped: true, message: expect.stringMatching(/Could not get PingOne worker token/),
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('skip 4: app resolution fails', async () => {
    fakeApiEnv(FULL_ENV);
    stubHttps((opts) => (opts.method === 'POST'
      ? { status: 200, body: { access_token: 'tok' } }
      : { status: 500, body: { code: 'boom' } }));
    await expect(propagateServiceEnvs()).rejects.toMatchObject({
      skipped: true, message: expect.stringMatching(/Could not resolve apps from PingOne/),
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('a genuine fault is a plain Error, not a skip', async () => {
    fakeApiEnv(FULL_ENV);
    // scope-topology.json is read after the token succeeds; make that read fail.
    fs.readFileSync = (p, enc) => {
      if (p === API_ENV) return FULL_ENV;
      if (String(p).endsWith('scope-topology.json')) throw new Error('synthetic disk fault');
      return realRead(p, enc);
    };
    stubHttps(() => ({ status: 200, body: { access_token: 'tok' } }));
    const err = await propagateServiceEnvs().catch((e) => e);
    expect(err.message).toMatch(/synthetic disk fault/);
    expect(err.skipped).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// run.sh invokes this script directly and its whole point is a clean no-op on a
// fresh/unbootstrapped clone. That contract must be byte-for-byte unchanged.
describe('direct CLI invocation (run.sh contract)', () => {
  test('a skip still exits 0 and prints the same text', () => {
    // The worktree has no demo_api_server/.env, so this is skip 1 for real.
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: ROOT });
    const output = r.stdout + r.stderr;
    if (fs.existsSync(API_ENV)) {
      // Main checkout: a bootstrapped .env takes a different path — the contract
      // under test (skip => 0) is only assertable without it.
      expect([0, 1]).toContain(r.status);
      return;
    }
    expect(r.status).toBe(0);
    expect(output).toMatch(/bootstrap not yet run, skipping/);
  });

  test('a fatal error still exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-envs-'));
    const preload = path.join(dir, 'preload.js');
    // Force the fatal branch: make .env appear present, then fail its read.
    fs.writeFileSync(preload, [
      "const fs = require('fs');",
      'const realExists = fs.existsSync;',
      "fs.existsSync = (p) => (String(p).endsWith('demo_api_server/.env') ? true : realExists(p));",
      'const realRead = fs.readFileSync;',
      "fs.readFileSync = (p, e) => { if (String(p).endsWith('demo_api_server/.env')) "
        + "{ throw new Error('synthetic fatal'); } return realRead(p, e); };",
      '',
    ].join('\n'));

    const r = spawnSync(process.execPath, ['-r', preload, SCRIPT], { encoding: 'utf8', cwd: ROOT });
    fs.rmSync(dir, { recursive: true, force: true });

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Fatal error: synthetic fatal/);
  });
});
