'use strict';

/**
 * Plan 269.1-02 Task 1 — adminVault.regression.test.js (RED)
 *
 * Mocked-dependency suite for `/api/admin/vault/{status,unlock,rotate}`.
 *
 * Mocks:
 *   - ../../middleware/auth.requireAdmin   → tiny gate on req.user.role
 *   - ../../services/vaultLoader           → controllable jest.fn() shims for
 *                                            unlockVaultAtRuntime,
 *                                            isVaultUnlockedThisProcess,
 *                                            vaultEntryCountThisProcess,
 *                                            DEFAULT_VAULT_PATH
 *   - ../../lib/vault.openVault            → controllable for rotate re-verify path
 *   - ../../lib/vault/audit.recordAudit    → jest.fn() to assert audit fields
 *   - ../../lib/vault/errors               → REAL (handlers do err.name === 'VaultAuthError')
 *
 * The test app sets req.user via an inline middleware, exactly mirroring what
 * the outer `authenticateToken` would do in production.
 */

const express = require('express');
const request = require('supertest');

jest.setTimeout(30000);

// --- mocks (must precede route require) -------------------------------------

jest.mock('../../middleware/auth', () => ({
  requireAdmin: (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    if (!req.user) {
      return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    }
    return res.status(403).json({ error: 'INSUFFICIENT_SCOPE' });
  },
}));

jest.mock('../../services/vaultLoader', () => ({
  unlockVaultAtRuntime: jest.fn(),
  isVaultUnlockedThisProcess: jest.fn(),
  vaultEntryCountThisProcess: jest.fn(),
  DEFAULT_VAULT_PATH: '/tmp/test-default.vault',
}));

jest.mock('../../lib/vault', () => ({
  openVault: jest.fn(),
}));

jest.mock('../../lib/vault/audit', () => ({
  recordAudit: jest.fn(),
}));

// Keep ../../services/configStore lightweight (router require()'s it at top-level).
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
  setRaw: jest.fn(),
}));

// errors module is REAL — do NOT mock.

// --- helpers ----------------------------------------------------------------

const ORIG_ENV = { ...process.env };

function buildApp({ withVercel = false, withAuth = 'admin' } = {}) {
  jest.resetModules();
  // Re-apply mocks after resetModules (jest tracks via the registered factories).
  // Re-require referenced classes through the mocked vault module so tests can
  // construct error instances.
  if (withVercel) {
    process.env.VERCEL = '1';
  } else {
    delete process.env.VERCEL;
  }
  // NOTE: process.env.VAULT_PATH is read lazily by the route at request time
  // via resolveVaultPath(), so individual tests set/clear it themselves.

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (withAuth === 'admin')    req.user = { sub: 'admin-test', role: 'admin' };
    if (withAuth === 'customer') req.user = { sub: 'cust-test',  role: 'customer' };
    next();
  });
  // eslint-disable-next-line global-require
  const router = require('../../routes/adminVault');
  app.use('/api/admin/vault', router);
  return app;
}

function getMocks() {
  return {
    vaultLoader: require('../../services/vaultLoader'),
    vaultLib:    require('../../lib/vault'),
    audit:       require('../../lib/vault/audit'),
    errors:      require('../../lib/vault/errors'),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  // Restore env so VAULT_PATH / VERCEL set by individual tests doesn't leak.
  process.env = { ...ORIG_ENV };
  delete process.env.VAULT_PATH;
  delete process.env.VERCEL;
});

// ============================================================================
// GET /api/admin/vault/status
// ============================================================================

