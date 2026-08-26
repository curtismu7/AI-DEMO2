'use strict';

/**
 * Proves the intent-token HMAC key is the SAME on all three sides.
 *
 * The BFF signs (`intentTokenService`) and both gateways verify
 * (`demo_mcp_gateway/src/intentTokenValidator.ts`,
 * `ping-gateway/scripts/groovy/p1az-decision.groovy`). All three resolve
 * `INTENT_TOKEN_SECRET || SESSION_SECRET` independently, and for weeks no two of
 * them landed on the same value (TECH_DEBT 2026-08-26):
 *
 *   Node gateway  no key at all       -> IntentTokenError "no_signing_key"  (visible)
 *   PingGateway   a DIFFERENT key     -> invalid_signature                  (SILENT)
 *
 * and the BFF was signing with `SESSION_SECRET`, which in `.env` was configStore's
 * own at-rest CIPHERTEXT (`encrypted:...`) — a perfectly usable HMAC key that no
 * correctly-configured verifier could ever match.
 *
 * None of that surfaced anywhere: the PDP records IntentTokenValid=false and
 * PERMITs regardless, so ~190 lines of HMAC checking ran as dead code while every
 * demo appeared to work. That is the failure mode this check exists to make loud.
 *
 * Offline and side-effect free: reads the gateways' env files through the /repo
 * mount and compares SHA-256 digests. Key material is never logged, only digest
 * prefixes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { register } = require('./registry');

/** Short digest — enough to compare, useless to an attacker. */
const digest = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 12);

/** `KEY=value` out of an env file, or null when the file or key is absent. */
function readEnvValue(file, key) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { readable: false, value: null };
  }
  const line = text.split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) return { readable: true, value: null };
  return { readable: true, value: line.slice(key.length + 1).trim() };
}

/** Same resolution order the BFF signs with (intentTokenService.getSigningKey). */
function bffEffectiveKey() {
  const dedicated = process.env.INTENT_TOKEN_SECRET;
  if (dedicated) return { value: dedicated, source: 'INTENT_TOKEN_SECRET' };
  if (process.env.SESSION_SECRET) return { value: process.env.SESSION_SECRET, source: 'SESSION_SECRET (fallback)' };
  return { value: null, source: null };
}

// Resolved through /repo (the main checkout, bind-mounted into the BFF) so this
// works in the container; falls back to a relative path outside Docker.
const REPO = fs.existsSync('/repo') ? '/repo' : path.join(__dirname, '..', '..', '..');
const PEERS = [
  { name: 'Node gateway (mcp-gateway)', file: path.join(REPO, 'demo_mcp_gateway', '.env') },
  { name: 'PingGateway (ping-gateway)', file: path.join(REPO, 'ping-gateway', '.env') },
];

const parity = {
  id: 'intent.key_parity',
  name: 'Intent-token signing key matches both gateways',
  category: 'Agent Gateway',
  severity: 'blocking',
  async run() {
    const bff = bffEffectiveKey();
    if (!bff.value) {
      return {
        status: 'fail',
        detail: 'BFF has no intent-token signing key (neither INTENT_TOKEN_SECRET nor SESSION_SECRET is set)',
        nextAction: 'Set INTENT_TOKEN_SECRET in demo_api_server/.env, then run demo_api_server/scripts/refresh-service-envs.js.',
      };
    }

    // The trap that started this: configStore's at-rest ciphertext used verbatim
    // as an HMAC key. Signing succeeds, so only the verifiers ever notice.
    if (bff.value.startsWith('encrypted:')) {
      return {
        status: 'fail',
        detail: `BFF signing key is configStore ciphertext ("encrypted:..."), via ${bff.source}`,
        nextAction: 'Set a PLAINTEXT INTENT_TOKEN_SECRET in demo_api_server/.env and re-run refresh-service-envs.js. ' +
          'A ciphertext key signs valid tokens that no gateway can ever verify.',
      };
    }

    const bffDigest = digest(bff.value);
    const mismatched = [];
    const unreadable = [];
    for (const peer of PEERS) {
      const { readable, value } = readEnvValue(peer.file, 'INTENT_TOKEN_SECRET');
      if (!readable) { unreadable.push(peer.name); continue; }
      if (!value) { mismatched.push(`${peer.name}: no INTENT_TOKEN_SECRET (verifier is dead — "no_signing_key")`); continue; }
      if (digest(value) !== bffDigest) {
        mismatched.push(`${peer.name}: key digest ${digest(value)} != BFF ${bffDigest} (silent invalid_signature)`);
      }
    }

    if (mismatched.length) {
      return {
        status: 'fail',
        detail: mismatched.join(' · '),
        nextAction: 'Run demo_api_server/scripts/refresh-service-envs.js to re-propagate the BFF key, then restart the ' +
          'affected gateway. A mismatch here is invisible at runtime: the PDP records IntentTokenValid=false and PERMITs anyway.',
        meta: { bffKeyDigest: bffDigest, bffKeySource: bff.source },
      };
    }

    // Not a failure — the fallback works — but it hands a gateway the key that
    // signs browser sessions, which is why a dedicated key was provisioned.
    if (bff.source !== 'INTENT_TOKEN_SECRET') {
      return {
        status: 'warn',
        detail: `keys match (${bffDigest}) but the BFF is falling back to SESSION_SECRET`,
        nextAction: 'Set a dedicated INTENT_TOKEN_SECRET: a gateway should not hold the key that signs browser sessions.',
        meta: { bffKeyDigest: bffDigest, bffKeySource: bff.source },
      };
    }

    // Vacuity guard. With no peer env file readable this compared NOTHING, and
    // reporting `pass` would be the same shape of lie the check exists to catch:
    // a green posture line that proves no property at all. (Hit immediately —
    // run outside the container, /repo is absent and the relative fallback finds
    // no gateway env files.)
    if (unreadable.length === PEERS.length) {
      return {
        status: 'warn',
        detail: `could not read either gateway env file — nothing was compared (BFF digest ${bffDigest})`,
        nextAction: 'Run this from the BFF container, where /repo is mounted. A pass here would prove nothing.',
        meta: { bffKeyDigest: bffDigest, bffKeySource: bff.source, unreadable },
      };
    }

    const note = unreadable.length ? ` (not checked: ${unreadable.join(', ')})` : '';
    const checked = PEERS.length - unreadable.length;
    return {
      status: 'pass',
      detail: `dedicated INTENT_TOKEN_SECRET, digest ${bffDigest}, matches ${checked}/${PEERS.length} gateways${note}`,
      meta: { bffKeyDigest: bffDigest, bffKeySource: bff.source, unreadable },
    };
  },
};

register(parity);
module.exports = { parity };
