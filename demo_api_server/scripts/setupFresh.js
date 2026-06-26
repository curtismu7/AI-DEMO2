#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * setupFresh.js — one-command setup for both fresh installs and migrations.
 *
 * ─── Quick command reference ────────────────────────────────────────────────
 *
 * All commands run from the repo root. The default for `npm run setup:fresh`
 * (no flags) is: confirm install dir → cleanup IF prior state exists (prompted)
 * → npm install (if needed) → /etc/hosts check → bootstrap PingOne (apps,
 * resources, scopes, demo users, .env) → ask about Helix LLM config → restart
 * services. Touches PingOne; does NOT wipe it.
 *
 *   npm run setup:fresh                          Fresh install (default).
 *                                                Idempotent: safe to rerun.
 *   npm run setup:fresh -- <bundle.tar.gz>       Migrate from another machine.
 *                                                Imports data + .env, then only
 *                                                runs bootstrap if .env is
 *                                                missing newer apps.
 *   npm run import -- <bundle.tar.gz>            Just the import — no bootstrap,
 *                                                no Helix prompt.
 *   npm run export                               Build a migration bundle from
 *                                                THIS machine into ./bundles/.
 *   npm run reset                                Nuclear reset: wipes BOTH local
 *                                                state AND the PingOne env, then
 *                                                provisions from scratch.
 *                                                = setup:fresh --clean --reset-pingone
 *   npm run reset:import -- <bundle.tar.gz>      Same nuclear reset, then import
 *                                                the bundle.
 *   npm run pingone:bootstrap                    Bootstrap PingOne ONLY.
 *                                                No deps, no hosts, no Helix.
 *                                                Idempotent.
 *   npm run pingone:wipe                         Type-to-confirm wipe of every
 *                                                Super Banking app, resource,
 *                                                group, custom attr, and demo
 *                                                user in PingOne.
 *   npm run pingone:recreate                     Delete the demo apps + resources
 *                                                in PingOne, then create fresh
 *                                                ones. Less aggressive than wipe.
 *   ./run.sh                                     Start everything (Docker Compose).
 *   ./run-k8.sh                                  Start everything (Kubernetes).
 *   ./run.sh restart                             Pick up new .env values.
 *   ./run.sh stop                                Stop everything.
 *   ./run.sh status                              Health check.
 *
 * ─── Defaults this script applies (override with the listed flag) ───────────
 *
 *   Confirm install dir prompt → ON           --yes / --from-installer to skip
 *   Cleanup prior state         → PROMPT      --clean (force) / --no-clean
 *   /etc/hosts check            → ON          (no flag — passive check only)
 *   Wipe PingOne env first      → OFF         --reset-pingone to enable
 *   Recreate just demo apps     → OFF         --recreate-apps to enable
 *   Import (with tar arg)       → ON          (omit the arg to skip)
 *   Bootstrap PingOne           → ON          (always runs; see import case
 *                                              for migration short-circuit)
 *   Helix LLM config prompt     → PROMPT (default Yes; Enter accepts).
 *                                              --helix to skip the prompt and
 *                                              go straight to field collection.
 *                                              --skip-helix to force-no.
 *                                              In non-interactive mode (no TTY):
 *                                              auto-configures from HELIX_* env
 *                                              vars if present, else skips.
 *   Browser-form for creds      → ON          --no-browser to use terminal only
 *   Read PINGONE_BOOTSTRAP_*    → OFF         --non-interactive to enable (CI)
 *
 * ─── How this script behaves ────────────────────────────────────────────────
 *
 *   - Pre-flights Node version (matches export/import scripts).
 *   - With a tar arg: runs scripts/importMigrationBundle.js, then runs
 *     scripts/bootstrapPingOne.js IFF the imported .env is missing
 *     PINGONE_MCP_GATEWAY_CLIENT_ID / AGENT_CLIENT_ID (older archives don't have these).
 *   - Without a tar arg: ensures banking_api_server/.env exists with a real
 *     SESSION_SECRET (so configStore can derive its config.db encryption key),
 *     then runs scripts/bootstrapPingOne.js.
 *   - The bootstrap script preserves SESSION_SECRET / CONFIG_ENCRYPTION_KEY
 *     from any pre-existing .env, so the encrypted config.db stays decryptable
 *     across reruns.
 *
 * Exit codes:
 *   0  setup completed; ./run.sh or ./run-k8.sh ready to start
 *   1  fatal error (import failed, bootstrap failed, validation, etc.)
 *   2  user aborted at bootstrap confirmation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ── Step 0 — Node version pre-flight ─────────────────────────────────────────
// Reads engines.node from the root package.json and accepts any Node major at
// or above the floor. Examples of accepted engines.node values: ">=20", "20.x",
// "20", ">=20.0.0" — the first digit run is the floor. Examples passing the
// check on a >=20 floor: 20.20.2, 22.5.0, 24.3.0.
function checkNodeVersion() {
  const ROOT_PKG = path.resolve(__dirname, '..', '..', 'package.json');
  let floor = 20;
  try {
    const engines = JSON.parse(fs.readFileSync(ROOT_PKG, 'utf8')).engines;
    const m = engines && engines.node && String(engines.node).match(/(\d+)/);
    if (m) floor = parseInt(m[1], 10);
  } catch (_e) { /* fall back to 20 */ }

  const actual = parseInt(String(process.versions.node || '').split('.')[0], 10);
  if (Number.isFinite(actual) && actual >= floor) return;

  console.error(`Node ${floor}+ required, but this shell is using Node ${process.version}.`);
  console.error('');
  console.error(`Fix (zsh/bash) — load nvm into THIS shell, then switch to Node ${floor} or newer:`);
  console.error('  export NVM_DIR="$HOME/.nvm"');
  console.error('  [ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"');
  console.error(`  nvm install ${floor} && nvm use ${floor}`);
  process.exit(1);
}

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  // We synthesize the cheat-sheet inline (rather than reusing
  // commandReferenceText()) because that helper lives further down the file,
  // after CLI-arg parsing and `checkNodeVersion()`, and we want --help to work
  // on any Node version without throwing.
  console.log(`Banking demo setup — fresh install or migration

Usage:
  npm run setup:fresh                              Brand-new user (no tar archive)
  npm run setup:fresh -- /path/to/archive.tar.gz   Migrating from another machine

Both paths converge on the same end state: a working banking_api_server/.env with
all PingOne credentials, restored data files (if a tar was provided), and the
demo ready for ./run.sh (Docker Compose) or ./run-k8.sh (Kubernetes).

What runs in each case:
  Without tar:  setupFresh -> bootstrapPingOne  (creates apps + writes .env)
  With tar:     setupFresh -> data:import -> bootstrapPingOne (only if needed)

Related commands (run from repo root):
  npm run setup:fresh                       Fresh install (this command).
  npm run setup:fresh -- <bundle.tar.gz>    Migrate from another machine.
  npm run import -- <bundle.tar.gz>         Import only — no bootstrap.
  npm run export                            Build a migration bundle into ./bundles/.
  npm run reset                             Nuke local state + PingOne env, then
                                            re-provision. = --clean --reset-pingone.
  npm run reset:import -- <bundle.tar.gz>   Same nuke, then import bundle.
  npm run pingone:bootstrap                 Provision/repair PingOne only. Idempotent.
  npm run pingone:wipe                      Type-to-confirm wipe of all Super
                                            Banking apps/resources/groups/users.
  npm run pingone:recreate                  Delete + recreate demo apps + resources.
  ./run.sh                                  Start everything — Docker Compose.
  ./run-k8.sh                               Start everything — Kubernetes.
  ./run.sh restart                          Pick up new .env values.
  ./run.sh stop / status                    Stop / health check.

Defaults this script applies (override with the listed flag):
  Confirm install dir   ON       --yes / --from-installer to skip
  Cleanup prior state   PROMPT   --clean (force) / --no-clean (skip)
  Wipe PingOne env      OFF      --reset-pingone to enable
  Recreate demo apps    OFF      --recreate-apps to enable
  Helix LLM config      PROMPT (default Yes — Enter accepts. --skip-helix to
                                 force-no. CI auto-configures from HELIX_* env
                                 vars if present, else skips silently.)
  Browser cred form     ON       --no-browser to use terminal only
  PINGONE_BOOTSTRAP_*   OFF      --non-interactive to enable (CI)

Every interactive run prints the same defaults table and asks "Continue
with these defaults? [Y/n]" before any provisioning. Press n to bail out
and re-run with one of the recipes below.

Presets (copy & paste):

  1) Fresh install on this machine (the default)
       npm run setup:fresh

  2) Migrate from another machine using a bundle
       npm run setup:fresh -- ~/banking-export-2026-XX-XX.tar.gz

  3) Full wipe + start blank (wipe local AND PingOne, then re-provision)
       npm run reset

  4) CI / scripted (no prompts; needs PINGONE_BOOTSTRAP_* + HELIX_* env vars)
       npm run setup:fresh -- --non-interactive --skip-helix

  5) Tear down everything (stop services, wipe PingOne, delete local + node_modules)
       npm run uninstall

Flags:
  --yes               Skip the install-directory confirmation prompt.
  --clean             Wipe stale state (.env, data/persistent, certs) WITHOUT prompting.
  --no-clean          Keep stale state without prompting (skip cleanup).
  --reset-pingone     NUCLEAR: wipe the PingOne environment BEFORE import/bootstrap.
                      Deletes every app, resource server, group, custom user attr,
                      and user (preserving the worker app being used to authenticate).
                      Combine with --clean for a full local + remote reset.
  --recreate-apps     Delete existing 'Super Banking *' PingOne apps + resources
                      before creating fresh ones. Less aggressive than --reset-pingone.
  --helix             Skip the y/n prompt and go straight to collecting the
                      5 Helix fields (base_url, api_key, environment_id,
                      agent_id, prompt_field_id) — interactively or from
                      HELIX_* env vars. Useful in CI when you want to require
                      Helix config and fail loudly if vars are missing.
                      (Without this flag, the prompt defaults to YES and the
                      user can press Enter to configure.)
  --skip-helix        Don't ask about Helix at all. Use when you know the agent
                      will run heuristics-only or when you'll configure later via
                      /admin/langchain-config.
  --from-installer    (Internal — set by install.sh; skips dir confirm.)
  --no-browser        Skip the localhost form; prompt in terminal only.
  --non-interactive   Read PINGONE_BOOTSTRAP_* env vars (CI).
  --reset-creds       Forget cached PingOne creds at ~/.banking-demo-creds and
                      re-prompt. Use when switching tenants or after rotating
                      the worker secret. Without this flag, after the first
                      successful prompt every future run skips cred entry.
  --skip-vault        Skip the credential vault setup phase. No prompt, no file
                      written, no .env mutation. Use when you want to defer the
                      vault to later or run the agent fully on .env values.
  --vault-password <pw>  Vault password (Phase 269). REQUIRED when the vault
                      phase runs (setupFresh does NOT prompt interactively
                      because the built-in readline does not mask password
                      input safely). WARNING: visible in /proc/<pid>/cmdline.
                      On shared machines, prefer 'export VAULT_PASSWORD=...'
                      before running setup:fresh. Use --skip-vault if you do
                      not want vault setup.
  --vault-path <path>  Override the vault file path. Default:
                      <repo-root>/secrets.vault

Helix env vars (used by --helix in non-interactive contexts):
  HELIX_BASE_URL, HELIX_API_KEY, HELIX_ENVIRONMENT_ID, HELIX_AGENT_ID,
  HELIX_PROMPT_FIELD_ID

Step 1 (you): Create a PingOne worker app with "Identity Data Admin" role.
Step 2:       Run this command. The browser pops a form for your worker creds.
Step 3:       ./run.sh           (Docker Compose)
              ./run-k8.sh        (Kubernetes)

Exit codes:
  0  Setup completed successfully
  1  Fatal error (import or bootstrap failed)
  2  User aborted at run-summary confirmation, install-dir confirm,
     bootstrap confirm, or PingOne wipe confirmation
`);
  process.exit(0);
}