describe('GET /api/admin/vault/status', () => {
  test('1. returns documented shape with no entry names / keys', async () => {
    const app = buildApp();
    const m = getMocks();
    m.vaultLoader.isVaultUnlockedThisProcess.mockReturnValue(true);
    m.vaultLoader.vaultEntryCountThisProcess.mockReturnValue(7);
    const res = await request(app).get('/api/admin/vault/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('unlocked');
    expect(res.body).toHaveProperty('entriesLoaded');
    expect(res.body).toHaveProperty('vaultFilePresent');
    expect(res.body).toHaveProperty('vaultPath');
    expect(res.body).not.toHaveProperty('entries');
    expect(res.body).not.toHaveProperty('entryNames');
    expect(res.body).not.toHaveProperty('keys');
    expect(res.body.unlocked).toBe(true);
    expect(res.body.entriesLoaded).toBe(7);
  });

  test('2. vaultPath uses path.basename — never full path (T-269.1-09)', async () => {
    // Set VAULT_PATH env BEFORE buildApp() resets modules so the route picks it up
    // via resolveVaultPath() = process.env.VAULT_PATH || DEFAULT_VAULT_PATH.
    process.env.VAULT_PATH = '/very/deep/path/secrets.vault';
    const app = buildApp();
    const m = getMocks();
    m.vaultLoader.isVaultUnlockedThisProcess.mockReturnValue(false);
    m.vaultLoader.vaultEntryCountThisProcess.mockReturnValue(0);
    const res = await request(app).get('/api/admin/vault/status');
    expect(res.status).toBe(200);
    expect(res.body.vaultPath).toBe('secrets.vault');
    expect(res.body.vaultPath).not.toContain('/');
  });
});

// ============================================================================
// POST /api/admin/vault/unlock
// ============================================================================

describe('POST /api/admin/vault/unlock', () => {
  test('3. without admin session returns 401', async () => {
    const app = buildApp({ withAuth: 'none' });
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'x' });
    expect(res.status).toBe(401);
  });

  test('4. with non-admin role returns 403', async () => {
    const app = buildApp({ withAuth: 'customer' });
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'x' });
    expect(res.status).toBe(403);
  });

  test('5. missing password returns 400 bad_request', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
  });

  test('6. empty-string password returns 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
  });

  test('7. VaultAuthError → 401 with opaque message', async () => {
    const app = buildApp();
    const m = getMocks();
    const err = new m.errors.VaultAuthError('vault: open failed (bad password or tampered file)');
    m.vaultLoader.unlockVaultAtRuntime.mockRejectedValue(err);
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('vault: open failed (bad password or tampered file)');
  });

  test('8. VaultIntegrityError → 401 with IDENTICAL message to wrong-password', async () => {
    const app = buildApp();
    const m = getMocks();
    const authErr = new m.errors.VaultAuthError('vault: open failed (bad password or tampered file)');
    m.vaultLoader.unlockVaultAtRuntime.mockRejectedValueOnce(authErr);
    const authRes = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'wrong' });

    const integrityErr = new m.errors.VaultIntegrityError('vault: open failed (bad password or tampered file)');
    m.vaultLoader.unlockVaultAtRuntime.mockRejectedValueOnce(integrityErr);
    const integrityRes = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'whatever' });

    expect(authRes.status).toBe(401);
    expect(integrityRes.status).toBe(401);
    expect(authRes.body.message).toBe(integrityRes.body.message);  // BYTE-EQUAL
    expect(integrityRes.body.message).toBe('vault: open failed (bad password or tampered file)');
  });

  test('9. VAULT_FILE_NOT_FOUND code → 404', async () => {
    const app = buildApp();
    const m = getMocks();
    const err = new Error('vault: file not found');
    err.code = 'VAULT_FILE_NOT_FOUND';
    m.vaultLoader.unlockVaultAtRuntime.mockRejectedValue(err);
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'whatever' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('vault_file_not_found');
  });

  test('10. happy path returns 200 {ok:true, entriesLoaded:N}; password never echoed', async () => {
    const app = buildApp();
    const m = getMocks();
    m.vaultLoader.unlockVaultAtRuntime.mockResolvedValue({ loaded: true, entries: 3 });
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'right-password' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, entriesLoaded: 3 });
    expect(JSON.stringify(res.body).indexOf('password')).toBe(-1);
    expect(JSON.stringify(res.body).indexOf('right-password')).toBe(-1);
  });

  test('11. success path writes ONE recordAudit with op=unlock + caller=adminVault + result=ok', async () => {
    const app = buildApp();
    const m = getMocks();
    m.vaultLoader.unlockVaultAtRuntime.mockResolvedValue({ loaded: true, entries: 5 });
    await request(app).post('/api/admin/vault/unlock').send({ password: 'right' });
    expect(m.audit.recordAudit).toHaveBeenCalledTimes(1);
    const args = m.audit.recordAudit.mock.calls[0][1];
    expect(args).toMatchObject({
      op: 'unlock',
      caller: 'adminVault',
      result: 'ok',
    });
  });

  test('12. VaultAuthError path writes recordAudit with result=bad_password + caller=adminVault (NOT vault.js)', async () => {
    const app = buildApp();
    const m = getMocks();
    const err = new m.errors.VaultAuthError('vault: open failed (bad password or tampered file)');
    m.vaultLoader.unlockVaultAtRuntime.mockRejectedValue(err);
    await request(app).post('/api/admin/vault/unlock').send({ password: 'wrong' });
    expect(m.audit.recordAudit).toHaveBeenCalledTimes(1);
    const args = m.audit.recordAudit.mock.calls[0][1];
    expect(args.result).toBe('bad_password');
    expect(args.caller).toBe('adminVault');
    expect(args.caller).not.toBe('vault.js');
  });
});

