'use strict';

/**
 * Custom error classes for the portable encrypted credential vault (Phase 269).
 *
 * Each class extends Error and sets `this.name` so callers can use
 * `instanceof` OR `err.name === 'VaultIntegrityError'` style checks.
 *
 * Error message hygiene: VaultAuthError messages MUST NOT reveal whether the
 * failure was a wrong password vs a tampered file vs a corrupted entry. Same
 * message for all of those cases (no oracle).
 */

class VaultIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultIntegrityError';
  }
}

class VaultAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultAuthError';
  }
}

class VaultNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultNotFoundError';
  }
}

class VaultEntryNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultEntryNotFoundError';
  }
}

class VaultPasswordRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultPasswordRequiredError';
  }
}

module.exports = {
  VaultIntegrityError,
  VaultAuthError,
  VaultNotFoundError,
  VaultEntryNotFoundError,
  VaultPasswordRequiredError,
};