checkNodeVersion();

// First non-flag argument is the tar archive path (if any).
// Exclude value tokens consumed by --vault-password and --vault-path so a
// password that doesn't start with '--' isn't mistaken for an archive path.
const _valueFlags = ['--vault-password', '--vault-path'];
const _valueFlagValues = new Set(
  _valueFlags.flatMap(f => { const i = args.indexOf(f); return i >= 0 && i + 1 < args.length ? [args[i + 1]] : []; })
);
const tarArg = args.find(a => !a.startsWith('--') && !_valueFlagValues.has(a));
// Strip flags we consume locally; everything else passes through to bootstrap.
// `--reset-pingone` is a setupFresh-specific flag: wipe the PingOne env
// BEFORE the import/bootstrap chain runs. Forwarded into bootstrap via the
// passthrough, but consumed locally too so we know to insert a wipe step.
//
// `--skip-helix` and `--helix` control the Helix LLM-config phase:
//   --skip-helix → never prompt, never configure (default behavior actually,
//                   so this flag mostly exists for explicit CI clarity)
//   --helix      → assume yes; collect creds (interactive) or read HELIX_*
//                   env vars (non-interactive)
const LOCAL_FLAGS = new Set([
  '--yes', '--clean', '--no-clean',
  '--reset-pingone',
  '--skip-helix', '--helix',
  // Phase 269 — vault setup flags. --vault-password and --vault-path
  // each consume a value token (next arg); see _stripValueFlag below.
  '--skip-vault', '--vault-password', '--vault-path',
]);
const passthroughFlags = args.filter(a => a.startsWith('--') && !LOCAL_FLAGS.has(a));

// Phase 269: --vault-password and --vault-path each consume a value token
// that does NOT start with '--', so the dash-prefixed filter above lets it
// through. Strip those value tokens explicitly so they don't reach
// bootstrapPingOne as an unrecognized positional.
function _stripValueFlag(flag) {
  const i = args.indexOf(flag);
  if (i >= 0 && i + 1 < args.length) {
    const valueToken = args[i + 1];
    const idx = passthroughFlags.indexOf(valueToken);
    if (idx >= 0) passthroughFlags.splice(idx, 1);
  }
}
_stripValueFlag('--vault-password');
_stripValueFlag('--vault-path');

const RESET_PINGONE = args.includes('--reset-pingone');
const SKIP_HELIX    = args.includes('--skip-helix');
const FORCE_HELIX   = args.includes('--helix');

// Phase 269 — vault setup
const SKIP_VAULT = args.includes('--skip-vault');
const VAULT_PASSWORD_ARG = (() => {
  const i = args.indexOf('--vault-password');
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
})();
const VAULT_PATH_ARG = (() => {
  const i = args.indexOf('--vault-path');
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
})();

// `--from-installer` is set by install.sh, which already confirmed the install
// directory with the user — skip our own dir-confirm prompt to avoid double-asking.
// `--yes` skips the dir-confirm prompt (for advanced users / scripted runs).
const FROM_INSTALLER = args.includes('--from-installer');
const SKIP_CONFIRM = FROM_INSTALLER || args.includes('--yes');
// Cleanup mode: --clean = wipe without asking, --no-clean = skip wipe without
// asking, neither = prompt (default behavior, only fires when prior state exists).
const FORCE_CLEAN = args.includes('--clean');
const SKIP_CLEAN = args.includes('--no-clean');

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const ENV_FILE = path.join(SERVER_ROOT, '.env');

// ── Transcript logging ──────────────────────────────────────────────────────
//
// Tee everything (our own console output AND every child process's stdout/
// stderr) into setup.log at the repo root. The user gets a complete record of
// what happened, including npm install verbosity and the per-step provisioning
// detail — useful when debugging "the bootstrap silently exited" type issues.
//
// Two layers:
//   1. console.log / console.error are wrapped so anything we print also lands
//      in the log file.
//   2. spawnSync children are launched with piped stdio; we then forward their
//      output to BOTH our terminal AND the log file.
//
// Stdin is left as 'inherit' for children so prompts still receive keyboard
// input.

const LOG_FILE = path.join(REPO_ROOT, 'setup.log');
let logStream = null;

function openLog() {
  // Append mode so re-runs accumulate; the banner separates runs visibly.
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  const stamp = new Date().toISOString();
  logStream.write(`\n\n${'═'.repeat(78)}\n`);
  logStream.write(`  setup:fresh run started ${stamp}\n`);
  logStream.write(`  argv: ${process.argv.slice(2).join(' ') || '(none)'}\n`);
  logStream.write(`  node: ${process.version}\n`);
  logStream.write(`  cwd:  ${process.cwd()}\n`);
  logStream.write(`${'═'.repeat(78)}\n\n`);
}

function closeLog() {
  if (logStream) try { logStream.end(); } catch (_e) {}
}

function patchConsole() {
  const origLog  = console.log.bind(console);
  const origErr  = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.log = (...args) => {
    origLog(...args);
    if (logStream) logStream.write(args.map(formatForLog).join(' ') + '\n');
  };
  console.error = (...args) => {
    origErr(...args);
    if (logStream) logStream.write('[ERR] ' + args.map(formatForLog).join(' ') + '\n');
  };
  console.warn = (...args) => {
    origWarn(...args);
    if (logStream) logStream.write('[WARN] ' + args.map(formatForLog).join(' ') + '\n');
  };
}

function formatForLog(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_e) { return String(v); }
}

// Strip ANSI escape codes so the log file is grep-friendly. Children may emit
// colored output even when not on a TTY (e.g. FORCE_COLOR set).
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s) { return s.replace(ANSI_RE, ''); }

// ── Helpers ──────────────────────────────────────────────────────────────────

