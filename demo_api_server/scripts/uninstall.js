#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * uninstall.js — tear down a banking-demo install.
 *
 * Removes everything `setup:fresh` created so you can re-run from scratch on
 * the same machine, or to free disk before deleting the repo. Four phases,
 * any of which can be skipped via flags:
 *
 *   1. Stop services        ./run-demo.sh stop
 *   2. Wipe PingOne env     bootstrapPingOne.js --wipe-environment
 *                           (y/N confirmation, idempotent)
 *   3. Delete local state   .env, data/persistent/, data/sessions.db,
 *                           data/backups/, setup.log, certs/
 *   4. Delete node_modules  in all 7 Node services (~2 GB)
 *
 * Defaults to ON for all four. Each phase can be skipped:
 *
 *   --keep-services         don't stop running services
 *   --keep-pingone          don't touch PingOne
 *   --keep-local            don't delete .env / data / certs / setup.log
 *   --keep-node-modules     don't delete node_modules dirs
 *
 * Run-summary table + Y/N gate — same UX as setup:fresh. Always asks when
 * there's a real TTY; auto-accepts when there isn't (CI / curl-pipe).
 *
 * What is NOT removed (deliberately):
 *   - Source code (git tree)
 *   - ~/.zshrc / ~/.bashrc nvm bootstrap (machine-wide)
 *   - mkcert root CA (machine-wide)
 *   - The repo directory itself (you delete it manually if you want)
 *
 * Exit codes:
 *   0  uninstall completed successfully
 *   1  fatal error in one of the phases
 *   2  user aborted at a confirmation prompt
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// ── Node version pre-flight (same pattern as setupFresh / export / import) ───
function checkNodeVersion() {
  // Accept any Node major at or above engines.node's floor (e.g. ">=20", "20.x").
  const ROOT_PKG = path.resolve(__dirname, '..', '..', 'package.json');
  let floor = 20;
  try {
    const engines = JSON.parse(fs.readFileSync(ROOT_PKG, 'utf8')).engines;
    const m = engines && engines.node && String(engines.node).match(/(\d+)/);
    if (m) floor = parseInt(m[1], 10);
  } catch (_e) { /* fall back */ }
  const actual = parseInt(String(process.versions.node || '').split('.')[0], 10);
  if (Number.isFinite(actual) && actual >= floor) return;
  console.error(`Node ${floor}+ required, but this shell is using Node ${process.version}.`);
  console.error(`Fix:  export NVM_DIR="$HOME/.nvm" && \\. "$NVM_DIR/nvm.sh" && nvm use ${floor}`);
  process.exit(1);
}

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Banking demo uninstall

Usage:
  npm run uninstall

