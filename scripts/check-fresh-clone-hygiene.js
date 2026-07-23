#!/usr/bin/env node

/*
 * Fresh-clone hygiene guardrail.
 *
 * Asserts the invariants that let a brand-new `git clone` boot cleanly (Docker
 * or ./run.sh) without machine-specific edits. Locks in the fixes from the
 * fresh-machine hardening (PRs #441-446) so they cannot silently regress.
 *
 * Called by the "fresh-clone-hygiene" CI job and available standalone:
 *   node scripts/check-fresh-clone-hygiene.js
 *
 * Pure Node built-ins + `git` only (no npm deps, no rg) — mirrors
 * gen-service-topology.js / check-use-cases-maturity.js. Each check:
 *   - PASSES silently when the invariant holds
 *   - FAILS loudly (exit 1) naming the file/line and how to fix it
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const fails = [];
const fail = (check, msg) => fails.push(`[${check}] ${msg}`);

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' });
}
function trackedAll() {
  return git('ls-files').split('\n').filter(Boolean);
}
function isTracked(p) {
  return git(`ls-files -- ${JSON.stringify(p)}`).trim().length > 0;
}
function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

// ── Check 1: no machine-specific home paths in the fresh-machine boot surface ──
// We police the launch/config/script surface, NOT narrative docs or history
// (docs/, .history/, CHANGELOG, etc. legitimately quote absolute example paths).
function isBootSurface(f) {
  if (/(^|\/)package-lock\.json$/.test(f)) return false; // generated
  return (
    /\.sh$/.test(f) ||
    (f.startsWith('scripts/') && /\.(sh|js|cjs|mjs|py)$/.test(f)) ||
    f === '.mcp.json' ||
    /(^|\/)docker-compose[^/]*\.ya?ml$/.test(f) ||
    /(^|\/)Dockerfile[^/]*$/.test(f) ||
    /(^|\/)package\.json$/.test(f) ||
    /(^|\/)\.env[^/]*\.example$/.test(f) ||
    (f.startsWith('k8s/') && /\.ya?ml$/.test(f)) // k8s deploy manifests
  );
}
const HOME_RE = /\/Users\/[A-Za-z0-9._-]+\//;
for (const f of trackedAll().filter(isBootSurface)) {
  let txt;
  try { txt = read(f); } catch { continue; }
  txt.split('\n').forEach((line, i) => {
    if (HOME_RE.test(line)) {
      fail('home-paths', `${f}:${i + 1} hardcoded home path — breaks on other machines: ${line.trim().slice(0, 100)}`);
    }
  });
}

// ── Check 2: .mcp.json is valid and uses the parse-safe ${CLAUDE_PROJECT_DIR:-.} ──
// The file is optional (per-machine MCP config); only lint it when present.
if (fs.existsSync(path.join(ROOT, '.mcp.json'))) {
  const raw = read('.mcp.json');
  try { JSON.parse(raw); } catch (e) { fail('mcp', `.mcp.json is not valid JSON: ${e.message}`); }
  const bare = raw.match(/\$\{CLAUDE_PROJECT_DIR\}/g);
  if (bare) {
    fail('mcp', `${bare.length}x bare \${CLAUDE_PROJECT_DIR} (no default). In a project-scoped .mcp.json that var is unset at parse time, so Claude Code fails to parse the WHOLE config — use \${CLAUDE_PROJECT_DIR:-.}`);
  }
}

// ── Check 3: shared settings.json is tracked, minimal, secret-free ──
{
  const sp = '.claude/settings.json';
  if (!isTracked(sp)) {
    fail('settings', `${sp} is not tracked — a fresh clone won't get the shared Claude settings`);
  } else {
    let s;
    try { s = JSON.parse(read(sp)); } catch (e) { fail('settings', `${sp} invalid JSON: ${e.message}`); }
    if (s && 'permissions' in s) {
      fail('settings', `${sp} must not contain a "permissions" block — the personal allowlist (and any secrets like VAULT_PASSWORD) belong in gitignored settings.local.json`);
    }
  }
  // settings.local.json must stay ignored (holds the personal allowlist/secrets)
  let ignored = false;
  try { git('check-ignore -q .claude/settings.local.json'); ignored = true; } catch { ignored = false; }
  if (!ignored) fail('settings', '.claude/settings.local.json is NOT gitignored — risk of committing the personal allowlist/secrets');
}

// ── Check 5: docker compose boots a fresh clone with ONLY demo_api_server/.env ──
// Every per-service env_file except the BFF must be required:false, so a missing
// (gitignored) .env doesn't fail `docker compose up`.
{
  const lines = read('docker-compose.yml').split('\n');
  let sawBff = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*(?:path:\s*)?(\.?\/?\S*\.env)\s*$/);
    if (!m) continue;
    const p = m[1];
    const next = lines[i + 1] || '';
    const optional = /required:\s*false/.test(next);
    if (p.includes('demo_api_server/.env')) {
      sawBff = true; // intentionally the one required file (QUICKSTART/NEW-MACHINE §3)
    } else if (!optional) {
      fail('compose', `${p}: env_file must be "required: false" (it's gitignored, absent on a fresh clone) — only demo_api_server/.env may be required`);
    }
  }
  if (!sawBff) fail('compose', 'no demo_api_server/.env env_file entry found in docker-compose.yml');
}

// ── Check 6: no ${VAR} compose interpolation without a default ──
// Unset on a fresh clone (no root .env) → silently blank. Require :-default.
{
  const text = read('docker-compose.yml');
  const bare = [...new Set(text.match(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g) || [])];
  if (bare.length) {
    fail('compose-vars', `docker-compose.yml has \${VAR} interpolation(s) with no default (blank on a fresh clone): ${bare.join(', ')} — use \${VAR:-default}`);
  }
}

// ── Check 7: sessions survive restarts in every deploy path ──
// The BFF wipes all persisted sessions on boot unless CLEAR_SESSIONS_ON_BOOT
// is "false" (server.js). A pod restart/redeploy or compose recreate is a
// "boot", so an unset/true value logs out every user on each rollout. Pin
// "false" in both deploy surfaces.
for (const [file, label] of [['docker-compose.yml', 'docker'], ['k8s/02-configmap.yaml', 'k8s']]) {
  const txt = read(file);
  // Anchored, non-comment line only (a "# ...CLEAR_SESSIONS_ON_BOOT..." note must not satisfy it).
  if (!/^\s*CLEAR_SESSIONS_ON_BOOT\s*:\s*["']?false["']?/m.test(txt)) {
    fail('sessions', `${file} (${label} deploy) must pin CLEAR_SESSIONS_ON_BOOT to "false" — otherwise every restart/rollout wipes all user sessions`);
  }
}

// ── Dead agent-launch invariant ──
// Nothing in the app reads `?vertical=` / `msg=` query params, so a launch built
// on them silently drops the prompt on every click (OASDemoPage's "Launch AI
// Agent →" did exactly this — a dead button shipping for months). The working
// pattern is navigate('/dashboard', { state: { triggerText } }) — AIAgent.js
// consumes location.state.triggerText and auto-sends it.
{
  const DEAD_LAUNCH_RES = [
    /navigate\(\s*['"`]\/?\?vertical=/,          // navigate('/?vertical=...')
    /[?&]msg=['"`]?\s*\+\s*encodeURIComponent/,  // '...msg=' + encodeURIComponent(prompt)
  ];
  for (const p of trackedAll()) {
    if (!p.startsWith('demo_api_ui/src/') || !/\.(jsx?|tsx?)$/.test(p)) continue;
    const txt = read(p);
    for (const re of DEAD_LAUNCH_RES) {
      if (re.test(txt)) {
        fail('dead-launch', `${p}: agent launch via query params (${re}) — nothing reads them; the prompt is silently dropped. Use navigate('/dashboard', { state: { triggerText } }).`);
      }
    }
  }
}

// ── Never-silent reply invariant ──
// A silent agent reply is the worst demo failure: the user cannot tell a model
// limit from a broken page, and Authorize/Gateway "not running" looks like a chat
// glitch. These are the exact shapes that produced silent replies before they
// were fixed (PRs #520/#526/#531/#547/#550) — each check locks one fix so a
// refactor cannot quietly reintroduce it. Narrow by design: one file, one shape.
{
  const li = read('llamaindex_agent/agent.py');
  if (/except Exception:\s*\n\s*return ""/.test(li)) {
    fail('never-silent', 'llamaindex_agent/agent.py: bare `except Exception: return ""` is back — an empty answer renders as NOTHING (the "HTTP 200 with sources but EMPTY answer" bug). Route every exit through EMPTY_ANSWER_NOTICE.');
  }
  if (!li.includes('EMPTY_ANSWER_NOTICE')) {
    fail('never-silent', 'llamaindex_agent/agent.py: EMPTY_ANSWER_NOTICE is gone — _completion_text has no non-silent fallback.');
  }

  const lc = read('langchain_agent/src/agent/langchain_mcp_agent.py');
  if (/or\s+"I'm sorry, I couldn't process your request\."/.test(lc)) {
    fail('never-silent', "langchain_agent langchain_mcp_agent.py: the generic \"I'm sorry, I couldn't process your request\" fallback is back — it blames the REQUEST when the model produced no visible content. Say what happened instead.");
  }

  const route = read('demo_api_server/routes/agentInvokeRoute.js');
  if ((route.match(/ensureNonEmptyReply\(/g) || []).length < 2) {
    fail('never-silent', 'demo_api_server/routes/agentInvokeRoute.js: ensureNonEmptyReply must exist AND be called before res.json — it is the server-side net for every agent turn.');
  }

  const ui = read('demo_api_ui/src/components/AIAgent.js');
  if (!ui.includes('empty assistant reply intercepted')) {
    fail('never-silent', 'demo_api_ui/src/components/AIAgent.js: the addMessage empty-reply guard is gone — a blank assistant bubble can render again.');
  }
}

// ── Resource-server dual-view canaries (#780/#781) ──
// Login RS / In-flow RS shipped without route/UI tests or mint hardening; the
// follow-up locked these so a merge cannot drop the session gate, badge fix, or
// tester coverage again. If any check fails, restore the canary + fix immediately.
{
  const canaries = [
    'demo_api_server/src/__tests__/resourceServer.summaryInflow.regression.test.js',
    'demo_api_ui/src/components/__tests__/ResourceServerPage.dualView.test.jsx',
  ];
  for (const p of canaries) {
    if (!isTracked(p) || !fs.existsSync(path.join(ROOT, p))) {
      fail('rs-dual-view', `${p} missing — post-merge ledger/tester canary for Login/In-flow RS. Restore from #781.`);
    }
  }

  const route = read('demo_api_server/routes/resourceServer.js');
  if (!/summary-inflow[\s\S]*?_cookie_session/.test(route)) {
    fail('rs-dual-view', 'demo_api_server/routes/resourceServer.js: /summary-inflow must session-gate like /summary (_cookie_session / missing AT → 401).');
  }

  const page = read('demo_api_ui/src/components/ResourceServerPage.jsx');
  if (!page.includes("startsWith('banking:')")) {
    fail('rs-dual-view', "demo_api_ui/src/components/ResourceServerPage.jsx: ScopesBadges must use startsWith('banking:') — startsWith('') highlights every scope.");
  }
  if (!page.includes("role=\"tablist\"") || !page.includes('Login RS') || !page.includes('In-flow RS')) {
    fail('rs-dual-view', 'demo_api_ui/src/components/ResourceServerPage.jsx: Login RS / In-flow RS tablist is gone.');
  }

  const tester = read('demo_api_server/services/resourceServerTesterService.js');
  if (!tester.includes('resolveTokenAsync') || !tester.includes("error: 'token_not_in_session'")) {
    fail('rs-dual-view', 'demo_api_server/services/resourceServerTesterService.js: resolveTokenAsync must reject missing subject AT (token_not_in_session) before minting.');
  }
  const testerUnit = read('demo_api_server/src/__tests__/resourceServerTester.test.js');
  if (!testerUnit.includes("describe('resolveTokenAsync'") || !testerUnit.includes('mcp_token_mint_failed')) {
    fail('rs-dual-view', 'demo_api_server/src/__tests__/resourceServerTester.test.js: resolveTokenAsync edge-case suite missing — restore mint failure coverage.');
  }
}

// ── Report ──
if (fails.length) {
  console.error('✗ fresh-clone hygiene FAILED:\n');
  for (const f of fails) console.error('  ' + f);
  console.error(`\n${fails.length} violation(s). See NEW-MACHINE.md for the fresh-machine contract.`);
  process.exit(1);
}
console.log('✓ fresh-clone hygiene: all checks passed (home paths, .mcp.json, settings.json, agents, compose+k8s env/vars, session persistence, rs-dual-view)');
