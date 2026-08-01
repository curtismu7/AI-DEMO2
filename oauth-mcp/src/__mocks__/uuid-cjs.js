'use strict';
// CJS shim for uuid — used only in Jest (CJS mode) because uuid v9+ is ESM-only.
// Generates spec-compliant RFC 4122 v4 UUIDs via Node crypto.
const crypto = require('crypto');

function v4() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

module.exports = { v4 };