What runs by default (override with --keep-* flags):

  Phase 1   Stop services        ./run-demo.sh stop
  Phase 2   Wipe PingOne env     bootstrapPingOne.js --wipe-environment
                                 (y/N confirmation, idempotent)
  Phase 3   Delete local state   .env, data/persistent/, data/sessions.db,
                                 data/backups/, setup.log, certs/*
  Phase 4   Delete node_modules  in all 7 Node services (~2 GB)

Flags:
  --keep-services       don't stop running services (phase 1)
  --keep-pingone        don't touch PingOne (phase 2)
  --keep-local          don't delete .env / data / certs / setup.log (phase 3)
  --keep-node-modules   don't delete node_modules dirs (phase 4)
  --yes                 skip the run-summary Y/N gate (still confirms PingOne wipe)
  --help / -h           this message

What is NOT removed (you do these by hand if you want):
  - Source code (git tree) — \`rm -rf <repo>\` after this script
  - ~/.zshrc / ~/.bashrc nvm bootstrap (machine-wide)
  - mkcert root CA (machine-wide)
  - Helix tenant resources (this script does not touch Helix)

Exit codes:
  0  uninstall completed
  1  fatal error in a phase
  2  user aborted at a confirmation prompt
`);
  process.exit(0);
}

checkNodeVersion();

const KEEP_SERVICES      = args.includes('--keep-services');
const KEEP_PINGONE       = args.includes('--keep-pingone');
const KEEP_LOCAL         = args.includes('--keep-local');
const KEEP_NODE_MODULES  = args.includes('--keep-node-modules');
const SKIP_GATE          = args.includes('--yes');

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

// Mirror setupFresh's seven Node services list — keep in sync if a service is added.
const SERVICES = [
  'demo_api_server',
  'demo_mcp_server',
  'demo_api_ui',
  'demo_mcp_gateway',
  'demo_hitl_service',
  'demo_agent_service',
  'demo_mcp_invest',
];

// ── Phase definitions (data, not actions — used by both the table and main) ──
const phases = [
  { key: 'services',     enabled: !KEEP_SERVICES,     label: 'Stop services',     action: phaseStopServices },
  { key: 'pingone',      enabled: !KEEP_PINGONE,      label: 'Wipe PingOne env',  action: phaseWipePingOne },
  { key: 'local',        enabled: !KEEP_LOCAL,        label: 'Delete local state',action: phaseDeleteLocal },
  { key: 'nodeModules',  enabled: !KEEP_NODE_MODULES, label: 'Delete node_modules', action: phaseDeleteNodeModules },
];

// ── UX helpers ───────────────────────────────────────────────────────────────
function banner(text) {
  const w = 60;
  console.log('');
  console.log('═'.repeat(w));
  console.log('  ' + text);
  console.log('═'.repeat(w));
  console.log('');
}
function phase(n, total, text) {
  console.log('');
  console.log(`▶ STEP ${n}/${total} — ${text}`);
  console.log('  ' + '─'.repeat(58));
}
function ok(msg)   { console.log(`✓ ${msg}`); }
function skip(msg) { console.log(`○ ${msg}`); }
function fail(msg) { console.log(`✗ ${msg}`); }

function isInteractiveStdin() {
  if (process.stdin.isTTY) return true;
  try {
    const fd = fs.openSync('/dev/tty', 'r');
    fs.closeSync(fd);
    return true;
  } catch (_e) { return false; }
}

function readlineQuestion(question, defaultYes = true) {
  return new Promise((resolve) => {
    const readline = require('readline');
    let input = process.stdin;
    let openedTty = false;
    if (!process.stdin.isTTY) {
      try {
        input = fs.createReadStream('/dev/tty');
        openedTty = true;
        input.on('error', () => { try { input.destroy(); } catch (_e) {} resolve(defaultYes); });
      } catch (_e) { return resolve(defaultYes); }
    }
    const rl = readline.createInterface({ input, output: process.stdout, terminal: true });
    const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
    rl.question(question + suffix, (answer) => {
      rl.close();
      if (openedTty) try { input.destroy(); } catch (_e) {}
      const s = String(answer || '').trim().toLowerCase();
      if (!s) return resolve(defaultYes);
      resolve(/^y(es)?$/.test(s));
    });
  });
}

// ── Run-summary table + Y/N gate ─────────────────────────────────────────────
function runSummaryText() {
  const rows = phases.map(p => [
    `Phase ${phases.indexOf(p) + 1}: ${p.label}`,
    p.enabled ? 'WILL RUN' : 'SKIPPED',
    p.enabled ? '' : `--keep-${p.key === 'nodeModules' ? 'node-modules' : p.key}`,
  ]);
  const w1 = Math.max(...rows.map(r => r[0].length));
  const w2 = Math.max(...rows.map(r => r[1].length));
  const lines = rows.map(([k, v, flag]) =>
    `  ${k.padEnd(w1)}   ${v.padEnd(w2)}   ${flag}`
  ).join('\n');

  const argLine = process.argv.slice(2).join(' ') || '(no flags — full uninstall)';

  return `═══════════════════════════════════════════════════════════════════════════
  uninstall — what's about to happen
═══════════════════════════════════════════════════════════════════════════

This run's flags: ${argLine}

${lines}

What this will REMOVE:
  - Running banking-demo services on this machine
${!KEEP_PINGONE      ? '  - Every Super Banking app, resource, group, custom attr, and demo\n    user in your PingOne env (y/N confirmation required)\n' : ''}\
${!KEEP_LOCAL        ? '  - demo_api_server/.env\n  - demo_api_server/data/persistent/  (config.db, banking.db, …)\n  - demo_api_server/data/sessions.db, data/backups/\n  - certs/*.pem\n  - setup.log\n' : ''}\
${!KEEP_NODE_MODULES ? `  - node_modules in all ${SERVICES.length} Node services (~2 GB)\n` : ''}\

What this will NOT remove:
  - The repo directory itself (you can \`rm -rf\` it after this script)
  - Source code in the git tree
  - ~/.zshrc / ~/.bashrc nvm bootstrap (machine-wide)
  - mkcert root CA (machine-wide)
  - Anything in your Helix tenant

Other recipes you could run instead (Ctrl-C now and pick one):

  1) Just wipe PingOne, keep everything local
       npm run pingone:wipe

  2) Just stop services
       ./run-demo.sh stop

  3) Wipe local + PingOne, then re-provision (NOT delete — re-install)
       npm run reset

  4) Skip a specific phase
       npm run uninstall -- --keep-pingone
       npm run uninstall -- --keep-node-modules

═══════════════════════════════════════════════════════════════════════════`;
}

async function confirmRun() {
  console.log('');
  console.log(runSummaryText());
  console.log('');

  if (SKIP_GATE) {
    console.log('  --yes flag set — skipping the run-summary confirmation.');
    console.log('  (PingOne wipe still requires y/N confirmation.)');
    console.log('');
    return true;
  }

  if (!isInteractiveStdin()) {
    // Different posture from setup:fresh's auto-accept: uninstall is destructive
    // by definition, and unattended runs without explicit --yes are surprising.
    // Ask the user to opt in explicitly via the flag.
    console.log('  No TTY detected. Refusing to auto-accept a destructive run.');
    console.log('  Pass --yes to opt in (e.g. npm run uninstall -- --yes).');
    console.log('');
    return false;
  }

  return readlineQuestion('Continue with uninstall?', /* defaultYes */ false);
}

