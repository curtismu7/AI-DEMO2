'use strict';

/**
 * Plan 269.1-02 Task 1 — adminVault.integration.test.js (RED)
 *
 * Real-vault-file suite. The vault library, audit module, configStore, and
 * vaultLoader are all REAL. Only middleware/auth.requireAdmin is mocked so
 * we can pretend req.user is an admin without booting PingOne.
 *
 * beforeAll creates a real encrypted vault in a tmpdir; afterAll cleans up.
 */

const express = require('express');
const request = require('supertest');
const path    = require('node:path');
const fs      = require('node:fs');
const os      = require('node:os');

jest.setTimeout(60000);

// Mock ONLY the admin gate. Real vaultLoader + configStore + lib/vault.
jest.mock('../../middleware/auth', () => ({
  requireAdmin: (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    if (!req.user) {
      return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    }
    return res.status(403).json({ error: 'INSUFFICIENT_SCOPE' });
  },
}));

const ORIG_ENV = { ...process.env };
const VAULT_PW = 'integration-pw-001';
let tmpDir;
let vaultPath;

async function createTestVault(pw) {
  // eslint-disable-next-line global-require
  const vaultLib = require('../../lib/vault');
  // Use createVault to set up the file fresh, then set + save.
  const handle = await vaultLib.createVault(vaultPath, pw);
  handle.set('TEST_KEY', 'test-value');
  await handle.save();
  handle.close();
}

function buildApp({ withVercel = false } = {}) {
  jest.resetModules();
  if (withVercel) {
    process.env.VERCEL = '1';
  } else {
    delete process.env.VERCEL;
  }
  // Plan 02 router uses process.env.VAULT_PATH || DEFAULT_VAULT_PATH
  process.env.VAULT_PATH = vaultPath;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { sub: 'admin-int', role: 'admin' };
    next();
  });
  // eslint-disable-next-line global-require
  const router = require('../../routes/adminVault');
  app.use('/api/admin/vault', router);
  return app;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-vault-int-'));
  vaultPath = path.join(tmpDir, 'test.vault');
  delete process.env.VAULT_PASSWORD;
  await createTestVault(VAULT_PW);
});

