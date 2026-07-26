'use strict';

/**
 * Locate the MAIN checkout from anywhere — the main checkout itself or any git
 * worktree under .claude/worktrees/.
 *
 * Why this exists: several e2e helpers need demo_api_server/.env, which is
 * gitignored and therefore ABSENT from every worktree. They handled that with a
 * relative guess plus a hardcoded absolute fallback:
 *
 *     '/Users/curtismuir/Development/AI-DEMO2/demo_api_server/.env'
 *
 * The real account is `cmuir`, so that path never existed. dotenv does not throw
 * on a missing file — it reports `injected env (0)` and continues — so the
 * failure was silent: helpers ran with no credentials, and the session helper
 * lookup fell through to "[restoreBankingVertical] session helper not found —
 * skip". Tests that depended on it degraded instead of failing, which is why it
 * survived. Deriving the path removes both the wrong username and the guess.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

let cached;

/**
 * @returns {string|null} absolute path of the main checkout, or null if not found
 */
function mainCheckoutRoot() {
  if (cached !== undefined) return cached;

  // git --git-common-dir returns the MAIN checkout's .git even from a worktree,
  // which is exactly the question being asked. No hardcoded user or repo name.
  try {
    const common = execFileSync(
      'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (common) {
      const root = path.dirname(common);
      if (fs.existsSync(path.join(root, 'demo_api_server'))) {
        cached = root;
        return cached;
      }
    }
  } catch (_) { /* git unavailable — fall through */ }

  // Fallback for a non-git copy: walk up for a directory that looks like the repo.
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'demo_api_server', 'package.json'))) {
      cached = dir;
      return cached;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  cached = null;
  return cached;
}

/** Absolute path to a file inside the main checkout, or null. */
function mainCheckoutPath(...parts) {
  const root = mainCheckoutRoot();
  return root ? path.join(root, ...parts) : null;
}

module.exports = { mainCheckoutRoot, mainCheckoutPath };