// ============================================================================
// POST /api/admin/vault/rotate
// ============================================================================

describe('POST /api/admin/vault/rotate', () => {
  test('13. when vault is NOT unlocked → 423 vault_locked + recordAudit result=locked', async () => {
    const app = buildApp();
    const m = getMocks();
    m.vaultLoader.isVaultUnlockedThisProcess.mockReturnValue(false);
    const res = await request(app)
      .post('/api/admin/vault/rotate')
      .send({ currentPassword: 'old-password-xxxx', newPassword: 'new-password-yyyy' });
    expect(res.status).toBe(423);
    expect(res.body.error).toBe('vault_locked');
    const auditArgs = m.audit.recordAudit.mock.calls.find(c => c[1].op === 'rotate');
    expect(auditArgs).toBeDefined();
    expect(auditArgs[1].result).toBe('locked');
    expect(auditArgs[1].caller).toBe('adminVault');
  });

  test('14. newPassword < 12 chars → 400 weak_password', async () => {
    const app = buildApp();
    const m = getMocks();
    m.vaultLoader.isVaultUnlockedThisProcess.mockReturnValue(true);
    const res = await request(app)
      .post('/api/admin/vault/rotate')
      .send({ currentPassword: 'old-password-xxxx', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('weak_password');
  });

  test('15. newPassword === currentPassword → 400 same_password', async () => {
    const app = buildApp();
    const m = getMocks();
    m.vaultLoader.isVaultUnlockedThisProcess.mockReturnValue(true);
    const res = await request(app)
      .post('/api/admin/vault/rotate')
      .send({ currentPassword: 'same-password-1234', newPassword: 'same-password-1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('same_password');
  });
});

// ============================================================================
// Vercel guard
// ============================================================================

describe('VERCEL=1 returns 503 for all three routes', () => {
  test('16. status, unlock, rotate all return 503 vault_disabled_serverless when VERCEL=1', async () => {
    const app = buildApp({ withVercel: true });
    const statusRes = await request(app).get('/api/admin/vault/status');
    const unlockRes = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'whatever' });
    const rotateRes = await request(app)
      .post('/api/admin/vault/rotate')
      .send({ currentPassword: 'a', newPassword: 'b' });

    for (const r of [statusRes, unlockRes, rotateRes]) {
      expect(r.status).toBe(503);
      expect(r.body.error).toBe('vault_disabled_serverless');
    }
  });
});

// ============================================================================
// Rate limiter
// ============================================================================

describe('Rate limiter on POST /unlock', () => {
  test('17. 6th attempt within 5 min returns 429 without calling unlockVaultAtRuntime', async () => {
    const app = buildApp();
    const m = getMocks();
    // Make every call "fail" so unlock doesn't short-circuit; the limiter counts ALL attempts.
    const err = new m.errors.VaultAuthError('vault: open failed (bad password or tampered file)');
    m.vaultLoader.unlockVaultAtRuntime.mockRejectedValue(err);

    // First 5 attempts hit the handler
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/admin/vault/unlock')
        .send({ password: 'guess-' + i });
      // 401 from VaultAuthError mapping (handler IS reached)
      expect(res.status).toBe(401);
    }
    expect(m.vaultLoader.unlockVaultAtRuntime).toHaveBeenCalledTimes(5);

    // 6th attempt is throttled — does NOT reach handler
    const sixth = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'guess-6' });
    expect(sixth.status).toBe(429);
    expect(m.vaultLoader.unlockVaultAtRuntime).toHaveBeenCalledTimes(5); // not 6
  });
});

// ============================================================================
// Password hygiene — SENTINEL must not leak to logs or audit
// ============================================================================

describe('Password hygiene (T-269.1-03)', () => {
  test('18. password never reaches recordAudit args or console output', async () => {
    const SENTINEL = 'SENTINEL-PWD-DO-NOT-LOG-001';
    const app = buildApp();
    const m = getMocks();
    m.vaultLoader.unlockVaultAtRuntime.mockResolvedValue({ loaded: true, entries: 1 });

    const logSpy   = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy   = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: SENTINEL });
    expect(res.status).toBe(200);

    // recordAudit args
    for (const call of m.audit.recordAudit.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SENTINEL);
    }
    // console output
    for (const call of [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(SENTINEL);
    }
    // response body
    expect(JSON.stringify(res.body)).not.toContain(SENTINEL);

    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
