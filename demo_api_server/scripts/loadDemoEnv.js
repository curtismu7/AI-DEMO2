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
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

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
    path.resolve(repoRoot, '../AI-DEMO2/demo_api_server/.env'),
    path.resolve(repoRoot, '../AI-DEMO2/.env'),
  );

  const seen = new Set();
  return raw.filter((p) => {
    if (seen.has(p) || !fs.existsSync(p)) return false;
    seen.add(p);
    return true;
  });
}

/** Load demo env files; returns paths that were loaded. */
function loadDemoEnv(options = {}) {
  const { override = false } = options;
  const loaded = [];
  for (const envPath of resolveEnvCandidates()) {
    dotenv.config({ path: envPath, override });
    loaded.push(envPath);
  }
  return loaded;
}

module.exports = { loadDemoEnv, resolveEnvCandidates };