// ── Phase 1: stop services ──────────────────────────────────────────────────
async function phaseStopServices() {
  const runBank = path.join(REPO_ROOT, 'run-demo.sh');
  if (!fs.existsSync(runBank)) {
    skip('run-demo.sh not found — assuming services are not running here');
    return 0;
  }
  return new Promise((resolve) => {
    const child = spawn('bash', [runBank, 'stop'], { cwd: REPO_ROOT, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) ok('All services stopped');
      else            fail(`run-demo.sh stop exited ${code} — continuing anyway`);
      // Don't fail the whole uninstall if stop returns non-zero; some services
      // may already be down. The next phases don't depend on a clean stop.
      resolve(0);
    });
  });
}

// ── Phase 2: wipe PingOne ────────────────────────────────────────────────────
async function phaseWipePingOne() {
  return new Promise((resolve) => {
    const child = spawn('node', [
      path.join(SERVER_ROOT, 'scripts', 'bootstrapPingOne.js'),
      '--wipe-environment',
    ], { cwd: SERVER_ROOT, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) ok('PingOne environment wiped');
      else if (code === 2) {
        // User declined the y/N confirmation. Treat as a soft skip
        // (uninstall continues so the user can still reach phase 3/4).
        skip('PingOne wipe declined at confirmation — continuing with local cleanup');
        return resolve(0);
      } else {
        fail(`PingOne wipe failed (exit ${code})`);
        return resolve(code);
      }
      resolve(0);
    });
  });
}

