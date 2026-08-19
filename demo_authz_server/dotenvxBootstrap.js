'use strict';

/**
 * dotenvx bootstrap — decrypts dotenvx-encrypted values ALREADY IN process.env
 * before anything else reads them. MUST be the first require in index.js.
 *
 * Shaped differently from demo_api_server/services/dotenvxBootstrap.js on
 * purpose: that one re-reads `.env` FILES from disk and decrypts into a fresh
 * object (server.js has demo_api_server/.env available in its own container).
 * This container has no `.env` file at all — Dockerfile does not COPY one
 * (gitignored, excluded from the build context) — every secret this service
 * needs, including PINGONE_WORKER_CLIENT_ID/SECRET (Rule 0a2's PingOne user
 * lookup, docker-compose.yml's own comment on authz-server's env_file list),
 * arrives via Docker Compose's `env_file:` mechanism: the encrypted `.env`
 * files of demo_mcp_gateway / demo_authz_server / demo_api_server are read by
 * DOCKER ITSELF and their key=value pairs injected directly into the
 * container's process.env at creation, ciphertext included, before Node ever
 * starts. There is nothing to re-parse from disk — only ciphertext already
 * sitting in `process.env` to decrypt in place.
 *
 * 2026-08-19 finding: this container had no decrypt path at all, so every
 * `encrypted:...` value handed to it stayed exactly that. Concretely,
 * PINGONE_WORKER_CLIENT_SECRET arrived as ciphertext and Rule 0a2's PingOne
 * user lookup sent it as a client_credentials secret, failing with
 * invalid_client — masked downstream as `user_lookup_failed: unable to verify
 * user status`, so every decision requiring a real user (which is most of
 * them) failed closed for a reason that named the wrong culprit. Same root
 * cause and same masking shape as the CLI-scripts incident
 * (demo_api_server/scripts/loadDemoEnv.js) and the original BFF incident
 * (services/dotenvxBootstrap.js) — a third service, independently missed by
 * both prior passes because this one has no `.env` file for a file-based
 * bootstrap to find.
 *
 * Behavior:
 *  - No DOTENV_PRIVATE_KEY delivered: no-op. (Requires wiring `.env.keys`
 *    into this service's `env_file:` list in docker-compose.yml — done
 *    alongside this file, since the key was never delivered here either.)
 *  - DOTENV_PRIVATE_KEY present: every process.env value that still starts
 *    with `encrypted:` is decrypted in place via the same ECIES primitive
 *    dotenvx's CLI uses (`@dotenvx/primitives`'s `decrypt`), one value at a
 *    time — no temp file, no re-parse of a `.env` this container does not
 *    have. A value that fails to decrypt (wrong/missing key, malformed data)
 *    is logged and left as ciphertext; this never throws or crashes the boot.
 *  - DOTENV_PRIVATE_KEY is deleted from env after use.
 */

const ENCRYPTED_PREFIX = 'encrypted:';

function bootstrapDotenvx({ env = process.env, logger = console } = {}) {
  const privateKey = env.DOTENV_PRIVATE_KEY;
  if (!privateKey) {
    return { applied: 0, reason: 'no_private_key' };
  }

  let decrypt;
  try {
    // Required lazily so a stale node_modules degrades to today's ciphertext
    // behavior (loud per-value failures below) instead of crash-looping boot.
    ({ decrypt } = require('@dotenvx/primitives'));
  } catch (_err) {
    logger.error('[dotenvx] bootstrap: @dotenvx/primitives is not installed but '
      + 'DOTENV_PRIVATE_KEY is set — encrypted env values CANNOT be decrypted. '
      + 'Run `npm install` in demo_authz_server.');
    return { applied: 0, reason: 'module_unavailable' };
  }

  let applied = 0;
  for (const name of Object.keys(env)) {
    const value = env[name];
    if (typeof value !== 'string' || !value.startsWith(ENCRYPTED_PREFIX)) continue;
    try {
      env[name] = decrypt(privateKey, value);
      applied += 1;
    } catch (err) {
      logger.error(`[dotenvx] bootstrap: could not decrypt ${name}: ${err.message} — leaving as ciphertext`);
    }
  }

  delete env.DOTENV_PRIVATE_KEY;
  if (applied > 0) {
    logger.log(`[dotenvx] bootstrap: decrypted ${applied} container-level ciphertext value(s); `
      + 'DOTENV_PRIVATE_KEY cleared from env');
  }
  return { applied };
}

module.exports = { bootstrapDotenvx };
