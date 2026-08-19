'use strict';

/**
 * loadDemoEnv.js — load .env for CLI scripts (matches server.js precedence + worktree fallback).
 *
 * Order (override: false — real process.env wins):
 *   1. DEMO_API_ENV_FILE (explicit path)
 *   2. <repo>/.env
 *   3. demo_api_server/.env
 *   4. ../AI-DEMO2/demo_api_server/.env (main checkout when running from a worktree)
 *   5. ../AI-DEMO2/.env
 *
 * DECRYPTION (added 2026-08-18). After the dotenvx cutover, `.env` values ship as
 * `encrypted:...` ciphertext. `server.js` decrypts via bootstrapDotenvx() before
 * anything reads env, but a CLI script never loads server.js — plain dotenv hands
 * back the ciphertext verbatim, and the first thing that uses a secret fails in a
 * way that names the wrong culprit: a worker client_credentials call answers
 * `invalid_client` (HTTP 401), which reads as "bad credentials in PingOne" rather
 * than "this process never decrypted them". That cost a session chasing a policy
 * import that was in fact fine.
 *
 * So this loader now does what server.js does, in the same order: plain dotenv
 * first (which sets the ciphertext), then bootstrapDotenvx() to replace each
 * ciphertext value with its plaintext. A plaintext .env is an exact pass-through,
 * so nothing changes for an unencrypted checkout.
 *
 * The private key is the single shared one written by scripts/dotenvx-encrypt-envs.js
 * to repo-root `.env.keys`. run.sh / run-docker.sh deliver it to services as
 * DOTENV_PRIVATE_KEY; a plain shell has no such thing, so we read the keys file
 * ourselves when the variable is absent. An explicit DOTENV_PRIVATE_KEY in the
 * environment always wins.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { bootstrapDotenvx } = require('../services/dotenvxBootstrap');

/**
 * The MAIN checkout's root, derived from git rather than guessed from the path.
 *
 * .env and .env.keys are gitignored, so a worktree never has its own and must
 * borrow the main checkout's. The relative guesses below only cover a worktree
 * nested one or two levels down; this repo's worktrees live at
 * `.claude/worktrees/<branch>/` (three), so every guess missed and a CLI run
 * from a worktree reported "missing PINGONE_ENVIRONMENT_ID" — which reads as
 * unconfigured rather than as "wrong directory". `--git-common-dir` points at
 * the main checkout's .git from ANY worktree depth, so its parent is the answer
 * regardless of layout. (verifyA2aDelegationPolicy.js hand-rolled exactly this;
 * it now lives here so every CLI gets it.)
 */
function mainCheckoutRoot() {
  try {
    const common = require('child_process')
      .execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    return common ? path.dirname(common) : null;
  } catch (_err) {
    return null; // git unavailable, or not a repo — the relative guesses still apply
  }
}

/** Build ordered, de-duplicated list of existing .env file paths. */
function resolveEnvCandidates() {
  const apiRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(apiRoot, '..');
  const raw = [];

  if (process.env.DEMO_API_ENV_FILE) {
    raw.push(path.resolve(process.env.DEMO_API_ENV_FILE));
  }

  raw.push(
    path.join(repoRoot, '.env'),
    path.join(apiRoot, '.env'),
  );

  const mainRoot = mainCheckoutRoot();
  if (mainRoot) {
    raw.push(
      path.join(mainRoot, 'demo_api_server', '.env'),
      path.join(mainRoot, '.env'),
    );
  }

  raw.push(
    path.resolve(repoRoot, '../AI-DEMO2/demo_api_server/.env'),
    path.resolve(repoRoot, '../AI-DEMO2/.env'),
    // Nested under main/.worktrees/<branch>/
    path.resolve(repoRoot, '../../demo_api_server/.env'),
    path.resolve(repoRoot, '../../.env'),
  );

  const seen = new Set();
  return raw.filter((p) => {
    if (seen.has(p) || !fs.existsSync(p)) return false;
    seen.add(p);
    return true;
  });
}

/**
 * Shared `.env.keys` candidates, mirroring resolveEnvCandidates()'s worktree
 * fallback: a git worktree has no gitignored .env.keys of its own, so the main
 * checkout's is the one that can actually decrypt.
 */
