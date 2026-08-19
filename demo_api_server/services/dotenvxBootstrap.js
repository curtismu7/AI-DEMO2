'use strict';

/**
 * dotenvx bootstrap — decrypts a dotenvx-encrypted `.env` into process.env
 * BEFORE anything else loads.
 *
 * MUST be the first require in server.js — BEFORE `require('newrelic')`.
 * 2026-08-18 incident: the operator runbook encrypted demo_api_server/.env but
 * the BFF had no decrypt path. On restart every consumer read raw ciphertext:
 * login used a client secret of literally `encrypted:...`, ConfigStore's
 * CONFIG_ENCRYPTION_KEY was ciphertext, and the New Relic agent — which derives
 * its collector hostname FROM NR_LICENSE_KEY at require time — tried to resolve
 * `collector.encrypted:....nr-data.net`. That last failure is why load ORDER
 * matters: decryption must have already happened when `require('newrelic')`
 * executes, so this bootstrap is the only thing allowed above it.
 *
 * Behavior:
 *  - PLAINTEXT `.env` (today): pass-through. Values are applied with the same
 *    precedence the two `require('dotenv').config()` calls in server.js already
 *    give (pre-set env > root `.env` > demo_api_server/.env), and those calls
 *    then no-op for anything set here. No logs, no new failure modes.
 *  - ENCRYPTED `.env` (post-cutover): values decrypt via DOTENV_PRIVATE_KEY
 *    (delivered by compose `env_file:` / run.sh — the same channel as
 *    VAULT_PASSWORD). A pre-set env value that is itself ciphertext is REPLACED
 *    by the decrypted value: Docker `env_file:` injects the RAW encrypted file
 *    verbatim at container creation and in-process decryption never propagates
 *    back to the container env, so container-level ciphertext is expected and
 *    must lose to the decrypted value. Every other pre-set env value still
 *    wins, exactly as before.
 *  - DOTENV_PRIVATE_KEY is deleted from process.env after use (hygiene —
 *    matches the agent/gateway/oauth-mcp loaders' leak-window shrink).
 *  - Never throws: on any failure it logs one line and leaves env as-is — the
 *    vault load path (deliberately kept intact in this PR; plan Task 8 retires
 *    it) remains the belt-and-braces fallback.
 */

const fs = require('fs');
const path = require('path');

// Same two files, same order, as server.js's existing dotenv loads: root `.env`
// first (wins for overlapping names — documented local-dev precedence), then
// the BFF's own `.env`. Anchored on __dirname, not cwd, so Docker and native
// resolve identically.
const ROOT_ENV_PATH = path.resolve(__dirname, '..', '..', '.env');
const SERVICE_ENV_PATH = path.resolve(__dirname, '..', '.env');

const ENCRYPTED_PREFIX = 'encrypted:';

/**
 * Load (and, when DOTENV_PRIVATE_KEY is present, decrypt) the env files into
 * `env`. Options exist for tests only — production call sites pass nothing.
 */
function bootstrapDotenvx({
  envPaths = [ROOT_ENV_PATH, SERVICE_ENV_PATH],
  env = process.env,
  logger = console,
} = {}) {
  let dotenvx;
  try {
    // Required lazily so a stale node_modules (this dep was added 2026-08-18)
    // degrades to today's plaintext behavior instead of taking the BFF down.
    dotenvx = require('@dotenvx/dotenvx');
  } catch (_err) {
    if (env.DOTENV_PRIVATE_KEY) {
      logger.error('[dotenvx] bootstrap: @dotenvx/dotenvx is not installed but '
        + 'DOTENV_PRIVATE_KEY is set — encrypted .env values CANNOT be decrypted. '
        + 'Run `npm install` in demo_api_server.');
    }
    return { loaded: false, applied: 0, decrypted: 0, reason: 'module_unavailable' };
  }

  const privateKey = env.DOTENV_PRIVATE_KEY;
  let applied = 0;
  let decrypted = 0;

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;

    // Parse into a PRIVATE object — dotenvx never writes the real process.env.
    // The object is seeded with the decrypt key because dotenvx resolves
    // DOTENV_PRIVATE_KEY from the `processEnv` it is handed, not the real one.
    const parsed = privateKey ? { DOTENV_PRIVATE_KEY: privateKey } : {};
    let result;
    try {
      result = dotenvx.config({
        path: envPath,
        processEnv: parsed,
        quiet: true,
        ignore: ['MISSING_ENV_FILE'],
      });
    } catch (err) {
      logger.error(`[dotenvx] bootstrap: ${envPath}: ${err.message} — continuing with existing env`);
      continue;
    }
    if (result && result.error) {
      // Post-cutover this is the incident signature (key missing or wrong) —
      // say so clearly, but keep booting: the vault path may still supply
      // secrets, and a plaintext rollback must never be blocked here.
      logger.error(`[dotenvx] bootstrap: ${envPath}: ${result.error.message} — continuing with existing env`);
    }

    // Seed artifact (or a misplaced entry in the file) — never copy the
    // decrypt key forward.
    delete parsed.DOTENV_PRIVATE_KEY;

    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') continue;
      const current = env[name];
      if (current === undefined) {
        env[name] = value;
        applied += 1;
      } else if (current.startsWith(ENCRYPTED_PREFIX) && !value.startsWith(ENCRYPTED_PREFIX)) {
        env[name] = value;
        applied += 1;
        decrypted += 1;
      }
    }
  }

  // Anything still ciphertext at this point is an incident, not a detail: the
  // key was available, so a leftover `encrypted:` value means the .env was
  // missing or mid-rewrite when we read it. Consumers then use the literal
  // string — end-user login sends it as the client secret and PingOne answers
  // `invalid_client`, so NOBODY can sign in. Seen live 2026-08-19: the BFF came
  // up at 10:13:21 having decrypted 0 values, every login failed for 3.5
  // minutes, and the only log line was the cheerful success message below.
  // Names only — never values.
  const stillEncrypted = privateKey
    ? Object.keys(env).filter((n) => typeof env[n] === 'string' && env[n].startsWith(ENCRYPTED_PREFIX)).sort()
    : [];

  if (privateKey) {
    delete env.DOTENV_PRIVATE_KEY;
    logger.log(`[dotenvx] bootstrap: decrypted .env applied — ${applied} value(s) set, `
      + `${decrypted} replaced container-level ciphertext; DOTENV_PRIVATE_KEY cleared from env`);
    if (stillEncrypted.length) {
      logger.error('[dotenvx] bootstrap: ⚠️ DOTENV_PRIVATE_KEY was present but '
        + `${stillEncrypted.length} value(s) are STILL ciphertext: ${stillEncrypted.join(', ')}. `
        + 'Consumers will read the literal "encrypted:..." string — end-user login will fail '
        + 'with invalid_client. Usual cause: the .env file was absent or mid-rewrite at start. '
        + 'Restart this service once the file is settled.');
    }
  }

  return { loaded: true, applied, decrypted };
}

module.exports = { bootstrapDotenvx, ROOT_ENV_PATH, SERVICE_ENV_PATH };