afterAll(() => {
  process.env = { ...ORIG_ENV };
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

afterEach(() => {
  delete process.env.VERCEL;
});

describe('Integration: /api/admin/vault/* (real vault file, real configStore)', () => {
  test('1. POST /unlock with correct password loads entries into real configStore', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: VAULT_PW });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.entriesLoaded).toBeGreaterThanOrEqual(1);

    // Real configStore should resolve the entry (lowercased per loader contract)
    // eslint-disable-next-line global-require
    const configStore = require('../../services/configStore');
    expect(configStore.getEffective('test_key')).toBe('test-value');
  });

  test('2. POST /unlock with wrong password returns 401 with canonical opaque message', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: 'definitely-wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('vault: open failed (bad password or tampered file)');
  });

  test('3. POST /unlock writes audit line with caller=adminVault, op=unlock, result=ok', async () => {
    const app = buildApp();
    const auditFile = vaultPath + '.audit.log';
    // Capture audit file size before to find the new line at the tail
    const sizeBefore = fs.existsSync(auditFile) ? fs.statSync(auditFile).size : 0;

    const res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: VAULT_PW });
    expect(res.status).toBe(200);

    expect(fs.existsSync(auditFile)).toBe(true);
    const newBytes = fs.readFileSync(auditFile, 'utf8').slice(sizeBefore);
    const lines = newBytes.trim().split('\n').filter(Boolean);
    // Find the line written by the route (caller=adminVault). Open ops by lib/vault
    // use caller=vault.js, so filter.
    const adminLine = lines.map((l) => JSON.parse(l)).find((j) => j.caller === 'adminVault');
    expect(adminLine).toBeDefined();
    expect(adminLine.op).toBe('unlock');
    expect(adminLine.result).toBe('ok');
  });

  test('4. POST /rotate with wrong currentPassword returns 401 (re-verify catches stale unlock)', async () => {
    const app = buildApp();
    // First unlock so isVaultUnlockedThisProcess() returns true.
    let res = await request(app)
      .post('/api/admin/vault/unlock')
      .send({ password: VAULT_PW });
    expect(res.status).toBe(200);

    res = await request(app)
      .post('/api/admin/vault/rotate')
      .send({ currentPassword: 'wrong-not-the-password', newPassword: 'newer-integration-pw' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('vault: open failed (bad password or tampered file)');
  });

  test('5. POST /rotate happy path persists — file re-opens with new password, fails with old', async () => {
    // Build a fresh tmp vault for this isolated rotate test so we don't disturb
    // the shared vault across the other tests.
    const isoTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-vault-rotate-'));
    const isoVaultPath = path.join(isoTmpDir, 'rotate.vault');
    const OLD_PW = 'integration-pw-001';
    const NEW_PW = 'integration-pw-002-newer';

    try {
      // eslint-disable-next-line global-require
      const vaultLib = require('../../lib/vault');
      let h = await vaultLib.createVault(isoVaultPath, OLD_PW);
      h.set('K', 'v');
      await h.save();
      h.close();

      // Build app with this iso vault path
      jest.resetModules();
      delete process.env.VERCEL;
      process.env.VAULT_PATH = isoVaultPath;
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.user = { sub: 'admin-int', role: 'admin' };
        next();
      });
      // eslint-disable-next-line global-require
      const router = require('../../routes/adminVault');
      app.use('/api/admin/vault', router);

      // Unlock
      let res = await request(app).post('/api/admin/vault/unlock').send({ password: OLD_PW });
      expect(res.status).toBe(200);

      // Rotate
      res = await request(app)
        .post('/api/admin/vault/rotate')
        .send({ currentPassword: OLD_PW, newPassword: NEW_PW });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Now re-open the file with the OLD password — should throw VaultAuthError.
      // eslint-disable-next-line global-require
      const vl = require('../../lib/vault');
      await expect(vl.openVault(isoVaultPath, OLD_PW)).rejects.toThrow();

      // Re-open with NEW password — should succeed.
      const h2 = await vl.openVault(isoVaultPath, NEW_PW);
      expect(h2.read('K')).toBe('v');
      h2.close();
    } finally {
      fs.rmSync(isoTmpDir, { recursive: true, force: true });
    }
  });

  test('6. Two concurrent rotate calls — one 200 + one 409 (mutex enforced)', async () => {
    // Use isolated tmp vault so concurrency mutation doesn't bleed into other tests.
    const isoTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-vault-concur-'));
    const isoVaultPath = path.join(isoTmpDir, 'concur.vault');
    const OLD_PW = 'concur-pw-001-original';

    try {
      // eslint-disable-next-line global-require
      const vaultLib = require('../../lib/vault');
      const h = await vaultLib.createVault(isoVaultPath, OLD_PW);
      h.set('K', 'v');
      await h.save();
      h.close();

      jest.resetModules();
      delete process.env.VERCEL;
      process.env.VAULT_PATH = isoVaultPath;
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.user = { sub: 'admin-int', role: 'admin' };
        next();
      });
      // eslint-disable-next-line global-require
      const router = require('../../routes/adminVault');
      app.use('/api/admin/vault', router);

      // Unlock first
      const ur = await request(app).post('/api/admin/vault/unlock').send({ password: OLD_PW });
      expect(ur.status).toBe(200);

      // Fire two concurrent rotates with valid creds — one MUST win, one MUST 409.
      const [r1, r2] = await Promise.all([
        request(app)
          .post('/api/admin/vault/rotate')
          .send({ currentPassword: OLD_PW, newPassword: 'rotate-concur-A-pw' }),
        request(app)
          .post('/api/admin/vault/rotate')
          .send({ currentPassword: OLD_PW, newPassword: 'rotate-concur-B-pw' }),
      ]);

      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);
      const conflict = r1.status === 409 ? r1 : r2;
      expect(conflict.body.error).toBe('rotate_in_progress');
    } finally {
      fs.rmSync(isoTmpDir, { recursive: true, force: true });
    }
  });
});