function resolveKeysCandidates() {
  const apiRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(apiRoot, '..');
  const mainRoot = mainCheckoutRoot();
  return [
    path.join(repoRoot, '.env.keys'),
    ...(mainRoot ? [path.join(mainRoot, '.env.keys')] : []),
    path.resolve(repoRoot, '../AI-DEMO2/.env.keys'),
    path.resolve(repoRoot, '../../.env.keys'),
  ].filter((p) => fs.existsSync(p));
}

/**
 * DOTENV_PRIVATE_KEY from the shared keys file, or null. Parsed with dotenv into
 * a private object — never written to process.env here, because bootstrapDotenvx
 * takes the key as an argument and deletes it after use.
 */
function readSharedPrivateKey() {
  for (const keysPath of resolveKeysCandidates()) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(keysPath));
      if (parsed && parsed.DOTENV_PRIVATE_KEY) return parsed.DOTENV_PRIVATE_KEY;
    } catch (_err) { /* unreadable keys file — fall through to the next candidate */ }
  }
  return null;
}

/** Load demo env files; returns paths that were loaded. */
function loadDemoEnv(options = {}) {
  const { override = false } = options;
  const loaded = [];
  const envPaths = resolveEnvCandidates();
  for (const envPath of envPaths) {
    dotenv.config({ path: envPath, override });
    loaded.push(envPath);
  }

  // Replace any `encrypted:...` value the step above just set.
  //
  // bootstrapDotenvx applies decrypted values to the env object it is handed and
  // resolves the key from that same object, so the key must be ON process.env
  // for the duration of the call. It deletes the key itself on success — but NOT
  // on its `module_unavailable` early return, which happens before that cleanup.
  // Under server.js the key was set externally, so leaving it is a no-op; here we
  // INJECT it, and leaving it behind would hand a private key to every child
  // process these CLIs spawn. Hence the finally: whatever the outcome, the env
  // ends the way it started.
  const hadKey = Object.hasOwn(process.env, 'DOTENV_PRIVATE_KEY');
  const privateKey = process.env.DOTENV_PRIVATE_KEY || readSharedPrivateKey();
  if (privateKey) {
    process.env.DOTENV_PRIVATE_KEY = privateKey;
    try {
      bootstrapDotenvx({
        envPaths,
        env: process.env,
        // Silent by default: these are CLIs whose own output is the point, and the
        // bootstrap line would prepend noise to every one of them. Opt in with
        // loadDemoEnv({ verbose: true }) when diagnosing a decryption problem.
        logger: options.verbose ? console : { log() {}, error: console.error },
      });
    } finally {
      // Restore an externally-supplied key; remove one we introduced.
      if (hadKey) process.env.DOTENV_PRIVATE_KEY = privateKey;
      else delete process.env.DOTENV_PRIVATE_KEY;
    }
  }
  return loaded;
}

/**
 * The live user access token from `.env.test-tokens`, or null.
 *
 * `scripts/extract-browser-token.js` already writes that file (key
 * `INTEGRATION_SUBJECT_ACCESS_TOKEN`) and jest's globalSetup already reads it —
 * but the CLI verifiers never did, so each told you to "log in via browser and
 * set the variable" even when a freshly extracted token was sitting on disk. To
 * make it worse the two disagreed on the name: verify-token-exchange wanted
 * INTEGRATION_SUBJECT_ACCESS_TOKEN (what the extractor writes) and
 * verify-act-claims wanted ACCESS_TOKEN (what nothing writes).
 *
 * Deliberately NOT folded into loadDemoEnv(): loadBrowserToken.js is explicit
 * that the token file must not be auto-injected into every process, or an
 * ordinary run starts hitting real PingOne APIs. A CLI opts in by asking.
 */
function readTestToken() {
  const apiRoot = path.resolve(__dirname, '..');
  const mainRoot = mainCheckoutRoot();
  const candidates = [
    path.join(apiRoot, '.env.test-tokens'),
    ...(mainRoot ? [path.join(mainRoot, 'demo_api_server', '.env.test-tokens')] : []),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = dotenv.parse(fs.readFileSync(p));
      const token = parsed && (parsed.INTEGRATION_SUBJECT_ACCESS_TOKEN || parsed.ACCESS_TOKEN);
      if (token) return token;
    } catch (_err) { /* unreadable — try the next candidate */ }
  }
  return null;
}

module.exports = { loadDemoEnv, resolveEnvCandidates, resolveKeysCandidates, readTestToken };
