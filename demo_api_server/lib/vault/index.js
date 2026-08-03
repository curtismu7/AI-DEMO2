'use strict';

/**
 * Public entry point for the portable encrypted credential vault (Phase 269).
 *
 * Exports:
 *   openVault(filePath, password, opts?)   → handle (read/set/delete/list/rotate/save/close)
 *   createVault(filePath, password, opts?) → handle for a brand-new vault (throws if exists)
 *
 * opts: { caller?: string } — audit attribution for every line this handle
 * writes. Defaults to 'vault.js'.
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
 *   - atomic save: write to a per-writer tmp file (O_EXCL, 0600), fsync it and
 *     its directory, then rename; a generation check refuses to overwrite a
 *     file that changed underneath the handle
 *   - anti-rollback: a monotonic `seq` in the envelope, witnessed in the
 *     append-only audit log; opening a vault whose seq is below one already
 *     recorded is refused (the HMAC proves contents, never freshness)
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
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
const { recordAudit, assertAuditWritable, highestRecordedSeq } = require('./audit');
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

/**
 * Where the audit trail is written. Defaults to a sibling of the vault, which is
 * right for a checkout but wrong in a container: compose mounts the vault at
 * `/secrets.vault:ro`, so the sibling path lands in container root — owned by
 * root, mode 0755, and the BFF runs as appuser. `assertAuditWritable()` then
 * throws EACCES at open and the whole BFF refuses to start.
 *
 * VAULT_AUDIT_LOG_PATH points the trail at a writable volume instead. It moves
 * WHERE the log lives, never WHETHER it is enforced: an unwritable path still
 * fails closed exactly as before.
 */
const auditPath = (vaultPath) => process.env.VAULT_AUDIT_LOG_PATH || vaultPath + '.audit.log';

/** Default audit attribution when a caller does not name itself. */
const DEFAULT_CALLER = 'vault.js';

/**
 * Who to attribute this handle's audit lines to.
 *
 * Every line used to say 'vault.js' regardless of origin, so a web-triggered
 * unlock and a CLI unlock were indistinguishable in the trail — docs/vault.md
 * claimed the `caller` field gave "forensic clarity" it could not give. Callers
 * now name themselves; the default preserves the old value for anything that
 * does not.
 */
function resolveCaller(opts) {
  const c = opts && opts.caller;
  return typeof c === 'string' && c.length > 0 ? c : DEFAULT_CALLER;
}

/** Envelope `seq` as a number, treating a pre-counter vault as 0. */
function envelopeSeq(envelope) {
  return Number.isSafeInteger(envelope && envelope.seq) ? envelope.seq : 0;
}

/**
 * Write `data` to `filePath` atomically and durably.
 *
 * The tmp path is per-writer, not `filePath + '.tmp'`: a shared tmp name let two
 * concurrent savers interleave their JSON into one file, and the survivor's
 * rename published the splice — an unreadable vault with no backup. `wx` also
 * refuses to open an existing path, so a symlink pre-planted at the tmp name
 * can no longer redirect the envelope (and `mode` is honoured, which it is not
 * when writeFile lands on an existing file).
 *
 * fsync on the file and its directory is what makes the rename survive a crash;
 * without it the rename can be visible while the data is not.
 */
async function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fh;
  try {
    fh = await fsp.open(tmp, 'wx', 0o600);
    await fh.writeFile(data);
    await fh.sync();
    await fh.close();
    fh = null;
    await fsp.rename(tmp, filePath);
  } catch (err) {
    if (fh) await fh.close().catch(() => {});
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  // Directory fsync persists the rename itself. Best-effort: not every platform
  // permits opening a directory, and a failure here must not fail the save.
  try {
    const dirFh = await fsp.open(dir, 'r');
    await dirFh.sync().catch(() => {});
    await dirFh.close();
  } catch {
    /* platform does not support directory fsync */
  }
}

/** Identity of the on-disk file a handle was opened from, for lost-update detection. */
async function fileGeneration(filePath) {
  const st = await fsp.stat(filePath);
  return `${st.mtimeMs}:${st.size}:${st.ino}`;
}

async function createVault(filePath, password, opts = {}) {
  const caller = resolveCaller(opts);
  if (!password) throw new VaultPasswordRequiredError('vault: password required');
  if (fs.existsSync(filePath)) {
    throw new Error('vault: file already exists: ' + filePath);
  }
  // Fail closed: a vault whose audit log cannot be written would let a local
  // attacker mutate secrets leaving no trace. Checked AFTER the existence and
  // password guards so it cannot mask their more specific errors.
  assertAuditWritable(auditPath(filePath));
  const salt = crypto.randomBytes(16);
  // deriveKek already returns a fresh Buffer this scope owns. Wrapping it in
  // Buffer.from() made a second copy and orphaned the first, so kek.fill(0)
  // below zeroed one KEK and left an identical one on the heap.
  const kek = await deriveKek(password, salt);
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
    // Rollback counter — monotonic, incremented by every save(). See the
    // rollback check in openVault and highestRecordedSeq in ./audit.
    seq: 1,
    entries: {},
  };
  envelope.fileHmac = computeFileHmac(envelope, hkdfFileHmacKey(kek));
  await writeFileAtomic(filePath, canonicalJson(envelope));
  recordAudit(auditPath(filePath), {
    op: 'open',
    key: null,
    caller,
    result: 'created',
    seq: envelope.seq,
  });
  // Zero the create-time KEK; openVault will derive a fresh one.
  kek.fill(0);
  return openVault(filePath, password, opts);
}

