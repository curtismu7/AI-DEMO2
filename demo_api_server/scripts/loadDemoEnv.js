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

  // Replace any `encrypted:...` value the step above just set. Handed an env
  // object seeded with the key rather than mutating process.env directly, so an
  // explicit DOTENV_PRIVATE_KEY in the real environment keeps precedence and the
  // key never lands in process.env for a child process to inherit.
  const privateKey = process.env.DOTENV_PRIVATE_KEY || readSharedPrivateKey();
  if (privateKey) {
    bootstrapDotenvx({
      envPaths,
      env: Object.assign(process.env, { DOTENV_PRIVATE_KEY: privateKey }),
      // Silent by default: these are CLIs whose own output is the point, and the
      // bootstrap line would prepend noise to every one of them. Opt in with
      // loadDemoEnv({ verbose: true }) when diagnosing a decryption problem.
      logger: options.verbose ? console : { log() {}, error: console.error },
    });
  }
  return loaded;
}

module.exports = { loadDemoEnv, resolveEnvCandidates, resolveKeysCandidates };
