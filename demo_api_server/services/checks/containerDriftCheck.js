'use strict';

/**
 * Is the code RUNNING the code you have?
 *
 * WHY THIS EXISTS
 *
 * Every other check here talks to the stack, so a container serving a stale
 * build passes all of them while demoing something you cannot reproduce from
 * main. Two variants cost most of a day on 2026-07-26:
 *
 *   mcp-weather   The get_weather -> get_current_conditions bridge merged
 *                 07-22. The image built 07-26 — four days later — still
 *                 lacked it, because Docker reused a cached COPY layer.
 *                 host 182 lines / container 167. The third-party-MCP demo
 *                 failed in ALL 9 verticals with the fix merged on main.
 *   authz-server  A merged fix chased for hours against a process that had
 *                 never reloaded it (`node --watch` restarts the child, not
 *                 PID 1, and `git pull` swaps inodes).
 *
 * No unit test can catch this class: the code is correct, the artifact is not.
 * Only a run against real paths exposes it — and by then you are on stage.
 *
 * Mirrors check 8 of scripts/preflight-demo.sh. Kept as a module so the CLI and
 * the /check page assert the same thing rather than drifting apart.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { register } = require('./registry');

const ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * The MAIN checkout, which is where compose must run from.
 *
 * ROOT is the tree this module was loaded from — a git WORKTREE when running
 * from one. Telling an operator to `compose --project-directory <worktree>`
 * repoints the whole shared stack at that worktree, and the symptom is a
 * feature "regressing" with the code plainly intact. Derive the real checkout
 * from git instead of assuming; fall back to ROOT when git is unavailable.
 */
function mainCheckoutRoot() {
  try {
    const out = require('child_process').execFileSync(
      'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (out) {
      const root = path.dirname(out);
      if (fs.existsSync(path.join(root, 'docker-compose.yml'))) return root;
    }
  } catch (_) { /* git unavailable */ }
  return ROOT;
}

/**
 * Services to compare, and a distinctive line to look for in each.
 *
 * A line, not a version string: nobody bumps a version on a bug fix, so a
 * version check passes through exactly the drift that matters. Container paths
 * are a LIST because these containers differ — some bake code at /app, some
 * bind-mount the checkout at /repo.
 */
const WATCHED = [
  {
    container: 'ai-demo-mcp-weather',
    repoPath: 'demo_mcp_weather/server.js',
    containerPaths: ['/app/server.js', '/repo/demo_mcp_weather/server.js'],
    needle: 'get_current_conditions',
  },
  {
    container: 'ai-demo-authz-server',
    repoPath: 'demo_authz_server/routes/decision.js',
    containerPaths: ['/repo/demo_authz_server/routes/decision.js', '/app/routes/decision.js'],
    needle: 'a2aDelegatedScope',
  },
  {
    container: 'ai-demo-api-server',
    repoPath: 'demo_api_server/services/demoAgentLangGraphService.js',
    containerPaths: [
      '/app/services/demoAgentLangGraphService.js',
      '/repo/demo_api_server/services/demoAgentLangGraphService.js',
    ],
    needle: 'stripChainFieldsForModel',
  },
];

/** Run a command with a fixed argv. Never a shell — no interpolation anywhere. */
function run(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, shell: false }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || '').trim() });
    });
  });
}

async function runningContainers() {
  const r = await run('docker', ['ps', '--format', '{{.Names}}']);
  return r.ok ? new Set(r.out.split('\n').filter(Boolean)) : null;
}

/**
 * @returns {Promise<{stale:string[], unknown:string[], checked:number, dockerless:boolean}>}
 */
async function findDrift() {
  const names = await runningContainers();
  if (!names) return { stale: [], unknown: [], checked: 0, dockerless: true };

  const stale = [];
  const unknown = [];
  let checked = 0;

  for (const w of WATCHED) {
    if (!names.has(w.container)) continue;
    const repoFile = path.join(ROOT, w.repoPath);
    let want = 0;
    try {
      want = (fs.readFileSync(repoFile, 'utf8').match(new RegExp(w.needle, 'g')) || []).length;
    } catch (_) { want = 0; }
    // Needle gone from the repo — nothing to assert against.
    if (want === 0) continue;

    let found = null;
    for (const p of w.containerPaths) {
      // eslint-disable-next-line no-await-in-loop
      const t = await run('docker', ['exec', w.container, 'sh', '-c', `[ -f '${p}' ] && echo yes`]);
      if (t.ok && t.out === 'yes') { found = p; break; }
    }
    if (!found) {
      // A check pointed at a file that is not there greps nothing, reports no
      // drift, and is worse than no check at all. Say so instead of passing.
      unknown.push(w.container);
      continue;
    }
    checked += 1;
    // grep -c prints 0 AND exits 1 on no match, so read stdout, not the code.
    // eslint-disable-next-line no-await-in-loop
    const g = await run('docker', ['exec', w.container, 'sh', '-c', `grep -c -- '${w.needle}' '${found}' || true`]);
    const have = parseInt(String(g.out).split('\n')[0], 10) || 0;
    if (have === 0) stale.push(w.container);
  }
  return { stale, unknown, checked, dockerless: false };
}

const containerDrift = {
  id: 'containers.drift',
  name: 'Running containers match the repo',
  category: 'Servers',
  severity: 'blocking',
  async run() {
    const { stale, unknown, checked, dockerless } = await findDrift();

    if (dockerless) {
      return {
        status: 'warn',
        detail: 'docker is not reachable from here — cannot compare running code to the repo.',
        nextAction: 'Run this on the host running the stack, or check with scripts/preflight-demo.sh.',
      };
    }
    if (stale.length > 0) {
      return {
        status: 'fail',
        detail:
          `${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} running code that is NOT in the repo. `
          + 'A merged fix can sit unrunnable for days this way — the code is right, the artifact is not.',
        meta: { stale, unknown, checked },
        nextAction:
          `docker compose --project-directory ${mainCheckoutRoot()} build --no-cache ${stale.join(' ')} `
          + `&& docker compose --project-directory ${mainCheckoutRoot()} up -d --force-recreate ${stale.join(' ')}`,
      };
    }
    if (unknown.length > 0) {
      return {
        status: 'warn',
        detail: `Could not locate the source file inside: ${unknown.join(', ')} (image layout changed?).`,
        meta: { stale, unknown, checked },
        nextAction: 'Update containerPaths in services/checks/containerDriftCheck.js.',
      };
    }
    return {
      status: 'pass',
      detail: `${checked} container(s) verified against the repo.`,
      meta: { checked },
    };
  },
};

register(containerDrift);
module.exports = { containerDrift, findDrift, WATCHED };
