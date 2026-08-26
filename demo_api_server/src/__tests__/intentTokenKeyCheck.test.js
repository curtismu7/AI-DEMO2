'use strict';

/**
 * @file intentTokenKeyCheck.test.js
 * @description Posture check for intent-token key parity across the three sides.
 *
 * Reproduces the two real failures (TECH_DEBT 2026-08-26), which happened
 * simultaneously and neither of which surfaced anywhere:
 *
 *   Node gateway  no INTENT_TOKEN_SECRET   -> "no_signing_key"      (visible)
 *   PingGateway   a DIFFERENT key          -> invalid_signature     (SILENT)
 *
 * plus the root cause: the BFF signing with configStore's at-rest CIPHERTEXT,
 * which is a perfectly usable HMAC key that no correct verifier can match.
 *
 * The check reads the gateways' env files, so the fixture writes real files into
 * a temp /repo-shaped tree and points the module at it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REAL_KEY = 'a-real-dedicated-intent-secret';
let repo;

/** Build a /repo-shaped tree with the two gateway env files. */
function makeRepo({ nodeKey, igKey, omitNode = false, omitIg = false }) {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'intentkey-'));
  fs.mkdirSync(path.join(repo, 'demo_mcp_gateway'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'ping-gateway'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'demo_mcp_gateway', '.env'),
    omitNode ? 'OTHER=1\n' : `OTHER=1\nINTENT_TOKEN_SECRET=${nodeKey}\n`,
  );
  fs.writeFileSync(
    path.join(repo, 'ping-gateway', '.env'),
    omitIg ? 'OTHER=1\n' : `OTHER=1\nINTENT_TOKEN_SECRET=${igKey}\n`,
  );
  return repo;
}

/**
 * The module resolves its repo root at require time (prefers /repo, else three
 * levels up). Point that fallback at the fixture by loading it from a copy whose
 * __dirname sits at <repo>/demo_api_server/services/checks.
 */
function loadCheck() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'services', 'checks', 'intentTokenKeyCheck.js'),
    'utf8',
  );
  const dir = path.join(repo, 'demo_api_server', 'services', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  // Neutralise the /repo preference so the relative fallback (which lands on the
  // fixture) is used, and stub the registry require.
  const patched = src
    .replace("fs.existsSync('/repo')", 'false')
    .replace("require('./registry')", "{ register: () => {} }");
  const file = path.join(dir, 'intentTokenKeyCheck.js');
  fs.writeFileSync(file, patched);
  delete require.cache[require.resolve(file)];
  return require(file).parity;
}

const ENV_KEYS = ['INTENT_TOKEN_SECRET', 'SESSION_SECRET'];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
  repo = null;
});

describe('intent.key_parity', () => {
  it('passes when a dedicated key matches both gateways', async () => {
    makeRepo({ nodeKey: REAL_KEY, igKey: REAL_KEY });
    process.env.INTENT_TOKEN_SECRET = REAL_KEY;
    const res = await loadCheck().run({});
    expect(res.status).toBe('pass');
    expect(res.detail).toMatch(/matches 2\/2 gateways/);
  });

  // Failure 1, as it actually was.
  it('FAILS when the Node gateway has no key at all', async () => {
    makeRepo({ igKey: REAL_KEY, omitNode: true });
    process.env.INTENT_TOKEN_SECRET = REAL_KEY;
    const res = await loadCheck().run({});
    expect(res.status).toBe('fail');
    expect(res.detail).toMatch(/Node gateway/);
    expect(res.detail).toMatch(/no_signing_key/);
  });

  // Failure 2, as it actually was — and the one that was silent.
  it('FAILS when PingGateway holds a different key', async () => {
    makeRepo({ nodeKey: REAL_KEY, igKey: 'some-other-key-entirely' });
    process.env.INTENT_TOKEN_SECRET = REAL_KEY;
    const res = await loadCheck().run({});
    expect(res.status).toBe('fail');
    expect(res.detail).toMatch(/PingGateway/);
    expect(res.detail).toMatch(/invalid_signature/);
  });

  // The root cause: a usable-but-unmatchable key.
  it('FAILS when the BFF key is configStore ciphertext, before comparing anything', async () => {
    makeRepo({ nodeKey: REAL_KEY, igKey: REAL_KEY });
    process.env.SESSION_SECRET = 'encrypted:AAAAAAAAAAAAAAAAAAAA';
    const res = await loadCheck().run({});
    expect(res.status).toBe('fail');
    expect(res.detail).toMatch(/ciphertext/i);
    expect(res.nextAction).toMatch(/no gateway can ever verify/i);
  });

  // Works, but hands a gateway the browser-session key.
  it('WARNS when parity holds only via the SESSION_SECRET fallback', async () => {
    makeRepo({ nodeKey: REAL_KEY, igKey: REAL_KEY });
    process.env.SESSION_SECRET = REAL_KEY;
    const res = await loadCheck().run({});
    expect(res.status).toBe('warn');
    expect(res.nextAction).toMatch(/dedicated/i);
  });

  it('FAILS when the BFF has no key at all', async () => {
    makeRepo({ nodeKey: REAL_KEY, igKey: REAL_KEY });
    const res = await loadCheck().run({});
    expect(res.status).toBe('fail');
    expect(res.detail).toMatch(/no intent-token signing key/i);
  });

  // A check that compared nothing must not report green — the same shape of
  // silent lie this check exists to catch. Hit for real on the first live run.
  it('WARNS rather than passing when neither gateway env file is readable', async () => {
    makeRepo({ nodeKey: REAL_KEY, igKey: REAL_KEY });
    fs.rmSync(path.join(repo, 'demo_mcp_gateway'), { recursive: true, force: true });
    fs.rmSync(path.join(repo, 'ping-gateway'), { recursive: true, force: true });
    process.env.INTENT_TOKEN_SECRET = REAL_KEY;
    const res = await loadCheck().run({});
    expect(res.status).toBe('warn');
    expect(res.detail).toMatch(/nothing was compared/);
  });

  // Key material must never reach a posture report or a log line.
  it('never emits the key itself, only a short digest', async () => {
    makeRepo({ nodeKey: REAL_KEY, igKey: REAL_KEY });
    process.env.INTENT_TOKEN_SECRET = REAL_KEY;
    const res = await loadCheck().run({});
    const blob = JSON.stringify(res);
    expect(blob).not.toContain(REAL_KEY);
    expect(res.meta.bffKeyDigest).toMatch(/^[0-9a-f]{12}$/);
  });
});
