'use strict';

/**
 * Public entry point for the portable encrypted credential vault (Phase 269).
 *
 * Exports:
 *   openVault(filePath, password)   → handle (read/set/delete/list/rotate/save/close)
 *   createVault(filePath, password) → handle for a brand-new vault (throws if exists)
 *
 * Plus the 5 error classes from ./errors.
 *
 * Design summary (see 269-RESEARCH.md "Pattern 1: KEK/DEK envelope"):
 *   - master KEK = Argon2id(password, salt) — derived once at open, lives only
 *     as long as the handle
 *   - per-entry DEK (32 random bytes) seals the entry value with AES-256-GCM
 *   - each DEK is wrapped under the KEK with AES-256-GCM
 *   - whole-file HMAC-SHA256 (HKDF sub-key off the KEK) catches structural
 *     tampering between entries
 *   - close() zeroes the KEK + every DEK Buffer so a later memory dump can't
 *     reveal them
 *   - atomic save: write to filePath + '.tmp', then rename
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const {
  deriveKek,
  aeadSeal,
  aeadOpen,
  hkdfFileHmacKey,
} = require('./crypto');
const {
  MAGIC,
  VERSION,
  parseEnvelope,
  computeFileHmac,
  verifyFileHmac,
  canonicalJson,
} = require('./format');
const { recordAudit } = require('./audit');
const {
  VaultIntegrityError,
  VaultAuthError,
  VaultNotFoundError,
  VaultEntryNotFoundError,
  VaultPasswordRequiredError,
} = require('./errors');

// Entry name format — uppercase letter/underscore start, then [A-Z0-9_].
// Matches the convention used by env-var-shaped keys (HELIX_API_KEY, ...).
const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const VALUE_MAX_BYTES = 64 * 1024;
const GENERIC_OPEN_ERROR = 'vault: open failed (bad password or tampered file)';

const auditPath = (vaultPath) => vaultPath + '.audit.log';

async function createVault(filePath, password) {
  if (!password) throw new VaultPasswordRequiredError('vault: password required');
  if (fs.existsSync(filePath)) {
    throw new Error('vault: file already exists: ' + filePath);
  }
  const salt = crypto.randomBytes(16);
  const kek = Buffer.from(await deriveKek(password, salt));
  const envelope = {
    magic: MAGIC,
    version: VERSION,
    kdf: {
      alg: 'argon2id',
      salt: salt.toString('base64'),
      memCost: 65536,
      timeCost: 3,
      parallelism: 4,
      hashLen: 32,
    },
    createdAt: new Date().toISOString(),
    rotatedAt: null,
    entries: {},
  };
  envelope.fileHmac = computeFileHmac(envelope, hkdfFileHmacKey(kek));
  const tmp = filePath + '.tmp';
  await fsp.writeFile(tmp, canonicalJson(envelope), { mode: 0o600 });
  await fsp.rename(tmp, filePath);
  recordAudit(auditPath(filePath), {
    op: 'open',
    key: null,
    caller: 'vault.js',
    result: 'created',
  });
  // Zero the create-time KEK; openVault will derive a fresh one.
  kek.fill(0);
  return openVault(filePath, password);
}

async function openVault(filePath, password) {
  if (!password) throw new VaultPasswordRequiredError('vault: password required');
  if (!fs.existsSync(filePath)) {
    recordAudit(auditPath(filePath), {
      op: 'open',
      key: null,
      caller: 'vault.js',
      result: 'not_found',
    });
    throw new VaultNotFoundError('vault: file not found at ' + filePath);
  }
  const buf = await fsp.readFile(filePath);
  let envelope;
  try {
    envelope = parseEnvelope(buf);
  } catch (err) {
    recordAudit(auditPath(filePath), {
      op: 'open',
      key: null,
      caller: 'vault.js',
      result: 'integrity_failed',
    });
    throw err;
  }
  const salt = Buffer.from(envelope.kdf.salt, 'base64');
  const kek = Buffer.from(await deriveKek(password, salt));

  if (!verifyFileHmac(envelope, hkdfFileHmacKey(kek))) {
    kek.fill(0);
    recordAudit(auditPath(filePath), {
      op: 'open',
      key: null,
      caller: 'vault.js',
      result: 'bad_password',
    });
    throw new VaultAuthError(GENERIC_OPEN_ERROR);
  }

  // Eagerly unwrap all DEKs so wrong-key errors fire here, not later in read().
  const entries = new Map();
  try {
    for (const [name, rec] of Object.entries(envelope.entries)) {
      const w = Buffer.from(rec.wrappedDek, 'base64');
      const dek = Buffer.from(
        aeadOpen(
          {
            iv: w.subarray(0, 12),
            tag: w.subarray(12, 28),
            ct: w.subarray(28),
          },
          kek,
        ),
      );
      entries.set(name, {
        dek,
        valueIv: Buffer.from(rec.valueIv, 'base64'),
        valueTag: Buffer.from(rec.valueTag, 'base64'),
        valueCt: Buffer.from(rec.value, 'base64'),
        updatedAt: rec.updatedAt,
        ...(rec.note ? { note: rec.note } : {}),
        wrappedDek: w,
      });
    }
  } catch (err) {
    // If any DEK unwrap fails, treat the whole vault as compromised.
    kek.fill(0);
    for (const [, e] of entries) e.dek && e.dek.fill(0);
    recordAudit(auditPath(filePath), {
      op: 'open',
      key: null,
      caller: 'vault.js',
      result: 'integrity_failed',
    });
    throw new VaultIntegrityError(GENERIC_OPEN_ERROR);
  }

  recordAudit(auditPath(filePath), {
    op: 'open',
    key: null,
    caller: 'vault.js',
    result: 'ok',
  });

  let closed = false;
  const ensureOpen = () => {
    if (closed) throw new Error('vault: handle is closed');
  };

  return {
    read(name) {
      ensureOpen();
      const e = entries.get(name);
      if (!e) {
        recordAudit(auditPath(filePath), {
          op: 'read',
          key: name,
          caller: 'vault.js',
          result: 'not_found',
        });
        throw new VaultEntryNotFoundError('vault: entry not found: ' + name);
      }
      const pt = aeadOpen(
        { iv: e.valueIv, tag: e.valueTag, ct: e.valueCt },
        e.dek,
      );
      recordAudit(auditPath(filePath), {
        op: 'read',
        key: name,
        caller: 'vault.js',
        result: 'ok',
      });
      return pt.toString('utf8');
    },

    set(name, value) {
      ensureOpen();
      if (!NAME_RE.test(name)) {
        throw new Error('vault: name must match [A-Z_][A-Z0-9_]*');
      }
      if (Buffer.byteLength(value, 'utf8') > VALUE_MAX_BYTES) {
        throw new Error('vault: value too large (64 KiB max)');
      }
      const dek = crypto.randomBytes(32);
      const sealed = aeadSeal(Buffer.from(value, 'utf8'), dek);
      const wrapped = aeadSeal(dek, kek);
      // Zero any previous DEK for this entry before replacing.
      const prev = entries.get(name);
      if (prev && prev.dek) prev.dek.fill(0);
      entries.set(name, {
        dek,
        valueIv: sealed.iv,
        valueTag: sealed.tag,
        valueCt: sealed.ct,
        updatedAt: new Date().toISOString(),
        wrappedDek: Buffer.concat([wrapped.iv, wrapped.tag, wrapped.ct]),
      });
      recordAudit(auditPath(filePath), {
        op: 'set',
        key: name,
        caller: 'vault.js',
        result: 'ok',
      });
    },

    delete(name) {
      ensureOpen();
      const had = entries.has(name);
      if (had) {
        const e = entries.get(name);
        if (e && e.dek) e.dek.fill(0);
        entries.delete(name);
      }
      recordAudit(auditPath(filePath), {
        op: 'delete',
        key: name,
        caller: 'vault.js',
        result: had ? 'ok' : 'not_found',
      });
      return had;
    },

    list() {
      ensureOpen();
      return Array.from(entries.keys());
    },

    async rotate(newPassword) {
      ensureOpen();
      if (!newPassword) {
        throw new VaultPasswordRequiredError('vault: new password required');
      }
      const newSalt = crypto.randomBytes(16);
      const newKek = Buffer.from(await deriveKek(newPassword, newSalt));
      // Re-wrap each entry's DEK with newKek — value ciphertexts UNCHANGED.
      for (const [, e] of entries) {
        const w = aeadSeal(e.dek, newKek);
        e.wrappedDek = Buffer.concat([w.iv, w.tag, w.ct]);
      }
      envelope.kdf.salt = newSalt.toString('base64');
      envelope.rotatedAt = new Date().toISOString();
      // Overwrite the closure's kek bytes in place so subsequent save() / set()
      // use the rotated key (the closure keeps the same Buffer reference).
      kek.fill(0);
      newKek.copy(kek);
      newKek.fill(0);
      recordAudit(auditPath(filePath), {
        op: 'rotate',
        key: null,
        caller: 'vault.js',
        result: 'ok',
      });
    },

    async save() {
      ensureOpen();
      // Rebuild on-disk entries map; values' ciphertexts are unchanged unless
      // a set/delete touched them.
      const outEntries = {};
      for (const [name, e] of entries) {
        outEntries[name] = {
          wrappedDek: e.wrappedDek.toString('base64'),
          valueIv: e.valueIv.toString('base64'),
          valueTag: e.valueTag.toString('base64'),
          value: e.valueCt.toString('base64'),
          updatedAt: e.updatedAt,
          ...(e.note ? { note: e.note } : {}),
        };
      }
      envelope.entries = outEntries;
      envelope.fileHmac = computeFileHmac(envelope, hkdfFileHmacKey(kek));
      const tmp = filePath + '.tmp';
      await fsp.writeFile(tmp, canonicalJson(envelope), { mode: 0o600 });
      await fsp.rename(tmp, filePath);
      recordAudit(auditPath(filePath), {
        op: 'save',
        key: null,
        caller: 'vault.js',
        result: 'ok',
      });
    },

    close() {
      if (closed) return;
      closed = true;
      kek.fill(0);
      for (const [, e] of entries) {
        if (e && e.dek) e.dek.fill(0);
      }
      entries.clear();
      recordAudit(auditPath(filePath), {
        op: 'close',
        key: null,
        caller: 'vault.js',
        result: 'ok',
      });
    },

    // Test hook — gated; do not document publicly.
    _kekZeroedForTesting() {
      if (process.env.VAULT_TEST_HOOK !== 'true') return undefined;
      return kek.every((b) => b === 0);
    },
  };
}

module.exports = {
  openVault,
  createVault,
  VaultIntegrityError,
  VaultAuthError,
  VaultNotFoundError,
  VaultEntryNotFoundError,
  VaultPasswordRequiredError,
};