function runChild(label, scriptArgs, opts = {}) {
  console.log('');
  console.log(`── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`);
  console.log('');
  if (logStream) logStream.write(`\n[CHILD START] ${label}: node ${scriptArgs.join(' ')}\n`);

  // We use spawn (not spawnSync) so we can stream the child's output as it
  // arrives — both to our terminal and to the log file. spawnSync's
  // stdio:'inherit' would skip our log pipe entirely.
  //
  // stdio[0]='ignore' detaches stdin from our parent's stdin. Under curl-pipe,
  // our stdin is the HTTP body (closed/exhausted), and inheriting that into a
  // child caused npm install / git operations to crash with EBADF when they
  // probed stdin. Children that DO need user input (bootstrapPingOne) read
  // from /dev/tty directly via the getInteractiveInput() helper, so they
  // don't depend on inherited stdin anyway.
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const child = spawn('node', scriptArgs, {
      cwd: opts.cwd || SERVER_ROOT,
      // Phase 269: honor opts.env so configureVault() can pass VAULT_PASSWORD +
      // VAULT_PATH to vault:create / vault:migrate-from-env children via env
      // (NOT argv — T-269-27 cmdline leak). Default to process.env preserves
      // existing call sites byte-for-byte (spawn's default-inherit semantics
      // is equivalent to env: process.env).
      env: opts.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const tee = (chunk, isErr) => {
      // Write to our own stdout/stderr verbatim (preserves colors for the user)
      const out = isErr ? process.stderr : process.stdout;
      out.write(chunk);
      // Strip ANSI for the log file
      if (logStream) logStream.write(stripAnsi(chunk.toString('utf8')));
    };
    child.stdout.on('data', (chunk) => tee(chunk, false));
    child.stderr.on('data', (chunk) => tee(chunk, true));

    child.on('error', (err) => {
      console.error(`Failed to spawn child: ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => {
      if (logStream) logStream.write(`\n[CHILD EXIT] ${label}: exit ${code}\n`);
      resolve(code);
    });
  });
}

// Interactive variant of runChild: inherits stdio so the child has direct
// access to the parent's TTY. Trade-off: child output bypasses our log tee
// (it's not captured to setup.log), but interactive prompts actually work.
//
// Use this for any child that needs to read keystrokes — bootstrapPingOne
// in particular. Under runChild's stdio:[pipe,pipe], the child's only
// option for keyboard input is fs.createReadStream('/dev/tty'), which
// behaves erratically when there's no controlling terminal in the child's
// process group: prompts appear, but data events never fire.
//
// Under stdio:'inherit', the child's stdin/stdout/stderr ARE the parent's,
// so process.stdin.isTTY is true, raw mode works, readline works.
function runChildInteractive(label, scriptArgs, opts = {}) {
  console.log('');
  console.log(`── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`);
  console.log('');
  if (logStream) {
    logStream.write(`\n[CHILD START] ${label} (interactive — output not captured): node ${scriptArgs.join(' ')}\n`);
  }
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const child = spawn('node', scriptArgs, {
      cwd: opts.cwd || SERVER_ROOT,
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      console.error(`Failed to spawn child: ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => {
      if (logStream) logStream.write(`\n[CHILD EXIT] ${label}: exit ${code}\n`);
      resolve(code);
    });
  });
}

// npm install needs the same tee treatment but isn't a 'node' invocation.
// Same stdin='ignore' rationale as runChild — under curl-pipe, inheriting
// stdin caused EBADF when npm probed it.
function runNpmInstall(cwd) {
  const { spawn } = require('child_process');
  console.log(`  Running npm install in ${cwd}...`);
  if (logStream) logStream.write(`\n[NPM START] cwd=${cwd}\n`);
  return new Promise((resolve) => {
    const child = spawn('npm', ['install'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const tee = (chunk, isErr) => {
      const out = isErr ? process.stderr : process.stdout;
      out.write(chunk);
      if (logStream) logStream.write(stripAnsi(chunk.toString('utf8')));
    };
    child.stdout.on('data', (c) => tee(c, false));
    child.stderr.on('data', (c) => tee(c, true));
    child.on('error', (err) => {
      console.error(`Failed to spawn npm: ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => {
      if (logStream) logStream.write(`\n[NPM EXIT] cwd=${cwd}: exit ${code}\n`);
      resolve(code);
    });
  });
}

// ── Status banners ──────────────────────────────────────────────────────────
//
// Visual structure for the multi-phase setup so the user always knows
// where in the flow they are. Each phase has a numbered banner; results
// (success/skip/fail) print on completion.

function banner(text) {
  const width = Math.max(60, text.length + 4);
  const line = '═'.repeat(width);
  console.log('');
  console.log(line);
  console.log(`  ${text}`);
  console.log(line);
  console.log('');
}

function phase(num, total, text) {
  console.log('');
  console.log(`▶ STEP ${num}/${total} — ${text}`);
  console.log(`  ${'─'.repeat(Math.max(0, 60 - 2))}`);
}

function ok(text)   { console.log(`✓ ${text}`); }
function skip(text) { console.log(`○ ${text}`); }
function fail(text) { console.log(`✗ ${text}`); }

// ── npm install pre-flight ──────────────────────────────────────────────────
//
// Without node_modules, bootstrapPingOne fails silently when it tries to
// require('axios') etc. importMigrationBundle has its own pre-flight; we
// add the same one to the fresh-install path so it doesn't matter which
// route the user came in on.

async function ensureDependencies() {
  const nm = path.join(SERVER_ROOT, 'node_modules');
  if (fs.existsSync(nm)) return { installed: false };

  console.log('');
  console.log(`  banking_api_server/node_modules not found.`);
  console.log('');
  const status = await runNpmInstall(SERVER_ROOT);
  if (status !== 0) {
    fail(`npm install failed (exit ${status}). Fix the error above and retry.`);
    process.exit(1);
  }
  return { installed: true };
}

function envHas(envText, key) {
  // WR-04: escape regex metacharacters in `key` so callers passing keys with
  // `.` `$` etc. don't accidentally match unintended lines. Keeping the
  // \S anchor preserves the existing semantic that an empty `KEY=` line does
  // NOT count as "has key" (the caller uses this to decide whether to write).
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}=\\S`, 'm').test(envText);
}

function readEnvSafely() {
  try { return fs.readFileSync(ENV_FILE, 'utf8'); }
  catch (_e) { return null; }
}

// Seed DEMO_MORTGAGE_SERVICE_KEY into the BFF .env if absent, so vault-migrate
// has a value to copy into the vault on a clean install. The default matches
// the mortgage service's own fallback — both sides use the same key unless an
// operator changes them in lockstep.
function seedMortgageKey() {
  const existing = readEnvSafely() || '';
  if (envHas(existing, 'DEMO_MORTGAGE_SERVICE_KEY')) return;
  const line = 'DEMO_MORTGAGE_SERVICE_KEY=demo-mortgage-key-0000\n';
  fs.appendFileSync(ENV_FILE, existing.endsWith('\n') ? line : `\n${line}`);
}

function ensureEnvForFreshInstall() {
  const existing = readEnvSafely();
  if (existing && envHas(existing, 'SESSION_SECRET')) {
    return { created: false, existed: true };
  }

  // Write a minimal stub so configStore can derive its encryption key. The
  // bootstrap step will rewrite this file with full PingOne credentials and
  // preserve the SESSION_SECRET we generate here.
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const stub = [
    '# Bootstrap stub — generated by setup:fresh',
    '# bootstrapPingOne preserves SESSION_SECRET on rewrite (so config.db stays decryptable).',
    `SESSION_SECRET=${sessionSecret}`,
    '',
  ].join('\n');

  if (existing) {
    // Existing .env is missing SESSION_SECRET — append rather than overwrite.
    fs.writeFileSync(ENV_FILE, `${existing.replace(/\n*$/, '\n')}${stub}`, 'utf8');
    return { created: false, appended: true };
  }
  fs.writeFileSync(ENV_FILE, stub, 'utf8');
  return { created: true };
}

// ── Cleanup of prior installation state ─────────────────────────────────────
//
// A re-run of setup:fresh against a partial install (or stale config) can fail
// in confusing ways:
//   - existing config.db encrypted with an old key won't decrypt against a
//     freshly generated SESSION_SECRET
//   - certs from a prior hostname (api.pingdemo.com+2.pem) get picked up by
//     run-demo.sh and confuse mkcert detection
//   - leftover sessions.db carries logged-in state from another tenant
//
// We detect those, list them to the user, and ask once whether to wipe before
// continuing. Default: skip cleanup (so reruns against intentionally-preserved
// state, like a partial bootstrap, don't lose work). Wipe always backs up .env
// to .env.pre-cleanup-<timestamp> first so the user can recover.

const CLEANUP_TARGETS = [
  // path-relative-to-SERVER_ROOT, label, optional description
  { p: '.env',                                label: 'Server env file' },
  { p: 'data/persistent',                     label: 'Persistent data dir', isDir: true },
  { p: 'data/sessions.db',                    label: 'Active sessions DB' },
  { p: 'data/backups',                        label: 'Pre-import backups',  isDir: true },
];
// Cert dir is sibling of SERVER_ROOT; handled separately.

function findExistingState() {
  const found = [];
  for (const t of CLEANUP_TARGETS) {
    const abs = path.join(SERVER_ROOT, t.p);
    if (fs.existsSync(abs)) {
      // For dirs, only count as "existing state" if non-empty.
      if (t.isDir) {
        try {
          const entries = fs.readdirSync(abs);
          if (entries.length > 0) found.push({ ...t, abs, count: entries.length });
        } catch (_e) { /* unreadable — skip */ }
      } else {
        found.push({ ...t, abs });
      }
    }
  }
  // Certs: detect any *.pem in the certs dir
  const certsDir = path.join(REPO_ROOT, 'certs');
  if (fs.existsSync(certsDir)) {
    try {
      const pems = fs.readdirSync(certsDir).filter(f => f.endsWith('.pem'));
      if (pems.length > 0) found.push({ p: '../certs', label: 'TLS certs', isDir: true, abs: certsDir, count: pems.length });
    } catch (_e) { /* skip */ }
  }
  return found;
}

async function offerCleanup() {
  const found = findExistingState();
  if (found.length === 0) return;     // nothing to clean — silent

  console.log('');
  console.log('Existing state detected');
  console.log('───────────────────────');
  for (const item of found) {
    const desc = item.count != null ? ` (${item.count} item${item.count === 1 ? '' : 's'})` : '';
    console.log(`  • ${item.label}: ${item.abs}${desc}`);
  }
  console.log('');
  console.log('Wiping these gives you a clean slate. Recommended if:');
  console.log('  - this is a re-run after a failed install');
  console.log('  - you changed the PingOne tenant since last setup');
  console.log('  - run.sh / run-k8.sh is reporting decrypt or hostname errors');
  console.log('');
  console.log('Skip cleanup if you want to preserve current data and only re-run bootstrap.');
  console.log('');

  let wipe;
  if (FORCE_CLEAN) {
    console.log('--clean flag set — wiping without prompting.');
    wipe = true;
  } else if (SKIP_CLEAN) {
    console.log('--no-clean flag set — skipping cleanup.');
    wipe = false;
  } else {
    wipe = await readlineQuestion('Wipe and start fresh?', /* defaultYes */ false);
  }

  if (!wipe) {
    console.log('Continuing without cleanup. Existing state preserved.');
    console.log('');
    return;
  }

  // Backup .env first if it exists, so the user has a recovery path.
  const envPath = path.join(SERVER_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${envPath}.pre-cleanup-${ts}`;
    fs.copyFileSync(envPath, backup);
    console.log(`Backed up .env to ${path.basename(backup)}`);
  }

  for (const item of found) {
    try {
      if (item.isDir) {
        fs.rmSync(item.abs, { recursive: true, force: true });
        // Recreate empty dir for the persistent data path so import scripts find it
        if (item.p === 'data/persistent') fs.mkdirSync(item.abs, { recursive: true });
        console.log(`Removed ${item.label}: ${item.abs}`);
      } else {
        fs.unlinkSync(item.abs);
        console.log(`Removed ${item.label}: ${item.abs}`);
      }
    } catch (err) {
      console.error(`Failed to remove ${item.abs}: ${err.message}`);
      console.error('Continuing anyway — bootstrap may fail. Re-run with --no-clean to skip this prompt.');
    }
  }
  console.log('');
}

// ── Helix LLM configuration ─────────────────────────────────────────────────
//
// PingOne Helix Agents are the recommended LLM provider for this demo's
// natural-language UX. Without one, the agent runs heuristic-only and falls
// through to the generic fallback message on inputs the regex doesn't catch.
//
// This phase asks the user (default YES — Helix is the recommended setup)
// whether they want to wire Helix creds during setup. On yes, prompts for the
// 5 fields the runtime reads (helix_base_url, helix_api_key,
// helix_environment_id, helix_agent_id, helix_prompt_field_id) and persists
// them to configStore (which encrypts the api_key at rest using
// SESSION_SECRET / CONFIG_ENCRYPTION_KEY).
//
// Non-interactive mode (no TTY, e.g. --from-installer + curl-pipe, CI):
// auto-configures from HELIX_* env vars when present, else skips silently —
// matches how PINGONE_BOOTSTRAP_* works. To force-collect creds in CI, pass
// --helix and provide HELIX_BASE_URL / HELIX_API_KEY / HELIX_ENVIRONMENT_ID /
// HELIX_AGENT_ID / HELIX_PROMPT_FIELD_ID.

function helixEnvVarsPresent() {
  return Boolean(
    process.env.HELIX_BASE_URL &&
    process.env.HELIX_API_KEY &&
    process.env.HELIX_ENVIRONMENT_ID &&
    process.env.HELIX_AGENT_ID &&
    process.env.HELIX_PROMPT_FIELD_ID
  );
}

async function configureHelix() {
  if (SKIP_HELIX) {
    skip('Helix configuration skipped (--skip-helix)');
    return;
  }

  // Keyfile fast-path: if the user dropped the downloaded <agentName>.json
  // (e.g. LLM.json) in the repo root / ~/Documents / ~/Downloads, migrate
  // its key into the vault + SQLite once and skip the 5-field prompt. Falls
  // through to the existing prompt flow when no keyfile is found. Idempotent
  // (no-op if a key is already configured) and best-effort (a failure here
  // never aborts setup — the prompt flow still runs).
  try {
    const configStore = require('../services/configStore');
    await configStore.ensureInitialized();
    const { loadAgentKey } = require('../services/helixAgentKeyLoader');
    const agentName = process.env.HELIX_AGENT_ID
      || configStore.get('helix_agent_id') || 'LLM';
    if (loadAgentKey(agentName)) {
      console.log(`  ✓ Found ${agentName}.json — importing Helix API key automatically...`);
      const { migrateHelixKey } = require('../services/helixKeyMigration');
      const vaultPassword = SKIP_VAULT
        ? undefined
        : (VAULT_PASSWORD_ARG || process.env.VAULT_PASSWORD);
      const path = require('path');
      const vaultPath = VAULT_PATH_ARG
        || process.env.VAULT_PATH
        || path.join(path.resolve(__dirname, '..', '..'), 'secrets.vault');
      const m = await migrateHelixKey({ agentName, vaultPath, vaultPassword });
      if (m.migrated) {
        await configStore.setConfig({ provider: 'helix' });
        ok(`Helix is configured and ready (key imported from ${agentName}.json).`);
        return;
      }
      if (m.reason === 'already_present') {
        ok('Helix is already configured — no changes needed.');
        return;
      }
    }
  } catch (err) {
    fail(`Helix keyfile migration skipped: ${err.message}`);
    console.log('  (Setup continues with the normal Helix prompt flow.)');
  }

  // Non-interactive (no TTY, no --helix): auto-configure if HELIX_* env vars
  // are present, otherwise skip silently. Mirrors PINGONE_BOOTSTRAP_*.
  const interactive = isInteractiveStdin();
  if (!interactive && !FORCE_HELIX) {
    if (helixEnvVarsPresent()) {
      // Fall through to the field-collection block; it already reads from env.
    } else {
      skip('Helix not configured (non-interactive, HELIX_* env vars not set) — agent will run heuristics-only');
      return;
    }
  }

  // Decide whether to prompt. --helix forces yes; HELIX_* env-var auto-config
  // path skips the prompt; otherwise ASK the user (default YES).
  let proceed = FORCE_HELIX || (!interactive && helixEnvVarsPresent());
  if (!proceed) {
    console.log('');
    console.log('  PingOne Helix Agents power the natural-language UX in the banking agent.');
    console.log('  Without one, the agent runs heuristic-only — it answers common phrases');
    console.log('  ("balance", "show my accounts", "recent transactions", education topics)');
    console.log('  but falls through on free-form natural language.');
    console.log('');
    console.log('  Need: a Helix agent + API key from your PingOne tenant.');
    console.log('  Find them at: https://console.pingone.com → Helix → Agents.');
    console.log('');
    proceed = await readlineQuestion('Configure Helix LLM now?', /* defaultYes */ true);
  }

  if (!proceed) {
    skip('Helix not configured — agent will run heuristics-only (configure later via /admin/langchain-config)');
    return;
  }

  // The only thing setup needs from the user is the Helix API key.
  // All other fields (base URL, environment ID, agent ID, prompt field ID)
  // have known defaults in configStore and don't need to be entered manually.
  //
  // Preferred path: user downloads LLM.json from Helix and drops it in the
  // repo root — the keyfile fast-path above already handles that and returns
  // before we reach here. We only reach this block when no keyfile was found.
  console.log('');
  console.log('  To connect Helix, generate an API key in the PingOne console:');
  console.log('  1. Open https://console.pingone.com → AI → Helix → Agents');
  console.log('  2. Create (or open) an agent named  LLM');
  console.log('  3. Under Secret API Keys → click "Create Secret API Key"');
  console.log('  4. Download the JSON file and drop it in the repo root as LLM.json');
  console.log('');
  console.log('  If LLM.json is already in the repo root, just press Enter —');
  console.log('  it will be detected and imported automatically.');
  console.log('');
  console.log('  — OR — paste the key value at the prompt below.');
  console.log('');
  console.log('  Press Enter to skip and configure Helix later from /admin/langchain-config.');
  console.log('');

  const apiKeyFromEnv = process.env.HELIX_API_KEY;
  let apiKey = apiKeyFromEnv;
  if (apiKey) {
    console.log(`  Helix API Key: ${maskSecret(apiKey)}  (from $HELIX_API_KEY)`);
  } else {
    apiKey = await readlineFreeText('Helix API Key (or press Enter to skip)');
    if (!apiKey) {
      skip('Helix configuration skipped — configure later via /admin/langchain-config');
      return;
    }
  }

  // Use known defaults for all other fields; allow env overrides.
  const values = {
    helix_base_url:        process.env.HELIX_BASE_URL        || 'https://openam-helix.forgeblocks.com',
    helix_environment_id:  process.env.HELIX_ENVIRONMENT_ID  || 'fe213c3c-9c1d-4bdb-954a-a22879dad26d',
    helix_agent_id:        process.env.HELIX_AGENT_ID        || 'LLM',
    helix_prompt_field_id: process.env.HELIX_PROMPT_FIELD_ID || 'textInput502c5045a61c',
    helix_api_key:         apiKey,
  };

  // Persist via configStore. setConfig encrypts api_key at rest (it's in
  // configStore's SECRET_KEYS list). Set provider=helix so parseNaturalLanguage
  // routes to it instead of falling back to ollama.
  try {
    const configStore = require('../services/configStore');
    await configStore.ensureInitialized();
    await configStore.setConfig({
      ...values,
      provider: 'helix',
    });
    ok('Helix configuration saved (provider = helix)');
    console.log(`     base_url:      ${values.helix_base_url}`);
    console.log(`     environment:   ${values.helix_environment_id}`);
    console.log(`     agent:         ${values.helix_agent_id}`);
    console.log(`     prompt field:  ${values.helix_prompt_field_id}`);
    console.log(`     api_key:       ${maskSecret(values.helix_api_key)}`);
  } catch (err) {
    fail(`Failed to persist Helix configuration: ${err.message}`);
    console.log('  (Setup continues — re-configure later via /admin/langchain-config.)');
  }
}

function maskSecret(s) {
  const v = String(s || '');
  if (v.length <= 6) return '***';
  return v.slice(0, 3) + '…' + v.slice(-2);
}

/**
 * Phase 269 — vault setup phase. Pure-ish: all collaborators are injectable
 * for unit testing. Defaults resolve to the module-scoped helpers so the
 * production call site `await configureVault()` is unchanged.
 *
 * On success: returns { ok: true }.
 * On fail-fast (interactive + no password): returns { ok: false, reason: '...' }
 * — the caller (main()) decides whether to process.exit(1). Keeping process.exit
 * out of the function makes it unit-testable without killing the test runner.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.password]       Default: VAULT_PASSWORD_ARG || process.env.VAULT_PASSWORD
 * @param {string}   [opts.vaultPath]      Default: VAULT_PATH_ARG || REPO_ROOT/secrets.vault
 * @param {string}   [opts.envFile]        Default: ENV_FILE (banking_api_server/.env)
 * @param {boolean}  [opts.interactive]    Default: isInteractiveStdin()
 * @param {Function} [opts.runChild]       Default: module-scoped runChild
 * @param {Function} [opts.readQuestion]   Default: readlineQuestion
 * @param {Function} [opts.ok]             Default: ok() log helper
 * @param {Function} [opts.skip]           Default: skip() log helper
 * @param {Function} [opts.fail]           Default: fail() log helper (does NOT exit)
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function configureVault(opts = {}) {
  // Use 'password' in opts (not opts.password !== undefined) so that a caller
  // explicitly passing password:undefined means "no password" and bypasses the
  // env fallback. This matters for unit tests that inject opts to verify the
  // no-password branch without a live VAULT_PASSWORD env var leaking in.
  const password = ('password' in opts)
    ? opts.password
    : (VAULT_PASSWORD_ARG || process.env.VAULT_PASSWORD);
  const vaultPath = opts.vaultPath
    || VAULT_PATH_ARG
    || path.join(REPO_ROOT, 'secrets.vault');
  const envFile = opts.envFile || ENV_FILE;
  const interactive = opts.interactive !== undefined
    ? opts.interactive
    : isInteractiveStdin();
  const _runChild = opts.runChild || runChild;
  // _readQuestion is intentionally declared but only used in the
  // explicit-consent branch below — kept for future expansion / DI symmetry.
  const _readQuestion = opts.readQuestion || readlineQuestion;
  const _ok = opts.ok || ok;
  const _skip = opts.skip || skip;
  const _fail = opts.fail || fail;

  // T-269-29: re-run safety — if vault already exists at the configured path,
  // skip without prompting (no overwrite). Operator must `vault:rotate` or
  // delete first.
  if (fs.existsSync(vaultPath)) {
    _skip(`vault present at ${vaultPath} — skipping creation`);
    return { ok: true };
  }

  // If no password was supplied via flag or env, prompt the user interactively.
  // Input is not masked (readline limitation) — we warn the user.
  // Leaving it blank skips vault setup.
  let resolvedPassword = password;
  if (!resolvedPassword) {
    if (!interactive) {
      _skip('no --vault-password and no VAULT_PASSWORD env — skipping vault setup');
      return { ok: true };
    }
    console.log('  Note: input will be visible as you type.');
    const entered = await readlineFreeText('Vault password (leave blank to skip vault setup)');
    if (!entered) {
      _skip('vault setup skipped — run with --vault-password <pw> to set it up later.');
      return { ok: true };
    }
    resolvedPassword = entered;
  }

  // Create the empty vault via Plan 02's vault:create subcommand.
  // runChild uses stdio:['ignore',...] so child stdin is /dev/null — vault:create
  // is specifically designed for this (no stdin read, password from env).
  // VAULT_PASSWORD + VAULT_PATH go through env (NOT argv — T-269-27).
  let r = await _runChild('vault-create', [
    'scripts/vault.js', 'create',
  ], {
    env: { ...process.env, VAULT_PASSWORD: resolvedPassword, VAULT_PATH: vaultPath },
  });
  if (r !== 0) {
    _fail(`vault creation failed (exit ${r})`);
    return { ok: false, reason: 'create-failed' };
  }

  // T-269-28: migrate the just-bootstrapped .env secrets into the new vault.
  // Failure here fails the whole setup phase — no half-state where vault
  // exists but secrets weren't copied.
  r = await _runChild('vault-migrate', [
    'scripts/vault-migrate.js',
  ], {
    env: { ...process.env, VAULT_PASSWORD: resolvedPassword, VAULT_PATH: vaultPath },
  });
  if (r !== 0) {
    _fail(`vault migration failed (exit ${r})`);
    return { ok: false, reason: 'migrate-failed' };
  }

  // Persist VAULT_PATH (but NEVER VAULT_PASSWORD) into banking_api_server/.env
  // so run-demo.sh finds it next boot. banking_mcp_gateway/.env is typically a
  // SYMLINK to this same file (created by run-demo.sh's ensure_service_env
  // helper — see Plan 04 SUMMARY), so the gateway sees the same VAULT_PATH
  // automatically.
  //
  // WR-03: validate vaultPath cannot inject extra .env lines (newline) or
  // confuse parsing (=, #). setupFresh otherwise trusts its --vault-path arg
  // (T-269-27 documented), but the .env write needs the same scrutiny.
  if (/[\r\n=#]/.test(vaultPath)) {
    _fail(`Invalid vault path (cannot contain newline, =, or #): ${vaultPath}`);
    return { ok: false, reason: 'invalid-vault-path' };
  }
  const envText = (() => {
    try {
      return fs.readFileSync(envFile, 'utf8');
    } catch (_e) {
      return '';
    }
  })();
  if (!envHas(envText, 'VAULT_PATH')) {
    // WR-03: atomic write — tmp + rename — so a SIGKILL mid-append cannot
    // leave the .env corrupt. Preserve trailing-newline normalization.
    const newText = `${envText.replace(/\n*$/, '\n')}VAULT_PATH=${vaultPath}\n`;
    const tmp = envFile + '.tmp';
    fs.writeFileSync(tmp, newText);
    fs.renameSync(tmp, envFile);
  }
  _ok(`Vault created at ${vaultPath}; migrated secrets from .env`);
  return { ok: true };
}

// Return true only if we can actually read from a terminal. The naive check
// fs.existsSync('/dev/tty') returns true on macOS even when stdin is piped
// AND there's no controlling terminal (e.g. `echo n | node script` from a
// detached shell), and trying to open /dev/tty in that state throws ENXIO.
// Test the open up front so callers can pick a non-interactive path safely.
function isInteractiveStdin() {
  if (process.stdin.isTTY) return true;
  try {
    const fd = fs.openSync('/dev/tty', 'r');
    fs.closeSync(fd);
    return true;
  } catch (_e) {
    return false;
  }
}

// ── Install-directory confirmation ──────────────────────────────────────────
//
// Tell the user where setup will land and let them abort if it's the wrong
// place. Default is "yes" — typing nothing or "y" proceeds; anything else
// aborts cleanly (so the user can `cd` somewhere else and re-run).
// Skipped under --from-installer (install.sh already confirmed) and --yes.

async function confirmInstallDirectory() {
  if (SKIP_CONFIRM) return true;

  console.log('');
  console.log('Install location');
  console.log('────────────────');
  console.log(`  Repo root:  ${REPO_ROOT}`);
  console.log(`  Will write to:`);
  console.log(`    - ${path.join(SERVER_ROOT, '.env')}`);
  console.log(`    - ${path.join(SERVER_ROOT, 'data/persistent/')}*`);
  console.log(`    - ${path.join(REPO_ROOT, 'certs/')}* (if missing)`);
  console.log('');

  const ok = await readlineQuestion('Proceed in this directory?', /* defaultYes */ true);
  if (!ok) {
    console.log('');
    console.log('Aborted. To install elsewhere:');
    console.log('  1. cd to the directory you want');
    console.log('  2. git clone https://github.com/curtismu7/AI-demo.git');
    console.log('  3. cd AI-demo && npm run setup:fresh');
    console.log('');
    console.log('Or use the standalone installer:');
    console.log('  curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash');
    process.exit(2);
  }
  return true;
}

// ── /etc/hosts pre-check ─────────────────────────────────────────────────────
//
// The demo serves on api.ping.demo (loopback). Without the matching /etc/hosts
// entry, the browser fails to load https://api.ping.demo:4000 after setup
// completes — confusing because the bootstrap (which binds 127.0.0.1) succeeds.
// We check upfront, prompt to fix, and on macOS open Terminal.app with the
// sudo command pre-typed so the user runs it without leaving the flow.

const APP_HOST = 'api.ping.demo';
const HOSTS_FILE = '/etc/hosts';
const HOSTS_LINE = `127.0.0.1  ${APP_HOST}`;

function hostsEntryPresent() {
  try {
    const txt = fs.readFileSync(HOSTS_FILE, 'utf8');
    // Match any line that maps a 127.x address to APP_HOST.
    const re = new RegExp(`^\\s*127\\.[0-9.]+\\s+(?:[^\\s#]+\\s+)*${APP_HOST.replace(/\./g, '\\.')}(?:\\s|$)`, 'm');
    return re.test(txt);
  } catch (_e) { return false; }
}

function readlineQuestion(question, defaultYes = true) {
  return new Promise((resolve) => {
    const readline = require('readline');

    // Under `curl ... | bash`, stdin is the HTTP body — not the keyboard. The
    // bash that spawned us inherits that closed/exhausted stdin to node, so
    // process.stdin.isTTY is false and rl.question would resolve immediately
    // with empty input. The user's keyboard is at /dev/tty in that case.
    //
    // We let fs.createReadStream open and own the fd (autoClose: true). An
    // earlier version did fs.openSync + fs.createReadStream with the explicit
    // fd, then fs.closeSync after rl.close() — that closed the fd while the
    // ReadStream still held a reference, and the next subprocess spawn (npm
    // install) would crash with EBADF: bad file descriptor when the stream's
    // dangling read handler fired in a microtask.
    let input = process.stdin;
    let openedTty = false;
    if (!process.stdin.isTTY) {
      try {
        input = fs.createReadStream('/dev/tty');
        openedTty = true;
        // Catch async open errors (e.g. ENXIO when no controlling terminal)
        // so they don't crash the process. fall back to default.
        input.on('error', (err) => {
          console.log(`(could not open /dev/tty: ${err.code || err.message} — using default ${defaultYes ? 'Yes' : 'No'})`);
          try { input.destroy(); } catch (_e) {}
          resolve(defaultYes);
        });
      } catch (_e) {
        console.log(`(no TTY available — using default ${defaultYes ? 'Yes' : 'No'})`);
        return resolve(defaultYes);
      }
    }

    const rl = readline.createInterface({ input, output: process.stdout, terminal: true });
    const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
    rl.question(question + suffix, (answer) => {
      rl.close();
      // Destroy the read stream so its fd is released cleanly. autoClose
      // closes the fd when destroy() runs; no manual closeSync needed.
      if (openedTty) try { input.destroy(); } catch (_e) {}
      const s = String(answer || '').trim().toLowerCase();
      if (!s) return resolve(defaultYes);
      resolve(/^y(es)?$/.test(s));
    });
  });
}

/**
 * Free-text variant of readlineQuestion. Returns the trimmed answer string
 * (or `defaultValue` on empty input). `secret: true` doesn't actually hide
 * input on this terminal — see note below — but it does mark the field so
 * the value can be masked when echoed back.
 *
 * Note on secret handling: real password-style hidden input on a fresh
 * /dev/tty stream requires raw-mode + manual char echo, which doesn't work
 * cleanly across all terminals (bash 3.2 / non-TTY parents / etc). For the
 * Helix API key prompt we accept that the value is briefly visible while
 * being typed — same tradeoff as the existing /etc/hosts sudo prompt where
 * the user's password gets typed into Terminal.app.
 */
function readlineFreeText(question, { defaultValue = '', secret = false } = {}) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const promptStr = `${question}${suffix}: `;

    let input = process.stdin;
    let openedTty = false;
    if (!process.stdin.isTTY) {
      try {
        input = fs.createReadStream('/dev/tty');
        openedTty = true;
        input.on('error', (err) => {
          console.log(`(could not open /dev/tty: ${err.code || err.message} — using default '${defaultValue}')`);
          resolve(defaultValue);
        });
      } catch (_e) {
        return resolve(defaultValue);
      }
    }
    const rl = readline.createInterface({ input, output: process.stdout, terminal: true });
    rl.question(promptStr, (answer) => {
      rl.close();
      if (openedTty) try { input.destroy(); } catch (_e) {}
      const s = String(answer || '').trim();
      resolve(s || defaultValue);
    });
  });
}

function openTerminalWithCommand(command) {
  if (process.platform !== 'darwin') return false;
  // osascript: open Terminal.app, run a new tab, send keystrokes (so the user
  // sees the command pre-typed and just hits Enter / types their password).
  // We use 'do script' which both opens a window AND types the text. The user
  // still has to press Enter — gives them a chance to read what's about to run.
  const escaped = command.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
  const script = `tell application "Terminal" to do script "${escaped}"
tell application "Terminal" to activate`;
  try {
    const result = spawnSync('osascript', ['-e', script], { stdio: 'ignore' });
    return result.status === 0;
  } catch (_e) { return false; }
}

async function ensureHostsEntry() {
  if (hostsEntryPresent()) return true;

  console.log('');
  console.log(`The ${APP_HOST} loopback entry is missing from /etc/hosts.`);
  console.log('');
  console.log('Why this matters: the demo serves on https://api.ping.demo:4000. Without the');
  console.log(`/etc/hosts entry your browser will fail to reach it after setup completes.`);
  console.log('');
  console.log('Required line:');
  console.log(`  ${HOSTS_LINE}`);
  console.log('');

  const proceed = await readlineQuestion('Add it now via sudo?', /* defaultYes */ true);
  if (!proceed) {
    console.log('');
    console.log('Skipping. Add it yourself before opening the browser:');
    console.log(`  echo '${HOSTS_LINE}' | sudo tee -a /etc/hosts`);
    console.log('');
    return false;
  }

  const sudoCmd = `echo '${HOSTS_LINE}' | sudo tee -a /etc/hosts`;

  if (process.platform === 'darwin') {
    console.log('');
    console.log('Opening Terminal.app with the sudo command pre-typed.');
    console.log('Press Enter in that window, then your sudo password.');
    const opened = openTerminalWithCommand(sudoCmd);
    if (!opened) {
      console.log('');
      console.log('Could not open Terminal.app. Run this command yourself:');
      console.log(`  ${sudoCmd}`);
    }
  } else {
    console.log('');
    console.log('Run this in another terminal (or here, then re-run setup:fresh):');
    console.log(`  ${sudoCmd}`);
    console.log('');
  }

  // Poll /etc/hosts every 2 seconds for up to 2 minutes.
  console.log('Waiting for /etc/hosts to be updated (Ctrl-C to skip)...');
  const deadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    if (hostsEntryPresent()) {
      console.log(`✅ ${APP_HOST} entry found.`);
      console.log('');
      return true;
    }
    process.stdout.write('.');
  }
  console.log('');
  console.log('Timed out waiting. Continuing setup — re-run setup:fresh after adding the entry.');
  console.log('');
  return false;
}

async function ensureMkcert() {
  const { execSync, spawnSync } = require('child_process');
  const certsDir = path.join(REPO_ROOT, 'certs');
  const certFile = path.join(certsDir, 'api.ping.demo+2.pem');
  const keyFile  = path.join(certsDir, 'api.ping.demo+2-key.pem');

  // Step 1: install mkcert binary if missing
  const hasMkcert = () => {
    try { execSync('mkcert -version', { stdio: 'ignore' }); return true; } catch (_) { return false; }
  };
  if (!hasMkcert()) {
    const hasBrew = () => {
      try { execSync('brew --version', { stdio: 'ignore' }); return true; } catch (_) { return false; }
    };
    if (hasBrew()) {
      console.log('  Installing mkcert via Homebrew...');
      const r = spawnSync('brew', ['install', 'mkcert'], { stdio: ['ignore', 'pipe', 'pipe'] });
      if (r.status !== 0) {
        warn('brew install mkcert failed — ask your admin to install mkcert and run: mkcert -install');
        return;
      }
      ok('mkcert installed via Homebrew');
    } else {
      warn('mkcert and Homebrew not found. Ask your admin to install mkcert, then run: mkcert -install');
      return;
    }
  }

  // Step 2: install root CA if not yet trusted
  const caRoot = (() => {
    try { return execSync('mkcert -CAROOT', { encoding: 'utf8' }).trim(); } catch (_) { return ''; }
  })();
  const caKey = caRoot ? path.join(caRoot, 'rootCA-key.pem') : '';
  if (!caKey || !fs.existsSync(path.join(caRoot, 'rootCA.pem'))) {
    console.log('  Installing mkcert root CA (requires sudo)...');
    const r = spawnSync('sudo', ['mkcert', '-install'], { stdio: 'inherit' });
    if (r.status !== 0) {
      warn('Could not install mkcert root CA. Ask your admin to run: sudo mkcert -install');
      return;
    }
    // Fix ownership so user can generate certs without sudo going forward
    if (caRoot) spawnSync('sudo', ['chown', '-R', process.env.USER || process.env.LOGNAME || 'root', caRoot], { stdio: 'ignore' });
    ok('mkcert root CA installed');
  } else {
    skip('mkcert root CA already installed');
  }

  // Step 3: copy rootCA.pem into certs/ so nginx (docker compose ui) can trust it
  const rootCaPem = caRoot ? path.join(caRoot, 'rootCA.pem') : '';
  const certsDirRootCa = path.join(certsDir, 'rootCA.pem');
  if (rootCaPem && fs.existsSync(rootCaPem) && !fs.existsSync(certsDirRootCa)) {
    try {
      fs.mkdirSync(certsDir, { recursive: true });
      fs.copyFileSync(rootCaPem, certsDirRootCa);
      ok('Copied mkcert rootCA.pem into certs/ for nginx');
    } catch (e) {
      console.warn(`⚠  Could not copy rootCA.pem into certs/: ${e.message}`);
    }
  } else if (fs.existsSync(certsDirRootCa)) {
    skip('certs/rootCA.pem already present');
  }

  // Step 4: generate certs if missing
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    console.log('  Generating TLS certs for api.ping.demo...');
    fs.mkdirSync(certsDir, { recursive: true });
    const r = spawnSync('mkcert', ['api.ping.demo', 'localhost', '127.0.0.1'], { cwd: certsDir, stdio: 'inherit' });
    if (r.status !== 0) {
      warn('mkcert cert generation failed — check output above');
      return;
    }
    ok('TLS certs generated in certs/');
  } else {
    skip('TLS certs already present');
  }
}

// ── Docker + kubectl pre-check ────────────────────────────────────────────────
//
// Neither Docker nor kubectl is required for setup:fresh itself (which only
// provisions PingOne and writes .env). They ARE required to run the demo via
// docker compose or run-k8.sh. We warn if they're absent and offer to open
// the OrbStack install page so the user can set them up before starting.
async function checkDockerK8s() {
  const { execSync } = require('child_process');
  const has = cmd => { try { execSync(cmd, { stdio: 'ignore' }); return true; } catch (_) { return false; } };

  const hasDocker  = has('docker version');
  const hasKubectl = has('kubectl version --client');

  if (hasDocker && hasKubectl) {
    skip('Docker and kubectl already installed');
    return;
  }

  const missing = [!hasDocker && 'Docker', !hasKubectl && 'kubectl'].filter(Boolean);
  console.warn(`⚠  ${missing.join(' and ')} not found on PATH.`);
  console.log('');
  console.log('  Docker and kubectl are required to run the demo via:');
  console.log('    docker compose up     (local compose)');
  console.log('    ./run-k8.sh           (Kubernetes)');
  console.log('');
  console.log('  Recommended: install OrbStack (Docker + Kubernetes in one app for Mac):');
  console.log('    brew install orbstack');
  console.log('  Then open OrbStack → Settings → Kubernetes → Enable Kubernetes.');
  console.log('');

  if (!process.stdin.isTTY) {
    console.log('  (non-interactive — skipping install prompt)');
    return;
  }

  const install = await readlineQuestion('Install OrbStack via Homebrew now?', /* defaultYes */ true);
  if (!install) {
    skip('Skipping OrbStack install — run `brew install orbstack` when ready');
    return;
  }

  const hasBrew = has('brew --version');
  if (!hasBrew) {
    console.warn('⚠  Homebrew not found. Install Homebrew first: https://brew.sh');
    skip('Cannot install OrbStack without Homebrew');
    return;
  }

  console.log('  Running: brew install orbstack ...');
  const { spawnSync } = require('child_process');
  const r = spawnSync('brew', ['install', 'orbstack'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.warn('⚠  brew install orbstack failed — install manually from https://orbstack.dev');
    return;
  }
  ok('OrbStack installed — open it and enable Kubernetes in Settings → Kubernetes');
}

// ── CodeGraph index builder ───────────────────────────────────────────────────
//
// Runs scripts/build-codegraph.py (stdlib only — no pip install needed) to
// index the repo into .codegraph/codegraph.db. The langchain_agent's
// CodeGraph tools query this db; it degrades gracefully if the db is absent,
// so failure here is warn-only.
async function buildCodeGraph() {
  const { spawnSync } = require('child_process');
  const indexerPath = path.join(REPO_ROOT, 'scripts', 'build-codegraph.py');

  if (!fs.existsSync(indexerPath)) {
    console.warn('⚠  scripts/build-codegraph.py not found — skipping CodeGraph index');
    return;
  }

  // Pick python3 — try python3.11+ first for speed, fall back to python3
  const py = (() => {
    for (const candidate of ['python3.12', 'python3.11', 'python3.10', 'python3']) {
      try {
        const r = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
        if (r.status === 0) return candidate;
      } catch (_) { /* skip */ }
    }
    return null;
  })();

  if (!py) {
    console.warn('⚠  python3 not found — skipping CodeGraph index. Install Python 3.9+ to enable.');
    return;
  }

  console.log(`  Running: ${py} scripts/build-codegraph.py`);
  const r = spawnSync(py, [indexerPath], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = r.stdout ? r.stdout.toString().trim() : '';
  const stderr = r.stderr ? r.stderr.toString().trim() : '';

  if (stdout) stdout.split('\n').forEach(l => console.log(' ', l));

  if (r.status !== 0) {
    if (stderr) stderr.split('\n').forEach(l => console.warn(' ', l));
    console.warn('⚠  CodeGraph indexer exited non-zero — agent will start without search index');
    return;
  }

  ok('.codegraph/codegraph.db written');

  // Stage the indexed source subset into langchain_agent/repo-src/ so it can
  // be COPYed into the Docker image (REPO_SRC_ROOT=/app/repo-src).
  console.log('  Staging repo source for the Code Explorer image → langchain_agent/repo-src');
  const rs = spawnSync(py, [indexerPath, '--stage-src', 'langchain_agent/repo-src'],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const rsOut = rs.stdout ? rs.stdout.toString().trim() : '';
  const rsErr = rs.stderr ? rs.stderr.toString().trim() : '';
  if (rsOut) rsOut.split('\n').forEach(l => console.log(' ', l));
  if (rs.status !== 0) {
    if (rsErr) rsErr.split('\n').forEach(l => console.warn(' ', l));
    console.warn('⚠  Source staging exited non-zero — image will lack repo-src (grep/read_file tools degraded)');
    return;
  }
  ok('langchain_agent/repo-src staged for image build');
}

function importedEnvNeedsBootstrap() {
  const envText = readEnvSafely();
  if (!envText) return true;            // nothing to read; bootstrap is needed
  return (!envHas(envText, 'PINGONE_MCP_GATEWAY_CLIENT_ID') && !envHas(envText, 'MCP_GW_CLIENT_ID')) ||
         !envHas(envText, 'AGENT_CLIENT_ID') ||
         !envHas(envText, 'PINGONE_ENVIRONMENT_ID');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner('Banking demo setup');
  if (tarArg) {
    console.log(`  Mode:   migration (importing ${path.basename(tarArg)})`);
  } else {
    console.log(`  Mode:   fresh install`);
  }
  console.log(`  Target: ${SERVER_ROOT}`);

  // Show the defaults table + presets, then ask the user to confirm. Always
  // asks when there's a TTY (even under --yes / --from-installer) so a
  // surprising destructive default like --reset-pingone can't run unnoticed.
  // Without a TTY (CI / curl-pipe), auto-accepts. Exit 2 on decline so the
  // user can re-run with a different recipe.
  if (!(await confirmRunPreset())) {
    process.exit(2);
  }

  // We number phases dynamically — only count what'll actually run for THIS
  // user, so "step 3 of 5" reflects reality instead of a fixed 6-step count
  // that includes phases we'll skip.
  const phases = ['confirm-dir', 'cleanup', 'deps', 'hosts', 'mkcert', 'docker-k8s'];
  if (RESET_PINGONE) phases.push('pingone-wipe');
  if (tarArg) phases.push('import');
  phases.push('bootstrap');
  // Phase 269 — Vault setup phase. Optional; runs after bootstrap (so .env
  // exists with all secrets) and BEFORE helix (so Helix creds can land in the
  // vault directly via vault:migrate-from-env). Counted when MIGHT run.
  if (!SKIP_VAULT) phases.push('vault');
  // Helix LLM config phase — runs after bootstrap so .env is in place. We
  // count it whenever it MIGHT run (i.e. unless --skip-helix); the prompt
  // itself might end up declined, but the phase header still shows.
  if (!SKIP_HELIX) phases.push('helix');
  // CodeGraph index — always runs; fast enough (~5s) to include unconditionally.
  phases.push('codegraph');
  const total = phases.length;
  let n = 0;

  // Phase: confirm install directory (skipped under --from-installer)
  n++;
  if (!SKIP_CONFIRM) {
    phase(n, total, 'Confirm install directory');
    await confirmInstallDirectory();
    ok(`Installing into ${SERVER_ROOT}`);
  } else {
    phase(n, total, 'Install directory (auto-confirmed by installer)');
    skip(`Using ${SERVER_ROOT}`);
  }

  // Phase: cleanup prior state (silent if nothing to clean)
  n++;
  phase(n, total, 'Clean up prior installation state');
  await offerCleanup();
  // offerCleanup() prints its own status; we don't add an explicit ok here.

  // Phase: install dependencies if missing
  n++;
  phase(n, total, 'Install banking_api_server dependencies');
  const deps = await ensureDependencies();
  if (deps.installed) ok('npm install complete');
  else                skip('node_modules already present');

  // Phase: /etc/hosts loopback entry
  n++;
  phase(n, total, 'Verify /etc/hosts entry for api.ping.demo');
  const hostsOk = await ensureHostsEntry();
  if (hostsOk) ok('/etc/hosts entry present');
  else         fail('/etc/hosts entry missing — browser will fail until you add it');

  // Phase: mkcert + TLS certs
  n++;
  phase(n, total, 'Set up TLS certificates (mkcert)');
  await ensureMkcert();

  // Phase: Docker + kubectl check (warn-only; not required for setup:fresh itself)
  n++;
  phase(n, total, 'Check Docker and kubectl (required for docker compose / run-k8.sh)');
  await checkDockerK8s();

  // Phase: PingOne wipe (only when --reset-pingone is passed). Runs the
  // bootstrap script with --wipe-environment so the user goes through the
  // standard cred-collection + y/N confirmation flow before any
  // PingOne resources are deleted. We forward all the bootstrap-relevant
  // passthrough flags (--no-browser, --non-interactive) so the wipe respects
  // the same UX choices as the upcoming bootstrap.
  if (RESET_PINGONE) {
    n++;
    phase(n, total, 'Reset PingOne environment (--reset-pingone)');
    // Use runChildInteractive so the bootstrap script gets the parent's TTY
    // directly (cred + type-env-id prompts need a real terminal).
    const wipeStatus = await runChildInteractive('PingOne wipe', [
      'scripts/bootstrapPingOne.js',
      '--wipe-environment',
      ...passthroughFlags,
    ]);
    if (wipeStatus === 2) {
      // User aborted at the type-env-id confirmation — surface as setupFresh exit 2.
      fail('User aborted PingOne wipe at the confirmation prompt');
      process.exit(2);
    }
    if (wipeStatus !== 0) {
      fail(`PingOne wipe failed (exit ${wipeStatus}). Stopping before import/bootstrap.`);
      process.exit(1);
    }
    ok('PingOne environment wiped — proceeding to fresh provisioning');
  }

  // Phase: import archive (only when tar arg given)
  let skipBootstrap = false;
  if (tarArg) {
    n++;
    phase(n, total, `Import data archive (${path.basename(tarArg)})`);
    if (!fs.existsSync(path.resolve(tarArg))) {
      fail(`Archive not found: ${tarArg}`);
      process.exit(1);
    }
    // --from-setup-fresh suppresses the import script's own run-summary
    // Y/N gate; setupFresh already showed its confirmation up front.
    const importStatus = await runChild('Importing', [
      'scripts/importMigrationBundle.js',
      '--from-setup-fresh',
      tarArg,
    ]);
    if (importStatus !== 0) {
      fail(`Import failed (exit ${importStatus}). Stopping before bootstrap.`);
      process.exit(1);
    }
    ok('Archive imported');
    if (!importedEnvNeedsBootstrap()) {
      console.log('');
      console.log('  Imported .env already has full PingOne config — skipping bootstrap.');
      skipBootstrap = true;
    } else {
      console.log('');
      console.log('  Imported .env is missing some PingOne config — continuing to bootstrap.');
    }
  } else {
    const r = ensureEnvForFreshInstall();
    if (r.created)       ok('Wrote stub banking_api_server/.env with generated SESSION_SECRET');
    else if (r.appended) ok('Appended generated SESSION_SECRET to existing .env');
    else                 skip('.env already has SESSION_SECRET');
    seedMortgageKey();
  }

  // Phase: bootstrap PingOne
  n++;
  if (skipBootstrap) {
    phase(n, total, 'Provision PingOne (skipped — already configured)');
    skip('Imported config covers all required PingOne resources');
    seedMortgageKey();
    // Phase 269: Vault setup also runs in the skipBootstrap branch — the
    // imported .env still has secrets that should go into the vault. Same
    // fail-fast contract as the bootstrap-ran branch.
    if (!SKIP_VAULT) {
      n++;
      phase(n, total, 'Configure credential vault (optional)');
      const vr = await configureVault();
      if (!vr.ok) process.exit(1);
    }
    // Even when bootstrap is skipped, still offer the Helix config phase
    // — the imported .env might not have Helix creds.
    if (!SKIP_HELIX) {
      n++;
      phase(n, total, 'Configure Helix LLM (optional)');
      await configureHelix();
    }
    n++;
    phase(n, total, 'Build CodeGraph index (.codegraph/codegraph.db)');
    await buildCodeGraph();
    printDone({ ranBootstrap: false, fromTar: true });
    return;
  }

  phase(n, total, 'Provision PingOne resources');
  console.log('  This step opens a browser form for your worker creds, then');
  console.log('  creates resource servers, scopes, applications, users, and writes .env.');
  console.log('');
  // Use runChildInteractive so the bootstrap script gets the parent's TTY
  // directly (cred + proceed prompts need a real terminal).
  const bootstrapStatus = await runChildInteractive('Bootstrap', [
    'scripts/bootstrapPingOne.js',
    ...passthroughFlags,
  ]);

  if (bootstrapStatus === 2) {
    fail('User aborted bootstrap at the confirmation prompt');
    process.exit(2);
  }
  if (bootstrapStatus !== 0) {
    fail(`Bootstrap failed (exit ${bootstrapStatus})`);
    process.exit(1);
  }
  ok('PingOne resources provisioned');

  // Phase 269: Vault setup (optional). After bootstrap so .env exists with
  // all secrets; before Helix so Helix creds can also land in the vault via
  // vault:migrate-from-env on the next manual rerun. Fail-fast on missing
  // password in interactive mode; silent skip in non-interactive mode.
  if (!SKIP_VAULT) {
    n++;
    phase(n, total, 'Configure credential vault (optional)');
    const vr = await configureVault();
    if (!vr.ok) process.exit(1);
  }

  // Phase: Helix LLM configuration (optional). After bootstrap so .env exists
  // and configStore can decrypt against the now-stable SESSION_SECRET. Phase
  // is silent on --skip-helix; under default (no flag) it asks once, defaults
  // to no, persists creds via configStore on yes.
  if (!SKIP_HELIX) {
    n++;
    phase(n, total, 'Configure Helix LLM (optional)');
    await configureHelix();
  }

  // Phase: build CodeGraph index
  n++;
  phase(n, total, 'Build CodeGraph index (.codegraph/codegraph.db)');
  await buildCodeGraph();

  printDone({ ranBootstrap: true, fromTar: !!tarArg });
}

function printDone({ ranBootstrap, fromTar }) {
  banner('Setup complete');

  if (fromTar && !ranBootstrap) {
    console.log('  Mode:  migration (archive imported, PingOne already configured)');
  } else if (fromTar && ranBootstrap) {
    console.log('  Mode:  migration + bootstrap (archive imported, missing apps provisioned)');
  } else {
    console.log('  Mode:  fresh install');
  }
  console.log('');

  // Summary of what's actually on disk now.
  console.log('  What was set up:');
  const envKeys = readEnvKeys();
  if (envKeys.length > 0) {
    console.log(`    ✓ banking_api_server/.env  (${envKeys.length} keys)`);
    const groups = groupEnvKeys(envKeys);
    for (const [label, keys] of groups) {
      if (keys.length > 0) console.log(`        - ${label.padEnd(26)} ${keys.join(', ')}`);
    }
  }
  if (fs.existsSync(path.join(SERVER_ROOT, 'data', 'persistent'))) {
    const files = fs.readdirSync(path.join(SERVER_ROOT, 'data', 'persistent'));
    if (files.length > 0) console.log(`    ✓ data/persistent/         ${files.length} file(s)`);
  }
  const certsDir = path.join(REPO_ROOT, 'certs');
  if (fs.existsSync(certsDir) && fs.readdirSync(certsDir).filter(f => f.endsWith('.pem')).length > 0) {
    console.log(`    ✓ certs/                    TLS certificates present`);
  } else {
    console.log(`    ○ certs/                    not yet generated (run.sh will create on first start)`);
  }
  console.log('');

  // ANSI escapes for emphasis. Most modern terminals support these; on
  // terminals that don't, the box characters and bold-marker text still
  // convey the structure. We avoid 256-color codes to stay broadly portable.
  const BOLD   = '\x1b[1m';
  const CYAN   = '\x1b[36m';
  const YELLOW = '\x1b[33m';
  const GREEN  = '\x1b[32m';
  const DIM    = '\x1b[2m';
  const RESET  = '\x1b[0m';

  // No box characters around content rows — earlier versions used `║` borders
  // on every line, but users naturally copy-pasted a row to run a command and
  // the leading/trailing `║` then surfaced as `command not found: ║`. Here we
  // use bold horizontal dividers as the visual frame; every code/URL line is
  // its own bare line that's safe to triple-click and copy.
  const HR = '═'.repeat(78);

  console.log('');
  console.log(`${BOLD}${CYAN}${HR}${RESET}`);
  console.log(`${BOLD}${YELLOW}  NEXT STEPS — what to do now${RESET}`);
  console.log(`${BOLD}${CYAN}${HR}${RESET}`);
  console.log('');
  console.log(`  ${BOLD}1.  Start the demo${RESET} ${DIM}(copy this line):${RESET}`);
  console.log('');
  console.log(`      ${GREEN}${BOLD}cd ${REPO_ROOT} && ./run.sh${RESET}          ${DIM}(Docker Compose)${RESET}`);
  console.log(`      ${GREEN}${BOLD}cd ${REPO_ROOT} && ./run-k8.sh${RESET}       ${DIM}(Kubernetes)${RESET}`);
  console.log('');
  console.log(`  ${BOLD}2.  Open in browser${RESET} ${DIM}(click or copy):${RESET}`);
  console.log('');
  console.log(`      ${YELLOW}${BOLD}https://api.ping.demo:4000/configure${RESET}   ${DIM}verify config${RESET}`);
  console.log(`      ${YELLOW}${BOLD}https://api.ping.demo:4000/dashboard${RESET}   ${DIM}end-user portal${RESET}`);
  console.log(`      ${YELLOW}${BOLD}https://api.ping.demo:4000/admin${RESET}       ${DIM}admin portal${RESET}`);
  console.log('');
  console.log(`  ${BOLD}3.  Sign in with one of these demo users${RESET} ${DIM}(username / password — role):${RESET}`);
  console.log('');
  console.log(`      ${BOLD}Username${RESET}        ${BOLD}Password${RESET}        ${BOLD}Role${RESET}`);
  console.log(`      ${GREEN}${BOLD}demoUser${RESET}        ${GREEN}${BOLD}Baseball123!${RESET}    ${DIM}End-user dashboard (customer)${RESET}`);
  console.log(`      ${GREEN}${BOLD}demoAdmin${RESET}       ${GREEN}${BOLD}Baseball123!${RESET}    ${DIM}Admin portal (staff)${RESET}`);
  console.log(`      ${GREEN}${BOLD}demoDelegate${RESET}    ${GREEN}${BOLD}Baseball123!${RESET}    ${DIM}Delegated user (read + deposit only)${RESET}`);
  console.log('');
  console.log(`${BOLD}${CYAN}${HR}${RESET}`);
  console.log('');
  console.log(`${DIM}  Forgot the passwords or want the full provisioning summary?${RESET}`);
  console.log(`${DIM}  See ${BOLD}setup-config.md${RESET}${DIM} at the repo root, or banking_api_server/.env.${RESET}`);
  console.log('');
}

function readEnvKeys() {
  const text = readEnvSafely();
  if (!text) return [];
  return Array.from(new Set(
    text.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('=')[0])
      .filter(Boolean)
  ));
}

function groupEnvKeys(keys) {
  const groups = new Map([
    ['PingOne env',       keys.filter(k => k.startsWith('PINGONE_ENVIRONMENT_ID') || k === 'PINGONE_REGION')],
    ['OAuth clients',     keys.filter(k => /CLIENT_ID|CLIENT_SECRET|REDIRECT_URI/.test(k))],
    ['MCP gateway/agent', keys.filter(k => /^MCP_GW_|^AGENT_/.test(k))],
    ['Resource server',   keys.filter(k => /^MCP_RESOURCE|^ENDUSER_AUDIENCE/.test(k))],
    ['Demo users',        keys.filter(k => /^DEMO_/.test(k))],
    ['Session/encryption',keys.filter(k => /^SESSION_SECRET|^CONFIG_ENCRYPTION_KEY/.test(k))],
  ]);
  return Array.from(groups.entries());
}

// ── Run-summary table + presets + Y/N confirm ────────────────────────────────
//
// Printed once at the top of every run, and embedded in --help. Goal: a user
// who ran `npm run setup:fresh` should see (1) what's about to happen with the
// current flags, (2) the other recipes they could have run instead, and (3)
// have a chance to bail out before any provisioning starts.
//
// The Y/N confirm always asks when there's a TTY — even under --yes or
// --from-installer — because surprising a user with a destructive default is
// worse than one extra Enter press. Without a TTY (CI / curl-pipe install),
// it auto-accepts (default Yes) so unattended flows don't hang.

function defaultsTableText() {
  // Build the row list dynamically so flags affect what gets shown as
  // "active for this run" vs "default". Lines stay aligned via padEnd.
  const rows = [
    ['Confirm install dir', SKIP_CONFIRM ? 'OFF (--yes / --from-installer)' : 'ON',
      '--yes to skip'],
    ['Cleanup prior state', FORCE_CLEAN ? 'FORCE (--clean)' : SKIP_CLEAN ? 'SKIP (--no-clean)' : 'PROMPT (only if state found)',
      '--clean / --no-clean'],
    ['Wipe PingOne env',    RESET_PINGONE ? 'ON (--reset-pingone) — DESTRUCTIVE' : 'OFF',
      '--reset-pingone'],
    ['Recreate demo apps',  passthroughFlags.includes('--recreate-apps') ? 'ON (--recreate-apps)' : 'OFF',
      '--recreate-apps'],
    ['Bootstrap PingOne',   'ON (idempotent)',
      '(always runs)'],
    ['Helix LLM config',    SKIP_HELIX ? 'SKIP (--skip-helix)' : FORCE_HELIX ? 'COLLECT (--helix)' : 'PROMPT (default Yes)',
      '--helix / --skip-helix'],
    ['Browser cred form',   passthroughFlags.includes('--no-browser') ? 'OFF (--no-browser)' : 'ON',
      '--no-browser'],
    ['Read PINGONE_BOOTSTRAP_*', passthroughFlags.includes('--non-interactive') ? 'ON (--non-interactive)' : 'OFF',
      '--non-interactive'],
  ];
  const w1 = Math.max(...rows.map(r => r[0].length));
  const w2 = Math.max(...rows.map(r => r[1].length));
  const lines = rows.map(([k, v, flag]) =>
    `  ${k.padEnd(w1)}   ${v.padEnd(w2)}   ${flag}`
  );
  return lines.join('\n');
}

function presetsText() {
  return `  1) Fresh install on this machine (the default — what's about to run)
       npm run setup:fresh

  2) Migrate from another machine using a bundle
       npm run setup:fresh -- ~/banking-export-2026-XX-XX.tar.gz

  3) Full wipe + start blank (wipe local state AND PingOne env, then re-provision)
       npm run reset

  4) CI / scripted (no prompts; reads PINGONE_BOOTSTRAP_* + HELIX_* env vars)
       npm run setup:fresh -- --non-interactive --skip-helix

  5) Tear down everything (stop services, wipe PingOne, delete local + node_modules)
       npm run uninstall`;
}

function runSummaryText() {
  const argLine = process.argv.slice(2).join(' ') || '(no flags)';
  return `═══════════════════════════════════════════════════════════════════════════
  setup:fresh — what's about to happen
═══════════════════════════════════════════════════════════════════════════

This run's flags: ${argLine}

Defaults (column 2 reflects this run; column 3 is the override flag):

${defaultsTableText()}

Other recipes you could run instead (Ctrl-C now and pick one):

${presetsText()}

Full flag docs: npm run setup:fresh -- --help
═══════════════════════════════════════════════════════════════════════════`;
}

// Y/N confirmation gate. Always asks when there's a TTY; auto-accepts (default
// Yes) when there isn't. Returns true to proceed, false to abort.
async function confirmRunPreset() {
  console.log('');
  console.log(runSummaryText());
  console.log('');

  const interactive = isInteractiveStdin();
  if (!interactive) {
    console.log('  (No TTY detected — auto-accepting defaults. Ctrl-C now if wrong.)');
    console.log('');
    return true;
  }

  const proceed = await readlineQuestion(
    'Continue with these defaults?', /* defaultYes */ true
  );
  if (!proceed) {
    console.log('');
    console.log('Aborted at run-summary confirmation. Re-run with different flags');
    console.log('or use one of the recipes printed above.');
    console.log('');
  }
  return proceed;
}

// ── Entry ────────────────────────────────────────────────────────────────────

// Phase 269: export configureVault for unit-test DI. `main()` and the
// rest of the boot sequence below are guarded by `require.main === module`
// so `require('./setupFresh.js')` from a test does NOT auto-run setup.
module.exports = { configureVault, envHas };

if (require.main === module) {
  openLog();
  patchConsole();

  // Global error capture — anything that escapes main() (sync throw, async
  // rejection, native crash) still ends up in setup.log so a confused user
  // can paste a single file when asking for help.
  process.on('uncaughtException', (err) => {
    console.error('');
    console.error('UNCAUGHT EXCEPTION:');
    console.error(err && err.stack ? err.stack : String(err));
    closeLog();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('');
    console.error('UNHANDLED PROMISE REJECTION:');
    console.error(reason && reason.stack ? reason.stack : String(reason));
    closeLog();
    process.exit(1);
  });

  process.on('exit', closeLog);
  process.on('SIGINT',  () => { console.error('Interrupted (SIGINT)'); closeLog(); process.exit(130); });
  process.on('SIGTERM', () => { console.error('Terminated (SIGTERM)'); closeLog(); process.exit(143); });

  console.log(`Logging full transcript to: ${LOG_FILE}`);

  main().then(() => closeLog()).catch((err) => {
    console.error('');
    console.error(`setup:fresh failed: ${err.message}`);
    console.error(err.stack);
    closeLog();
    process.exit(1);
  });
}