// ── Phase 3: delete local state ──────────────────────────────────────────────
async function phaseDeleteLocal() {
  // Each entry: { abs path, label }. Only deletes what exists.
  // Includes the cred cache at ~/.banking-demo-creds — uninstall really
  // means "back to a fresh-install state" and a stale cache would silently
  // skip the prompt step on the next setup:fresh.
  const HOME = require('os').homedir();
  const targets = [
    { abs: path.join(SERVER_ROOT, '.env'),                          label: '.env' },
    { abs: path.join(SERVER_ROOT, 'data', 'persistent'),            label: 'data/persistent/', isDir: true },
    { abs: path.join(SERVER_ROOT, 'data', 'sessions.db'),           label: 'data/sessions.db' },
    { abs: path.join(SERVER_ROOT, 'data', 'sessions.db-journal'),   label: 'data/sessions.db-journal' },
    { abs: path.join(SERVER_ROOT, 'data', 'sessions.db-wal'),       label: 'data/sessions.db-wal' },
    { abs: path.join(SERVER_ROOT, 'data', 'sessions.db-shm'),       label: 'data/sessions.db-shm' },
    { abs: path.join(SERVER_ROOT, 'data', 'backups'),               label: 'data/backups/',   isDir: true },
    { abs: path.join(REPO_ROOT, 'setup.log'),                       label: 'setup.log' },
    { abs: path.join(REPO_ROOT, 'certs'),                           label: 'certs/',         isDir: true },
    { abs: path.join(HOME, '.banking-demo-creds'),                  label: '~/.banking-demo-creds' },
  ];

  let removed = 0;
  let kept = 0;
  for (const t of targets) {
    if (!fs.existsSync(t.abs)) { kept++; continue; }
    try {
      fs.rmSync(t.abs, { recursive: true, force: true });
      ok(`Removed ${t.label}`);
      removed++;
    } catch (e) {
      fail(`Could not remove ${t.label}: ${e.message}`);
    }
  }
  if (removed === 0) skip('Nothing to remove — local state already clean');
  return 0;
}

// ── Phase 4: delete node_modules ─────────────────────────────────────────────
async function phaseDeleteNodeModules() {
  let removed = 0;
  for (const svc of SERVICES) {
    const dir = path.join(REPO_ROOT, svc, 'node_modules');
    if (!fs.existsSync(dir)) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      ok(`Removed ${svc}/node_modules`);
      removed++;
    } catch (e) {
      fail(`Could not remove ${svc}/node_modules: ${e.message}`);
    }
  }
  // Also remove any dist/ build outputs the run-demo.sh dep loop generated.
  // These are tiny but their presence confuses a future fresh install.
  for (const svc of SERVICES) {
    const dist = path.join(REPO_ROOT, svc, 'dist');
    if (!fs.existsSync(dist)) continue;
    try {
      fs.rmSync(dist, { recursive: true, force: true });
      ok(`Removed ${svc}/dist`);
    } catch (_e) { /* dist is best-effort cleanup */ }
  }
  if (removed === 0) skip('No node_modules to remove');
  return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  banner('Banking demo uninstall');

  if (!(await confirmRun())) {
    console.log('');
    console.log('Aborted at run-summary confirmation. No changes made.');
    process.exit(2);
  }

  const enabled = phases.filter(p => p.enabled);
  const total = enabled.length;
  if (total === 0) {
    console.log('');
    console.log('Nothing to do — every phase was disabled with --keep-* flags.');
    process.exit(0);
  }

  let n = 0;
  for (const p of phases) {
    if (!p.enabled) continue;
    n++;
    phase(n, total, p.label);
    const code = await p.action();
    if (code !== 0) {
      fail(`Phase failed (${p.label}). Stopping uninstall.`);
      process.exit(1);
    }
  }

  banner('Uninstall complete');
  console.log('  Next steps:');
  if (!KEEP_NODE_MODULES) {
    console.log('    - To use the demo again from this checkout:');
    console.log('        npm run setup:fresh');
  } else {
    console.log('    - Source + node_modules retained. To re-provision:');
    console.log('        npm run setup:fresh');
  }
  console.log('    - To delete the repo entirely:');
  console.log(`        rm -rf ${REPO_ROOT}`);
  console.log('');
}

process.on('uncaughtException', (err) => {
  console.error('');
  console.error('UNCAUGHT EXCEPTION (uninstall):');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('');
  console.error('UNHANDLED PROMISE REJECTION (uninstall):');
  console.error(reason && reason.stack ? reason.stack : String(reason));
  process.exit(1);
});

main().catch((e) => {
  console.error(`Unexpected error: ${e.message}`);
  if (e && e.stack) console.error(e.stack);
  process.exit(1);
});
