'use strict';

/**
 * /api/admin/vault — runtime unlock + rotate + status (Phase 269.1 Plan 02).
 *
 *   GET  /api/admin/vault/status   → { unlocked, entriesLoaded, vaultFilePresent, vaultPath:basename }
 *   POST /api/admin/vault/unlock   → body { password } → { ok: true, entriesLoaded: N }
 *   POST /api/admin/vault/rotate   → body { currentPassword, newPassword } → { ok: true, message }
 *
 * Auth model:
 *   - Outer `authenticateToken` (mounted in server.js) runs FIRST — unauthenticated
 *     callers get 401 before they reach this router.
 *   - This router's first middleware is the Vercel bypass (503 when VERCEL=1).
 *   - Each handler then runs per-handler `requireAdmin` (and rate limiter on /unlock).
 *
 * Security:
 *   - Same opaque error for VaultAuthError + VaultIntegrityError (no oracle).
 *   - Rotate handler ALWAYS re-verifies currentPassword via openVault before calling
 *     handle.rotate — defense in depth even if in-memory unlock state is stale.
 *   - Module-scoped rotate mutex prevents two concurrent rotates from interleaving.
 *   - Vault path is NEVER taken from req.body (T-269.1-09) — process.env.VAULT_PATH
 *     or DEFAULT_VAULT_PATH only.
 *   - Status endpoint returns only `path.basename(vaultPath)` — never the full path.
 *   - Audit log uses the 4-field allowlist (op, key, result, caller) — physically
 *     cannot leak a password value.
 */

const express   = require('express');
const rateLimit = require('express-rate-limit');
const path      = require('node:path');
const fs        = require('node:fs');

const { requireAdmin } = require('../middleware/auth');
const configStore      = require('../services/configStore');
const {
  unlockVaultAtRuntime,
  isVaultUnlockedThisProcess,
  vaultEntryCountThisProcess,
  DEFAULT_VAULT_PATH,
} = require('../services/vaultLoader');
const vaultLib         = require('../lib/vault');
const { recordAudit }  = require('../lib/vault/audit');

const router = express.Router();

// ---------------------------------------------------------------------------
// Vercel bypass — runs AFTER outer authenticateToken (mounted in server.js, so
// unauthenticated probers get 401 before reaching here) but BEFORE per-handler
// requireAdmin. On Vercel, every caller (admin or not) gets 503 — no oracle.
// ---------------------------------------------------------------------------
router.use((req, res, next) => {
  if (process.env.VERCEL === '1') {
    return res.status(503).json({
      error: 'vault_disabled_serverless',
      message: 'Vault is disabled on Vercel. Use Encrypted Environment Variables.',
    });
  }
  next();
});

