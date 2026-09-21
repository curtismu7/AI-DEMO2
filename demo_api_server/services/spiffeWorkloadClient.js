'use strict';

/**
 * File-backed adapter for spiffe-helper output. spiffe-helper owns Workload
 * API access and rotation; the BFF reads current material only when signing.
 */
const fs = require('node:fs');
const configStore = require('./configStore');
const cache = new Map();

function configuredPath(key) {
  const value = String(configStore.getEffective(key) || '').trim();
  if (!value) throw new Error(`SPIFFE ${key} is not configured`);
  return value;
}

function readCached(kind, key) {
  const file = configuredPath(key);
  let stat;
  try { stat = fs.statSync(file); } catch (err) {
    throw new Error(`SPIFFE ${kind} is not readable at ${file}: ${err.message}`);
  }
  const prior = cache.get(kind);
  if (prior && prior.file === file && prior.mtimeMs === stat.mtimeMs && prior.size === stat.size) return prior.value;
  let value;
  try { value = fs.readFileSync(file, 'utf8').trim(); } catch (err) {
    throw new Error(`SPIFFE ${kind} is not readable at ${file}: ${err.message}`);
  }
  if (!value) throw new Error(`SPIFFE ${kind} is empty at ${file}`);
  cache.set(kind, { file, mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

function getJwtSvid() { return readCached('JWT-SVID', 'spiffe_svid_path'); }
function getSigningKeyPem() { return readCached('signing key', 'spiffe_key_path'); }
function getBundlePem() { return readCached('trust bundle', 'spiffe_bundle_path'); }

function getKid() {
  const header = getJwtSvid().split('.')[0];
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    return typeof decoded.kid === 'string' && decoded.kid ? decoded.kid : undefined;
  } catch (_err) {
    throw new Error('SPIFFE JWT-SVID has an invalid JOSE header');
  }
}

function resetForTests() { cache.clear(); }

module.exports = { getJwtSvid, getSigningKeyPem, getBundlePem, getKid, resetForTests, invalidateForTests: resetForTests };