async function openVault(filePath, password, opts = {}) {
  const caller = resolveCaller(opts);
  if (!password) throw new VaultPasswordRequiredError('vault: password required');
  if (!fs.existsSync(filePath)) {
    recordAudit(auditPath(filePath), {
      op: 'open',
      key: null,
      caller,
      result: 'not_found',
    });
    throw new VaultNotFoundError('vault: file not found at ' + filePath);
  }
  // Fail closed: see createVault. Ordered after the not-found guard so a missing
  // vault still reports VaultNotFoundError rather than an audit error.
  assertAuditWritable(auditPath(filePath));
  const buf = await fsp.readFile(filePath);
  // Identity of the bytes this handle was built from; save() refuses to publish
  // over a different generation.
  let generation = await fileGeneration(filePath);
  let envelope;
  try {
    envelope = parseEnvelope(buf);
  } catch (err) {
    recordAudit(auditPath(filePath), {
      op: 'open',
      key: null,
      caller,
      result: 'integrity_failed',
    });
    throw err;
  }
  const salt = Buffer.from(envelope.kdf.salt, 'base64');
  // No Buffer.from() wrapper — see createVault. deriveKek's return value is
  // already this scope's own copy, and it is the one close() zeroes.
  const kek = await deriveKek(password, salt);

  if (!verifyFileHmac(envelope, hkdfFileHmacKey(kek))) {
    kek.fill(0);
    recordAudit(auditPath(filePath), {
      op: 'open',
      key: null,
      caller,
      result: 'bad_password',
    });
    throw new VaultAuthError(GENERIC_OPEN_ERROR);
  }

  // Anti-rollback. The envelope authenticates its own contents but cannot
  // authenticate its own freshness: an attacker who restores yesterday's
  // secrets.vault restores yesterday's valid fileHmac with it, so every check
  // above passes on a file that silently undoes a rotation or resurrects a
  // deleted entry. The append-only audit log is separate state, so a `seq`
  // below one already witnessed there means the file was rewound.
  //
  // Deliberately AFTER the HMAC check: running it earlier would hand an
  // unauthenticated attacker a distinct error to probe, reintroducing exactly
  // the kind of oracle GENERIC_OPEN_ERROR exists to close.
  const witnessedSeq = highestRecordedSeq(auditPath(filePath));
  if (envelopeSeq(envelope) < witnessedSeq) {
    kek.fill(0);
    recordAudit(auditPath(filePath), {
      op: 'open',
      key: null,
      caller,
      result: 'rollback_detected',
      seq: envelopeSeq(envelope),
    });
    throw new VaultIntegrityError(
      'vault: file is older than its recorded audit trail — rollback detected',
    );
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
      caller,
      result: 'integrity_failed',
    });
    throw new VaultIntegrityError(GENERIC_OPEN_ERROR);
  }

  recordAudit(auditPath(filePath), {
    op: 'open',
    key: null,
    caller,
    result: 'ok',
    seq: envelopeSeq(envelope),
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
          caller,
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
        caller,
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
        caller,
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
        caller,
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
      // No Buffer.from() wrapper — see createVault. The extra copy was the one
      // newKek.fill(0) below did NOT reach, leaving the rotated KEK on the heap.
      const newKek = await deriveKek(newPassword, newSalt);
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
        caller,
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
      // Lost-update guard: two handles opened from the same file each hold a
      // full copy of every entry, so the later save() used to silently erase
      // the other's set()s. This narrows that to a loud error — it cannot close
      // the window between this check and the rename, but it catches every
      // interleaving where the other writer finished first.
      const current = await fileGeneration(filePath);
      if (current !== generation) {
        recordAudit(auditPath(filePath), {
          op: 'save',
          key: null,
          caller,
          result: 'stale_generation',
        });
        throw new VaultIntegrityError(
          'vault: file changed on disk since it was opened — reopen and retry',
        );
      }
      // Advance the rollback counter, then seal. Both happen AFTER the
      // generation check so an aborted save neither burns a seq nor publishes
      // an HMAC over a version that never reached disk.
      envelope.seq = envelopeSeq(envelope) + 1;
      envelope.fileHmac = computeFileHmac(envelope, hkdfFileHmacKey(kek));
      await writeFileAtomic(filePath, canonicalJson(envelope));
      generation = await fileGeneration(filePath);
      // Recorded AFTER the rename: the log is the witness that this seq now
      // exists on disk, so an older file restored later is detectable.
      recordAudit(auditPath(filePath), {
        op: 'save',
        key: null,
        caller,
        result: 'ok',
        seq: envelope.seq,
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
        caller,
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