// ---------------------------------------------------------------------------
// Rate limiter — 5 unlock attempts per 5 min, keyed by admin sub (then IP).
// Mirrors the canonical shape used by routes/adminConfig.js (express-rate-limit ^7).
// ---------------------------------------------------------------------------
const unlockLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || req.ip,
  message: { error: 'too_many_requests', message: 'Too many unlock attempts. Wait 5 minutes.' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const resolveVaultPath = () => process.env.VAULT_PATH || DEFAULT_VAULT_PATH;
const auditPath        = () => resolveVaultPath() + '.audit.log';

function safeAudit(entry) {
  try {
    recordAudit(auditPath(), entry);
  } catch (_) {
    /* audit channel is best-effort; primary op must still respond */
  }
}

// Module-scoped mutex (single-process demo scale; multi-process BFF deployments
// don't exist in this repo today). Two parallel rotates: one 200, one 409.
let rotateInProgress = false;

// ---------------------------------------------------------------------------
// GET /api/admin/vault/status — no audit (read-only metadata)
// ---------------------------------------------------------------------------
// WR-02 (Phase 269.1 review): `entriesLoaded` returns the integer count, not a
// boolean. This is a deliberate operator-UX trade — admins need to confirm
// "vault loaded N entries as expected" after unlock/rotate, and an admin who
// reaches this endpoint is already inside the trust boundary (authenticated +
// requireAdmin). Names are never returned; only the count. Disposition:
// accepted (admin-only; no enumeration of names).
router.get('/status', requireAdmin, (req, res) => {
  const vaultPath = resolveVaultPath();
  return res.json({
    unlocked:         isVaultUnlockedThisProcess(),
    entriesLoaded:    vaultEntryCountThisProcess(),
    vaultFilePresent: fs.existsSync(vaultPath),
    vaultPath:        path.basename(vaultPath),
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/vault/unlock
// ---------------------------------------------------------------------------
router.post('/unlock', requireAdmin, unlockLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'bad_request', message: 'password (string) required' });
  }
  const vaultPath = resolveVaultPath();
  try {
    const result = await unlockVaultAtRuntime({ password, vaultPath, configStore, vaultLib });
    safeAudit({ op: 'unlock', key: null, caller: 'adminVault', result: 'ok' });
    return res.json({ ok: true, entriesLoaded: result.entries });
  } catch (err) {
    const isAuth    = err && (err.name === 'VaultAuthError' || err.name === 'VaultIntegrityError');
    const isMissing = err && err.code === 'VAULT_FILE_NOT_FOUND';
    safeAudit({
      op:     'unlock',
      key:    null,
      caller: 'adminVault',
      result: isAuth ? 'bad_password' : (isMissing ? 'not_found' : 'io_error'),
    });
    if (isMissing) {
      return res.status(404).json({ error: 'vault_file_not_found' });
    }
    if (isAuth) {
      return res.status(401).json({
        error:   'unauthorized',
        message: 'vault: open failed (bad password or tampered file)',
      });
    }
    return res.status(500).json({ error: 'io_error', message: 'unlock failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/vault/rotate
// ---------------------------------------------------------------------------
router.post('/rotate', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'currentPassword and newPassword required' });
  }
  if (newPassword.length < 12) {
    return res.status(400).json({ error: 'weak_password', message: 'new password must be at least 12 chars' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'same_password', message: 'new password must differ from current' });
  }
  if (!isVaultUnlockedThisProcess()) {
    safeAudit({ op: 'rotate', key: null, caller: 'adminVault', result: 'locked' });
    return res.status(423).json({ error: 'vault_locked', message: 'Unlock the vault before rotating.' });
  }
  if (rotateInProgress) {
    return res.status(409).json({ error: 'rotate_in_progress' });
  }
  rotateInProgress = true;
  const vaultPath = resolveVaultPath();
  try {
    let vault;
    try {
      vault = await vaultLib.openVault(vaultPath, currentPassword);
    } catch (err) {
      const isAuth = err && (err.name === 'VaultAuthError' || err.name === 'VaultIntegrityError');
      safeAudit({
        op:     'rotate',
        key:    null,
        caller: 'adminVault',
        result: isAuth ? 'bad_password' : 'io_error',
      });
      if (isAuth) {
        return res.status(401).json({
          error:   'unauthorized',
          message: 'vault: open failed (bad password or tampered file)',
        });
      }
      return res.status(500).json({ error: 'io_error', message: 'rotate failed' });
    }
    try {
      await vault.rotate(newPassword);
      await vault.save();
    } finally {
      try { vault.close(); } catch (_) { /* idempotent close */ }
    }
    safeAudit({ op: 'rotate', key: null, caller: 'adminVault', result: 'ok' });
    return res.json({
      ok:      true,
      message: 'Vault password rotated. Update VAULT_PASSWORD before next BFF restart.',
    });
  } catch (_err) {
    safeAudit({ op: 'rotate', key: null, caller: 'adminVault', result: 'io_error' });
    return res.status(500).json({ error: 'io_error', message: 'rotate failed' });
  } finally {
    rotateInProgress = false;
  }
});

module.exports = router;
