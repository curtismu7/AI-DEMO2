#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * CLI for PingOne provisioning — non-browser variant of /setup/wizard.
 *
 * Wraps provisionEnvironment() from services/pingoneProvisionService.js.
 * Interactive by default; prompts for management worker creds and runs the
 * full provisioning sequence (resource servers, scopes, apps, users with
 * passwords, .env writeback). Idempotent: rerun is safe.
 *
 * Usage:
 *   node scripts/bootstrapPingOne.js                # interactive
 *   node scripts/bootstrapPingOne.js --help
 *
 * Non-interactive (CI / automation):
 *   PINGONE_BOOTSTRAP_ENV_ID=...
 *   PINGONE_BOOTSTRAP_REGION=com
 *   PINGONE_BOOTSTRAP_CLIENT_ID=...
 *   PINGONE_BOOTSTRAP_CLIENT_SECRET=...
 *   PUBLIC_APP_URL=https://api.ping.demo:4000   (optional)
 *   node scripts/bootstrapPingOne.js --non-interactive
 */

// Force stdout/stderr to be blocking (synchronous). When this script is
// spawned by setupFresh.js with stdio:[pipe, pipe], Node's default async
// pipe writes can buffer for many seconds while we sit in axios calls to
// PingOne — so the user sees no progress and assumes a hang. Blocking
// writes flush immediately to the pipe, which the parent then tees to the
// terminal in real time.
//
// This is safe in CLI scripts: the small per-write latency cost is
// negligible compared to the multi-second PingOne API calls.
if (process.stdout._handle && typeof process.stdout._handle.setBlocking === 'function') {
  process.stdout._handle.setBlocking(true);
}
if (process.stderr._handle && typeof process.stderr._handle.setBlocking === 'function') {
  process.stderr._handle.setBlocking(true);
}

const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Defer Node-version pre-flight until after --help so users can read help text
// from any Node. checkNodeVersion() is called below, after the --help branch.
function checkNodeVersion() {
  // Accept any Node major at or above engines.node's floor (e.g. ">=20", "20.x").
  const fs = require('fs');
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

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`PingOne bootstrap CLI

Provisions a complete PingOne environment for the demo:
  - Resource servers: Demo API, Demo MCP Server, Demo MCP Gateway, Demo Agent Gateway
  - Scopes:           banking:*, admin:*, users:*, p1:*, mcp:invoke (derived from scope-topology.json)
  - Applications:     Admin (WEB_APP), User (WEB_APP), MCP Server (WEB_APP),
                      Worker (WORKER), MCP Exchanger (WEB_APP), MCP Gateway (WEB_APP),
                      Agent (WORKER), AI Agent (WEB_APP), PingOne MCP Server (NATIVE_APP)
  - Users:            demoUser, demoAdmin, demoDelegate (all with password 'Baseball123!')
  - Schema attributes: bankingPrincipalUserId, isDelegate, mayAct, delegatedTo, agentRestrictions
  - Token claims:     bankingPrincipalUserId (User app), may_act + is_delegate + delegated_to
                      (resource attributes on Demo API + MCP Server, projected for all apps;
                      per-user mayAct values are written at runtime by agent authorization,
                      not by bootstrap)

Writes credentials to demo_api_server/.env (overwrites existing).
Idempotent — rerunning produces "exists" rows and exits 0.

Usage:
  node scripts/bootstrapPingOne.js                    Interactive (browser, terminal fallback)
  node scripts/bootstrapPingOne.js --no-browser       Force terminal prompts
  node scripts/bootstrapPingOne.js --non-interactive  Read creds from env vars
  node scripts/bootstrapPingOne.js --recreate-apps    Delete existing 'Demo *'
                                                       apps + resources before creating
  node scripts/bootstrapPingOne.js --wipe-environment NUCLEAR — delete EVERYTHING in the
                                                       PingOne env (apps, resources, groups,
                                                       custom user attrs, users) and EXIT.
                                                       Does not provision afterward.

Step 1: Create a PingOne worker app with the "Identity Data Admin" role.
Step 2: Run this script. By default it pops a localhost form for the three creds
        (Environment ID, Client ID, Client Secret) and resumes when you submit.
        Auth method is hard-coded to client_secret_basic to match the demo.

Env vars (non-interactive mode):
  PINGONE_BOOTSTRAP_ENV_ID         PingOne environment id (UUID)
  PINGONE_BOOTSTRAP_REGION         com | eu | ca | asia | com.au   (default: com)
  PINGONE_BOOTSTRAP_CLIENT_ID      Management worker client id
  PINGONE_BOOTSTRAP_CLIENT_SECRET  Management worker client secret
  PUBLIC_APP_URL                   App base URL              (default: https://api.ping.demo:4000)
  PINGONE_BOOTSTRAP_AUDIENCE       Resource server audience  (default: enduser.ping.demo)
  MCP_GW_AUDIENCE                  Gateway audience          (default: enduser.ping.demo)

Exit codes:
  0  Provisioning succeeded (or idempotent re-run)
  1  Validation / network / fatal PingOne API error
  2  User aborted at confirmation prompt
`);
  process.exit(0);
}

// Real run — pre-flight Node version now (services pulled in by main() need it).
checkNodeVersion();

const NON_INTERACTIVE = args.includes('--non-interactive') || !!process.env.CI;
// When launched from install.sh the restart prompt is irrelevant — install.sh
// manages service startup. Skip it to avoid blocking on a dangling TTY prompt.
const FROM_INSTALLER = args.includes('--from-installer');
const NO_BROWSER = args.includes('--no-browser');
// --recreate-apps: before provisioning, delete every 'Demo *' app
// and every resource we'd create. Use when changing hostname / starting clean.
const RECREATE_APPS = args.includes('--recreate-apps');
// --wipe-environment: nuclear option. Delete EVERYTHING in the PingOne env
// (apps, resources, groups, custom user-schema attrs, users) except the
// worker we're authenticated as and PingOne system defaults. Then EXIT —
// does NOT continue to provisioning. Use when starting from a totally clean
// slate or recovering from severe drift.
const WIPE_ENVIRONMENT = args.includes('--wipe-environment');
// --reset-creds: ignore (and delete) the cached creds at ~/.ai-demo-creds.
// Use when switching tenants or after rotating the worker secret.
const RESET_CREDS = args.includes('--reset-creds');
// --_retry: internal flag set when we re-exec after auto-clearing bad cached creds.
// Prevents infinite loop: if the fresh creds also fail, we exit rather than re-exec again.
const IS_RETRY = args.includes('--_retry');

// Cached credentials live OUTSIDE the repo so they survive `npm run uninstall`
// and are reachable from other clones on the same machine. Mode 0600 = only
// this user can read/write. Cache is JSON; missing/corrupt = silently treated
// as no cache.
const CRED_CACHE_PATH     = require('path').join(require('os').homedir(), '.ai-demo-creds');
const CRED_CACHE_PATH_OLD = require('path').join(require('os').homedir(), '.banking-demo-creds');

// Migrate old cache file to new name on first run after rename.
(() => {
  const fs = require('fs');
  if (!fs.existsSync(CRED_CACHE_PATH) && fs.existsSync(CRED_CACHE_PATH_OLD)) {
    try {
      fs.renameSync(CRED_CACHE_PATH_OLD, CRED_CACHE_PATH);
    } catch (_e) { /* non-fatal — readCredCache will return null and re-prompt */ }
  }
})();

function readCredCache() {
  if (RESET_CREDS) return null;
  const fs = require('fs');
  try {
    const text = fs.readFileSync(CRED_CACHE_PATH, 'utf8');
    const obj = JSON.parse(text);
    // Validate shape — at minimum we need envId and workerClientId/Secret.
    // If the cache predates a field we now require, treat as miss and re-prompt.
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.envId || !obj.workerClientId || !obj.workerClientSecret) return null;
    return obj;
  } catch (_e) {
    return null;
  }
}

function writeCredCache(creds) {
  const fs = require('fs');
  // Only persist the bits a future run actually needs to skip prompts. We
  // deliberately exclude transient values (audience, mcpGatewayAudience) so
  // changes in code don't strand the cache with stale content.
  const cached = {
    envId: creds.envId,
    region: creds.region,
    workerClientId: creds.workerClientId,
    workerClientSecret: creds.workerClientSecret,
    publicAppUrl: creds.publicAppUrl,
    cachedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(CRED_CACHE_PATH, JSON.stringify(cached, null, 2), { mode: 0o600 });
    fs.chmodSync(CRED_CACHE_PATH, 0o600);  // belt + suspenders
  } catch (e) {
    console.warn(`(could not write cred cache to ${CRED_CACHE_PATH}: ${e.message})`);
  }
}

function clearCredCache() {
  const fs = require('fs');
  try { fs.unlinkSync(CRED_CACHE_PATH); } catch (_e) { /* didn't exist */ }
}

if (RESET_CREDS) {
  clearCredCache();
  console.log(`Cleared cached PingOne creds at ${CRED_CACHE_PATH}.`);
}

// ── Prompts ──────────────────────────────────────────────────────────────────

// Char codes for control keys (raw mode reads single bytes / sequences)
const CTRL_C = 0x03;
const BACKSPACE = 0x08;
const DEL      = 0x7f;

// Under `curl ... | bash` and similar pipelines, process.stdin is the HTTP
// body — not the user's keyboard. The user's keyboard is at /dev/tty.
// We open it ONCE and reuse the same fd for every prompt — reopening it each
// time leaves a buffered \n from the previous Enter in the kernel tty buffer,
// which causes the next prompt to appear pre-answered and require a second
// Enter to proceed.
let _ttyStream = null;
function getInteractiveInput() {
  if (process.stdin.isTTY) return { stream: process.stdin, opened: false };
  if (_ttyStream) return { stream: _ttyStream, opened: true };
  const fs = require('fs');
  try {
    const stream = fs.createReadStream('/dev/tty');
    stream.on('error', (err) => {
      console.warn(`(/dev/tty error: ${err.code || err.message} — falling back to process.stdin)`);
    });
    _ttyStream = stream;
    return { stream, opened: true };
  } catch (_e) {
    return { stream: process.stdin, opened: false };
  }
}

function prompt(rl, question, { defaultValue, secret = false } = {}) {
  return new Promise((resolve) => {
    const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;

    const input = rl.input;
    // A "real" TTY is process.stdin when stdin.isTTY is true. Anything else
    // (including fs.createReadStream('/dev/tty')) is a regular ReadStream
    // that doesn't support raw-mode hidden input — and, critically, doesn't
    // play nicely with readline.question() either when the parent process
    // ignored stdin. Detect this and switch to manual line-buffering.
    const isRealTTY = typeof input.setRawMode === 'function' && input.isTTY === true;

    // Path 1: real TTY, hidden input — raw mode, no echo.
    if (secret && isRealTTY) {
      process.stdout.write(display);
      let captured = '';
      const wasRaw = input.isRaw;
      input.setRawMode(true);
      input.resume();
      input.setEncoding('utf8');
      const rlPaused = !rl.paused;
      if (rlPaused) rl.pause();
      const restore = () => {
        input.setRawMode(wasRaw);
        input.removeListener('data', onData);
        if (rlPaused) rl.resume();
      };
      const onData = (ch) => {
        const c = ch.toString('utf8');
        if (c === '\n' || c === '\r' || c.startsWith('\r')) {
          restore();
          process.stdout.write('\n');
          resolve(captured.trim() || defaultValue || '');
          return;
        }
        const code = c.charCodeAt(0);
        if (code === CTRL_C) {
          restore();
          process.stdout.write('\n');
          process.exit(130);
        } else if (code === DEL || code === BACKSPACE) {
          captured = captured.slice(0, -1);
        } else if (code >= 0x20) {
          captured += c;
        }
      };
      input.on('data', onData);
      return;
    }

    // Path 2: real TTY, visible input — readline.question is reliable here.
    if (isRealTTY) {
      rl.question(display, (answer) => {
        const trimmed = String(answer || '').trim();
        resolve(trimmed || defaultValue || '');
      });
      return;
    }

    // Path 3: input is /dev/tty via fs.createReadStream (no real TTY).
    // readline.question() is unreliable here under some Node versions when
    // the parent ignored stdin — the question text prints but data events
    // never reach readline's internal listener. Bypass readline entirely:
    // attach our own data listener, buffer until newline, resolve.
    if (secret) {
      process.stdout.write('  (input will be visible — no TTY available for hidden entry)\n');
    }
    process.stdout.write(display);
    input.setEncoding('utf8');
    input.resume();

    let buffer = '';
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      buffer += s;
      const nlIdx = buffer.indexOf('\n');
      if (nlIdx === -1) return;
      input.removeListener('data', onData);
      // Pause so any remaining buffered data (e.g. the \n from a previous
      // prompt) doesn't bleed into the next readline.question call, which
      // would cause the next prompt to appear pre-answered and require a
      // second Enter to proceed.
      input.pause();
      const answer = buffer.slice(0, nlIdx).replace(/\r$/, '');
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue || '');
    };
    input.on('data', onData);
  });
}

// ── Browser prompt ────────────────────────────────────────────────────────────
//
// Spins up a one-shot HTTPS server on 127.0.0.1:<random-free-port>, opens the
// default browser to a self-contained HTML form, and resolves with the values
// the user submits. Server closes after the first valid submission, on Ctrl-C,
// or after 5 minutes (whichever first).
//
// Loopback-only binding means the form is unreachable from elsewhere on the
// network. A per-launch nonce in the form gates POSTs anyway.

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const cmdArgs = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (_e) {
    return false;
  }
}

function buildFormPage(nonce) {
  // No external assets — single self-contained document.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PingOne Bootstrap</title>
  <style>
    body { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f7; color: #1d1d1f; margin: 0; padding: 32px; }
    main { max-width: 520px; margin: 0 auto; background: #fff; padding: 28px 32px; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    h1 { font-size: 18px; margin: 0 0 6px; }
    p.lead { color: #555; margin: 0 0 20px; }
    label { display: block; font-weight: 600; margin: 14px 0 4px; font-size: 13px; }
    input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #c7c7cc; border-radius: 6px; font: inherit; }
    input:focus { outline: none; border-color: #0071e3; box-shadow: 0 0 0 3px rgba(0,113,227,0.15); }
    button { margin-top: 22px; padding: 10px 18px; background: #0071e3; color: #fff; border: 0; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:disabled { background: #999; cursor: wait; }
    .note { color: #6e6e73; font-size: 12px; margin-top: 4px; }
    .err { color: #c00; margin-top: 14px; min-height: 18px; }
  </style>
</head>
<body>
  <main>
    <h1>PingOne Bootstrap</h1>
    <p class="lead">Paste the worker app credentials, then click <strong>Submit</strong>. After submitting, switch back to your terminal and press <strong>Enter</strong> to confirm.</p>
    <form id="f">
      <label for="envId">Environment ID</label>
      <input id="envId" name="envId" required autocomplete="off" placeholder="00000000-0000-0000-0000-000000000000">
      <div class="note">PingOne Console → Settings → Environment Properties.</div>

      <label for="region">Region</label>
      <input id="region" name="region" value="com" autocomplete="off">
      <div class="note">com | eu | ca | asia | com.au</div>

      <label for="clientId">Worker Client ID</label>
      <input id="clientId" name="clientId" required autocomplete="off">

      <label for="clientSecret">Worker Client Secret</label>
      <input id="clientSecret" name="clientSecret" type="password" required autocomplete="off">
      <div class="note">Sent only to 127.0.0.1 on this machine. Auth method is hard-coded to client_secret_basic.</div>

      <button id="submit" type="submit">Submit and continue</button>
      <div class="err" id="err"></div>
    </form>
    <script>
      const NONCE = ${JSON.stringify(nonce)};
      const f = document.getElementById('f');
      const err = document.getElementById('err');
      const btn = document.getElementById('submit');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = 'Submitting…'; err.textContent = '';
        const data = Object.fromEntries(new FormData(f));
        try {
          const res = await fetch('/submit', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-bootstrap-nonce': NONCE },
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error(await res.text());
          document.body.innerHTML = \`<main style="text-align:center;padding:48px 32px">
            <div style="font-size:48px;margin-bottom:16px">✅</div>
            <h1 style="font-size:22px;margin:0 0 12px">Credentials received!</h1>
            <p style="color:#555;margin:0 0 24px">PingOne provisioning is running in your terminal.<br>You can close this tab.</p>
            <p style="background:#f0f9f0;border:1px solid #b8e0b8;border-radius:8px;padding:12px 16px;color:#1a5c1a;font-weight:600;font-size:15px">
              ↩ Switch back to your terminal and press <kbd style="background:#fff;border:1px solid #ccc;border-radius:4px;padding:1px 6px">Enter</kbd> to confirm
            </p>
          </main>\`;
        } catch (e2) {
          err.textContent = String(e2.message || e2);
          btn.disabled = false; btn.textContent = 'Submit and continue';
        }
      });
    </script>
  </main>
</body>
</html>`;
}

function browserPrompt({ timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const REPO_ROOT = path.resolve(__dirname, '..', '..');
    const certPath = path.join(REPO_ROOT, 'certs', 'api.ping.demo+2.pem');
    const keyPath  = path.join(REPO_ROOT, 'certs', 'api.ping.demo+2-key.pem');
    const useTls = fs.existsSync(certPath) && fs.existsSync(keyPath);

    const nonce = crypto.randomBytes(24).toString('base64url');
    const formPage = buildFormPage(nonce);

    const handler = (req, res) => {
      // Only accept the configured origin (127.0.0.1) — Node binds there, but
      // refuse Host headers that don't match to neutralize DNS rebinding.
      const host = String(req.headers.host || '');
      if (!/^127\.0\.0\.1(:|$)/.test(host) && !/^localhost(:|$)/.test(host)) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        return res.end('bad host');
      }

      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(formPage);
      }

      // Browsers auto-fetch /favicon.ico — return 204 so it doesn't pollute the
      // console with a 404 (cosmetic, but the user sees it and worries).
      if (req.method === 'GET' && req.url === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }

      if (req.method === 'POST' && req.url === '/submit') {
        if (req.headers['x-bootstrap-nonce'] !== nonce) {
          res.writeHead(403, { 'content-type': 'text/plain' });
          return res.end('bad nonce');
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 16 * 1024) { req.destroy(); }     // hard cap
        });
        req.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(body); } catch (_e) {
            res.writeHead(400, { 'content-type': 'text/plain' });
            return res.end('bad json');
          }
          const envId = String(parsed.envId || '').trim();
          const region = String(parsed.region || 'com').trim() || 'com';
          const clientId = String(parsed.clientId || '').trim();
          const clientSecret = String(parsed.clientSecret || '').trim();

          if (!envId || !clientId || !clientSecret) {
            res.writeHead(400, { 'content-type': 'text/plain' });
            return res.end('All fields are required.');
          }

          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
          // Keep the listener alive briefly so the page's post-submit "Submitted —
          // closing tab" view can render and self-close without ERR_CONNECTION_REFUSED.
          // The page calls window.close() at +800ms; 3000ms gives a comfortable margin
          // (favicon refetch, password manager extension callback, browser-internal hits).
          setTimeout(() => { try { server.close(); } catch (_e) {} }, 3000);
          finish({ envId, region, workerClientId: clientId, workerClientSecret: clientSecret });
        });
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    };

    let settled = false;
    const finish = (creds) => { if (settled) return; settled = true; clearTimeout(timer); resolve(creds); };
    const fail   = (err)   => { if (settled) return; settled = true; clearTimeout(timer); try { server.close(); } catch (_e) {} reject(err); };

    const server = useTls
      ? require('https').createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, handler)
      : require('http').createServer(handler);

    server.on('error', fail);

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const scheme = useTls ? 'https' : 'http';
      const url = `${scheme}://127.0.0.1:${port}/`;
      console.log('');
      console.log(`Open this URL to enter PingOne worker creds:`);
      console.log(`  ${url}`);
      const opened = openBrowser(url);
      if (!opened) console.log('  (tried to open your default browser; if it didn\'t pop, paste the URL manually)');
      console.log('Waiting for submission… (Ctrl-C to abort)');
    });

    const timer = setTimeout(() => fail(new Error('Browser prompt timed out after 5 minutes.')), timeoutMs);
  });
}

async function gatherCredsViaBrowser() {
  // Cache short-circuit: if we have all the bits a previous run cached,
  // skip the browser form entirely. The user explicitly opts out via
  // --reset-creds (handled at top of file).
  const cached = readCredCache();
  if (cached) {
    console.log(`Using cached PingOne creds from ${CRED_CACHE_PATH} (cached ${cached.cachedAt}).`);
    console.log('Pass --reset-creds to forget them and re-prompt.');
    return {
      envId: cached.envId,
      region: cached.region || 'com',
      workerClientId: cached.workerClientId,
      workerClientSecret: cached.workerClientSecret,
      publicAppUrl: cached.publicAppUrl || process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000',
      audience: process.env.PINGONE_BOOTSTRAP_AUDIENCE || 'enduser.ping.demo',
      mcpGatewayAudience: process.env.MCP_GW_AUDIENCE || 'mcpgateway.ping.demo',
    };
  }

  console.log('PingOne Bootstrap — browser-based credential entry');
  console.log('You will enter Environment ID, Worker Client ID, and Worker Client Secret');
  console.log('in a localhost form. Auth method is hard-coded to client_secret_basic.');
  const fromForm = await browserPrompt();

  const publicAppUrl = process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000';
  const audience = process.env.PINGONE_BOOTSTRAP_AUDIENCE || 'enduser.ping.demo';
  const mcpGatewayAudience = process.env.MCP_GW_AUDIENCE || 'mcpgateway.ping.demo';
  const creds = { ...fromForm, publicAppUrl, audience, mcpGatewayAudience };
  writeCredCache(creds);
  console.log(`Saved creds to ${CRED_CACHE_PATH} (mode 0600). Future runs will skip these prompts.`);
  return creds;
}

async function gatherCredsInteractive() {
  // Cache short-circuit: skip all 5 prompts if we've cached creds before.
  const cached = readCredCache();
  if (cached) {
    console.log(`Using cached PingOne creds from ${CRED_CACHE_PATH} (cached ${cached.cachedAt}).`);
    console.log('Pass --reset-creds to forget them and re-prompt.');
    return {
      envId: cached.envId,
      region: cached.region || 'com',
      workerClientId: cached.workerClientId,
      workerClientSecret: cached.workerClientSecret,
      publicAppUrl: cached.publicAppUrl || process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000',
      audience: process.env.PINGONE_BOOTSTRAP_AUDIENCE || 'enduser.ping.demo',
      mcpGatewayAudience: process.env.MCP_GW_AUDIENCE || 'mcpgateway.ping.demo',
    };
  }

  const tty = getInteractiveInput();
  const rl = readline.createInterface({ input: tty.stream, output: process.stdout, terminal: true });
  try {
    console.log('PingOne Bootstrap — interactive setup');
    console.log('Paste your PingOne management worker credentials (the worker app needs');
    console.log('the "Identity Data Admin" role to create users / apps / resources).');
    console.log(`(Creds will be cached at ${CRED_CACHE_PATH} so future runs skip these prompts.)`);
    console.log('');

    const envId = await prompt(rl, 'PingOne Environment ID (UUID)');
    if (!envId) throw new Error('Environment ID is required.');

    const region = await prompt(rl, 'Region', { defaultValue: 'com' });
    const workerClientId = await prompt(rl, 'Management Client ID');
    if (!workerClientId) throw new Error('Management client ID is required.');

    const workerClientSecret = await prompt(rl, 'Management Client Secret', { secret: true });
    if (!workerClientSecret) throw new Error('Management client secret is required.');

    const publicAppUrl = await prompt(rl, 'Public App URL', {
      defaultValue: process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000',
    });

    const audience = process.env.PINGONE_BOOTSTRAP_AUDIENCE || 'enduser.ping.demo';
    const mcpGatewayAudience = process.env.MCP_GW_AUDIENCE || 'mcpgateway.ping.demo';

    const creds = { envId, region, workerClientId, workerClientSecret, publicAppUrl, audience, mcpGatewayAudience };
    writeCredCache(creds);
    console.log(`Saved creds to ${CRED_CACHE_PATH} (mode 0600). Future runs will skip these prompts.`);
    return creds;
  } finally {
    rl.close();
    // tty stream is cached — do not destroy between prompts
  }
}

function gatherCredsFromEnv() {
  const envId = process.env.PINGONE_BOOTSTRAP_ENV_ID;
  const workerClientId = process.env.PINGONE_BOOTSTRAP_CLIENT_ID;
  const workerClientSecret = process.env.PINGONE_BOOTSTRAP_CLIENT_SECRET;

  const missing = [];
  if (!envId) missing.push('PINGONE_BOOTSTRAP_ENV_ID');
  if (!workerClientId) missing.push('PINGONE_BOOTSTRAP_CLIENT_ID');
  if (!workerClientSecret) missing.push('PINGONE_BOOTSTRAP_CLIENT_SECRET');
  if (missing.length > 0) {
    throw new Error(`Non-interactive mode missing required env vars: ${missing.join(', ')}`);
  }

  return {
    envId,
    region: process.env.PINGONE_BOOTSTRAP_REGION || 'com',
    workerClientId,
    workerClientSecret,
    publicAppUrl: process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000',
    audience: process.env.PINGONE_BOOTSTRAP_AUDIENCE || 'enduser.ping.demo',
    mcpGatewayAudience: process.env.MCP_GW_AUDIENCE || 'mcpgateway.ping.demo',
  };
}

// ── Confirmation summary ──────────────────────────────────────────────────────

function printPlan(creds) {
  const masked = creds.workerClientSecret
    ? `${creds.workerClientSecret.slice(0, 3)}…${creds.workerClientSecret.slice(-2)}`
    : '(empty)';
  console.log('');
  console.log('Plan:');
  console.log(`  Environment:        ${creds.envId}  (region: ${creds.region})`);
  console.log(`  Mgmt client id:     ${creds.workerClientId}`);
  console.log(`  Mgmt client secret: ${masked}`);
  console.log(`  Public app URL:     ${creds.publicAppUrl}`);
  console.log(`  Audience:           ${creds.audience}`);
  console.log(`  Gateway audience:   ${creds.mcpGatewayAudience}`);
  console.log('');
  console.log('Will create or reuse:');
  console.log('  3 resource servers, ~25 scopes, 7 applications, 2 users (with passwords),');
  console.log('  1 schema attribute, 2 token claims, scope mappings.');
  console.log('');
  console.log('Will overwrite demo_api_server/.env with provisioned credentials.');
  console.log('');
}

// ── setup-config.md generator ───────────────────────────────────────────────
//
// Writes a human-readable reference of everything provisioned. Drops at repo
// root as setup-config.md. Includes resource IDs, app client IDs, scope names,
// demo credentials. This is a demo, so we include passwords too — the user
// asked for it, and these are throwaway demo creds tied to their test tenant.
//
// Idempotent: subsequent runs overwrite the file (so it always reflects the
// latest provisioning state).

function writeSetupConfigMd(config, result, counters, stepCount) {
  const fs = require('fs');
  const REPO_ROOT = path.resolve(__dirname, '..', '..');
  const outPath = path.join(REPO_ROOT, 'setup-config.md');

  const p = result?.provisioned || {};
  const ts = new Date().toISOString();

  // Helper to safely render an app block
  const appBlock = (label, app) => {
    if (!app) return `### ${label}\n\n_(not provisioned)_\n`;
    const id = app.id || '-';
    const clientId = app.clientId || '-';
    const secret = app.clientSecret || '_(secret was not retrievable; check PingOne Console → Apps → ${label} → Configuration)_';
    return `### ${label}\n\n- **Application ID:** \`${id}\`\n- **Client ID:** \`${clientId}\`\n- **Client secret:** \`${secret}\`\n- **PingOne app name:** \`${app.name || label}\`\n`;
  };

  const resourceBlock = (label, rs) => {
    if (!rs) return `### ${label}\n\n_(not provisioned)_\n`;
    const aud = Array.isArray(rs.audience) ? rs.audience.join(', ') : rs.audience || '-';
    return `### ${label}\n\n- **Resource server ID:** \`${rs.id || '-'}\`\n- **Audience:** \`${aud}\`\n- **PingOne resource name:** \`${rs.name || label}\`\n`;
  };

  const md = `# Demo — setup configuration reference

> Generated by \`npm run setup:fresh\` on ${ts}.
> This file is overwritten on every successful run.
>
> **It contains demo passwords and worker credentials.** Do not commit it.
> The repo's \`.gitignore\` already excludes it; if you fork the repo, keep
> the entry in place.

## Tenant

- **PingOne environment ID:** \`${config.envId}\`
- **PingOne region:** \`${config.region}\`
- **Public app URL:** \`${config.publicAppUrl}\`
- **Auth method:** \`client_secret_basic\` (hard-coded across all worker apps)

## Provisioning summary

- **${stepCount} wizard steps run**
- ✅ ${counters.created} resources created
- ⚠️  ${counters.exists} already existed (reused; idempotent rerun)
- ${counters.failed > 0 ? '❌' : '○'} ${counters.failed} failed

## Resource servers

${resourceBlock('Demo API (end-user resource)', p.resourceServer)}
${resourceBlock('MCP Server (admin tools)', p.mcpResourceServer)}
${resourceBlock('MCP Gateway (delegated agent calls)', p.mcpGwResourceServer)}

## Applications

${appBlock('Admin App', p.adminApp)}
${appBlock('User App', p.userApp)}
${appBlock('MCP Server', p.mcpApp)}
${appBlock('Worker (PingOne management)', p.workerApp)}
${appBlock('MCP Exchanger (delegated token-exchange)', p.mcpExchangerApp)}
${appBlock('MCP Gateway', p.mcpGwApp)}
${appBlock('Agent service', p.agentApp)}
${appBlock('PingOne MCP Server (Claude Code OAuth, dev tooling)', p.pingOneMcpServerApp)}
${appBlock('Banking Gateway MCP (Claude Code OAuth, dev tooling)', p.bankingGatewayMcpApp)}

## Redirect URIs

> These are the URIs the server sends to PingOne during authorization. They must be registered exactly (scheme, host, path) on the corresponding PingOne application.

| Flow        | URI                                                                              | Register on               |
|-------------|----------------------------------------------------------------------------------|---------------------------|
| User login  | \`${config.publicAppUrl}/api/auth/oauth/user/callback\`                           | Demo AI App - User Login  |
| Admin login | \`${config.publicAppUrl}/api/auth/oauth/callback\`                                | Demo AI App - Admin Login |

> ⚠ If the server is proxied (e.g. via nginx/traefik), \`PUBLIC_APP_URL\` in \`.env\` must match the public-facing host — otherwise the server derives the URI from the \`x-forwarded-host\` header, which may differ from what PingOne has registered.

## Worker app (the one YOU created — used to drive setup)

- **Client ID:** \`${config.workerClientId}\`
- **Client secret:** \`${config.workerClientSecret}\`
  > ⚠ This is the management worker app — it has Identity Data Admin role.
  > Keep it safe; rotate after major changes.

## Demo users

> Login through the app UI — passwords intentionally included for demo use.

- **demoUser** \`${p.demoUser?.password || '_(password not captured — user pre-existed)_'}\`
- **demoAdmin** \`${p.demoAdmin?.password || '_(password not captured — user pre-existed)_'}\`
- **demoDelegate** \`${p.demoDelegate?.password || '_(password not captured — user pre-existed)_'}\`  _(delegated user; isDelegate=true; member of BankDelegates group)_

## Audiences (RFC 8707 resource indicators)

- End-user / Demo API: \`${p.resourceServer?.audience?.[0] || config.audience || '-'}\`
- MCP Server: \`${p.mcpResourceServer?.audience?.[0] || '-'}\`
- MCP Gateway: \`${p.mcpGwResourceServer?.audience?.[0] || config.mcpGatewayAudience || '-'}\`

## .env file

The full .env is at \`demo_api_server/.env\`. Key groups present:

\`\`\`text
PINGONE_ENVIRONMENT_ID
PINGONE_REGION
PINGONE_ADMIN_CLIENT_ID / SECRET / REDIRECT_URI
PINGONE_CORE_CLIENT_ID / SECRET / REDIRECT_URI
PINGONE_TOKEN_EXCHANGER_CLIENT_ID / SECRET
PINGONE_MCP_GATEWAY_CLIENT_ID / SECRET
MCP_GW_RESOURCE_URI
MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD
AGENT_CLIENT_ID / SECRET
PINGONE_MCP_OAUTH_CLIENT_ID
PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID
PINGONE_WORKER_CLIENT_ID / SECRET
ENDUSER_AUDIENCE
MCP_RESOURCE_URI
DEMO_USER_USERNAME / PASSWORD
DEMO_ADMIN_USERNAME / PASSWORD
SESSION_SECRET (preserved across reruns)
\`\`\`

## Useful URLs

- Configure UI:  https://api.ping.demo:4000/configure
- End-user dashboard:  https://api.ping.demo:4000/dashboard
- Admin dashboard:  https://api.ping.demo:4000/admin
- Wizard (re-run provisioning from UI):  https://api.ping.demo:4000/setup/wizard

## Re-running

Bootstrap is idempotent. To rerun everything:

\`\`\`bash
cd ${REPO_ROOT}
npm run setup:fresh
\`\`\`

To force a clean wipe first (keeps PingOne side intact):

\`\`\`bash
npm run setup:fresh -- --clean
\`\`\`

To delete + recreate PingOne resources, do that manually in PingOne Admin Console
or via \`scripts/pingone-audit-249.js\` (see CLAUDE.md).
`;

  try {
    fs.writeFileSync(outPath, md);
    return outPath;
  } catch (err) {
    console.warn(`(could not write ${outPath}: ${err.message})`);
    return null;
  }
}

// ── Recreate-apps: wipe before provisioning ────────────────────────────────
//
// Deletes every PingOne application and resource server we'd create, by name
// match against the canonical 'Demo *' names. Useful when:
//   - hostname changed → existing apps have stale redirect URIs
//   - resource audiences were misconfigured → easier to rebuild than patch
//   - PingOne tenant got into a weird state from earlier broken runs
//
// Idempotent: missing items are silently skipped. Errors per item don't abort
// the wipe — we report a summary at the end.

const KNOWN_APP_NAMES = [
  // Current canonical names (Demo AI App - * standard, applied 2026-06-14)
  'Demo AI App - Admin Login',
  'Demo AI App - User Login',
  'Demo AI App - MCP Server Client',
  'Demo AI App - Introspection Worker',
  'Demo AI App - Token Exchanger',
  'Demo AI App - MCP Gateway',
  'Demo AI App - AI Agent Actor',
  'PingOne MCP Server',
  'Claude Code - Banking Gateway',
  // Legacy names — kept so wipe works against older provisioned environments
  'BX Finance - Admin Login',
  'BX Finance - User Login',
  'BX Finance - MCP Server Client',
  'BX Finance - Introspection Worker',
  'BX Finance - Token Exchanger',
  'BX Finance - MCP Gateway',
  'BX Finance - Agent Actor',
  'BX Finance - AI Agent Actor',
  'Demo Admin App',
  'Demo User App',
  'Demo MCP Server',
  'Demo Worker',
  'Demo MCP Exchanger',
  'Demo MCP Gateway',
  'Demo Agent',
  'Demo AI Agent',
  'Demo AI App - Agent Actor',
  'worker token',
];

const KNOWN_RESOURCE_NAMES = [
  'Demo API',
  'Demo MCP Server',
  'Demo MCP Gateway',
  'Demo Agent Gateway',
];

async function wipeExistingResources(creds) {
  const { PingOneProvisionService } = require('../services/pingoneProvisionService');
  const svc = new PingOneProvisionService();
  await svc.initialize(creds.envId, creds.workerClientId, creds.workerClientSecret, creds.region);

  console.log('');
  console.log('▶ Pre-wipe (--recreate-apps)');
  console.log(`  ${'─'.repeat(56)}`);

  let appsDeleted = 0, appsMissing = 0, appsFailed = 0;
  let resourcesDeleted = 0, resourcesMissing = 0, resourcesFailed = 0;

  // Delete applications first — resources can't be deleted while apps still
  // hold scope grants against them.
  const apps = (await svc.makeRequest('GET', '/applications')).data._embedded?.applications || [];
  for (const name of KNOWN_APP_NAMES) {
    const found = apps.find(a => a.name === name);
    if (!found) { appsMissing++; continue; }
    try {
      await svc.makeRequest('DELETE', `/applications/${found.id}`);
      console.log(`  🗑️   Deleted app: ${name}`);
      appsDeleted++;
    } catch (err) {
      console.log(`  ⚠️   Failed to delete app ${name}: ${err.message}`);
      appsFailed++;
    }
  }

  const resources = (await svc.makeRequest('GET', '/resources')).data._embedded?.resources || [];
  for (const name of KNOWN_RESOURCE_NAMES) {
    const found = resources.find(r => r.name === name);
    if (!found) { resourcesMissing++; continue; }
    try {
      await svc.makeRequest('DELETE', `/resources/${found.id}`);
      console.log(`  🗑️   Deleted resource server: ${name}`);
      resourcesDeleted++;
    } catch (err) {
      console.log(`  ⚠️   Failed to delete resource ${name}: ${err.message}`);
      resourcesFailed++;
    }
  }

  console.log('');
  console.log(`  Pre-wipe summary: ${appsDeleted}/${KNOWN_APP_NAMES.length} apps deleted, ` +
              `${resourcesDeleted}/${KNOWN_RESOURCE_NAMES.length} resources deleted, ` +
              `${appsMissing + resourcesMissing} not found, ` +
              `${appsFailed + resourcesFailed} errors`);
  if (appsFailed + resourcesFailed > 0) {
    console.log('  (Provisioning will continue. Errors above usually mean a dependency');
    console.log('  prevented the delete; the wizard will detect the leftover and reuse it.)');
  }
}


// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let creds;
  if (NON_INTERACTIVE) {
    creds = gatherCredsFromEnv();
  } else if (NO_BROWSER) {
    creds = await gatherCredsInteractive();
  } else {
    try {
      creds = await gatherCredsViaBrowser();
    } catch (err) {
      console.log('');
      console.log(`Browser prompt unavailable (${err.message}). Falling back to terminal.`);
      console.log('');
      creds = await gatherCredsInteractive();
    }
  }

  printPlan(creds);

  if (!NON_INTERACTIVE) {
    const tty = getInteractiveInput();
    const rl = readline.createInterface({ input: tty.stream, output: process.stdout, terminal: true });
    // Default Yes — the user just pasted creds; pressing Enter to proceed is
    // the expected path. Capital Y in [Y/n] indicates Enter accepts.
    const confirm = await prompt(rl, 'Proceed with provisioning? [Y/n]');
    rl.close();
    // tty stream is cached — do not destroy between prompts
    const answer = String(confirm).trim().toLowerCase();
    // Empty input = default Yes. Only an explicit non-yes answer aborts.
    if (answer && !/^y(es)?$/.test(answer)) {
      console.log('Aborted by user.');
      process.exit(2);
    }
  }

  // Lazy-require so --help and prompts don't pay the bootstrap import cost.
  console.log('Loading provisioning service...');
  const { provisionEnvironment, wipeEnvironment } = require('../services/pingoneProvisionService');
  console.log('Provisioning service loaded.');

  // --- WIPE-ENVIRONMENT MODE -----------------------------------------------
  // Replaces the normal provisioning flow with a destructive wipe of every
  // app/resource/group/attr/user in the env. Default-no y/N confirmation —
  // explicit "y" required to proceed. We previously asked the user to type
  // the env id back, but that's hostile when the user can paste the id (no
  // actual safety vs. typo benefit) so we just show the id prominently in
  // the question instead.
  if (WIPE_ENVIRONMENT) {
    if (!NON_INTERACTIVE) {
      console.log('Opening confirmation prompt...');
      let tty;
      try {
        tty = getInteractiveInput();
      } catch (err) {
        console.error(`Failed to open /dev/tty for wipe confirmation: ${err.message}`);
        console.error('Pass --non-interactive to skip the prompt (uses PINGONE_BOOTSTRAP_* env vars).');
        process.exit(1);
      }
      const rl = readline.createInterface({ input: tty.stream, output: process.stdout, terminal: true });
      console.log('');
      console.log('💣  --wipe-environment will DELETE every app, resource server, group,');
      console.log('    custom user attribute, and user in environment:');
      console.log('');
      console.log(`      ${creds.envId}`);
      console.log('');
      console.log('    (preserving only the worker app being used to authenticate)');
      console.log('');
      // Capital N in [y/N] makes it visually clear default is "no" — wipe
      // is destructive, so empty Enter must abort, not proceed. We don't
      // pass defaultValue here; empty input falls through to the regex check
      // below which only matches y/yes.
      const answer = await prompt(rl, 'Wipe this environment? [y/N]');
      rl.close();
      // tty stream is cached — do not destroy between prompts
      const a = String(answer).trim().toLowerCase();
      if (!/^y(es)?$/.test(a)) {
        console.log('Aborted — empty / non-yes answer.');
        process.exit(2);
      }
    }
    console.log('');
    console.log('═'.repeat(60));
    console.log('  PingOne wipe');
    console.log('═'.repeat(60));
    console.log('Authenticating with PingOne (acquiring management worker token)...');
    const summary = await wipeEnvironment(creds, (s) => {
      console.log(`  ${s.icon || '·'}  ${s.message || ''}`);
    });
    console.log('');
    console.log(`Wipe complete:  ${summary.deleted.apps} apps, ${summary.deleted.resources} resources, ${summary.deleted.groups} groups, ${summary.deleted.attrs} attributes, ${summary.deleted.users} users deleted.`);
    if (summary.failed.length > 0) {
      // Per-item failures (e.g. PingOne rejecting a delete because of a
      // lingering reference) are SOFT errors — they don't invalidate the
      // wipe-then-provision flow. We log them as warnings but exit 0 so the
      // parent setup:fresh continues to bootstrap. The provision step is
      // idempotent and will overwrite any survivors. Use exit 1 only for
      // fatal failures earlier in the call (auth, can't list, etc.) — those
      // throw out of wipeEnvironment and reach the outer catch.
      console.log(`${summary.failed.length} item(s) could not be deleted (continuing — provisioning will overwrite/reuse them).`);
      for (const f of summary.failed) {
        console.log(`  - ${f.kind} '${f.name}': ${f.error}`);
      }
    }
    process.exit(0);
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log('  PingOne provisioning');
  console.log('═'.repeat(60));
  console.log('');

  // Group the wizard's ~30 step keys into 6 user-readable phases. Each phase
  // gets a banner the FIRST time we see one of its keys; everything else
  // prints as an indented line under that banner.
  const PHASE_GROUPS = [
    { label: '① Validate worker creds',  keys: ['validate', 'population'] },
    { label: '② Resource servers',        keys: ['resource-server', 'mcp-resource-server', 'mcp-gw-resource'] },
    { label: '③ Scopes',                  keys: ['scopes', 'mcp-scopes', 'mcp-gw-scopes'] },
    { label: '④ Applications',            keys: ['admin-app', 'admin-config', 'user-app', 'user-config', 'mcp-app', 'mcp-config', 'worker-app', 'mcp-exchanger-app', 'mcp-gw-app', 'mcp-gw-config', 'agent-app', 'agent-config'] },
    { label: '⑤ Scope grants',            keys: ['admin-grants', 'user-grants', 'mcp-grants', 'mcp-gw-grants', 'agent-grants', 'password-policy'] },
    { label: '⑥ Demo users + claims',     keys: ['demoUser', 'demoUser-password', 'demoAdmin', 'demoAdmin-password', 'demo-roles', 'demoDelegate', 'demoDelegate-password', 'isDelegate-schema', 'demoDelegate-flag', 'bankDelegates-group', 'schema-attr', 'spel-claim', 'may-act-claim', 'is-delegate-claim', 'mayAct-schema', 'agentRestrictions-schema', 'agentRestrictions-user', 'agentRestrictions-admin'] },
    { label: '⑦ Write .env',              keys: ['config'] },
  ];
  const phaseSeen = new Set();

  let lastIcon = '';
  let stepCount = 0;
  const counters = { created: 0, exists: 0, failed: 0 };
  const onStep = (step) => {
    stepCount++;
    const icon = step.icon || '·';
    const msg = step.message || step.step || '';
    lastIcon = icon;

    // Print phase banner the first time we see a key from a new phase.
    const group = PHASE_GROUPS.find(g => g.keys.includes(step.step));
    if (group && !phaseSeen.has(group.label)) {
      phaseSeen.add(group.label);
      console.log('');
      console.log(`▶ ${group.label}`);
      console.log(`  ${'─'.repeat(56)}`);
    }

    // Tally outcomes by icon — provisionEnvironment uses ✅ for created and
    // ⚠️ for "already exists". Failures use ❌.
    if (icon === '✅') counters.created++;
    else if (icon === '⚠️') counters.exists++;
    else if (icon === '❌') counters.failed++;

    console.log(`  ${icon}  ${msg}`);
  };

  // Optionally wipe existing Demo resources before provisioning.
  // Used when changing hostname or wanting a guaranteed-clean tenant.
  if (RECREATE_APPS) {
    await wipeExistingResources(creds);
  }

  try {
    const result = await provisionEnvironment(creds, onStep);

    // Write setup-config.md before the success summary so the user sees the
    // file path in the closing block.
    const configPath = writeSetupConfigMd(creds, result, counters, stepCount);

    console.log('');
    console.log('═'.repeat(60));
    console.log('  PingOne provisioning complete');
    console.log('═'.repeat(60));
    console.log('');
    console.log(`  ${stepCount} steps run:`);
    console.log(`    ✅  ${counters.created} created`);
    if (counters.exists > 0) console.log(`    ⚠️   ${counters.exists} already existed (reused)`);
    if (counters.failed > 0) console.log(`    ❌  ${counters.failed} failed (see lines above)`);
    console.log('');

    if (result?.provisioned?.demoUser?.password ||
        result?.provisioned?.demoAdmin?.password ||
        result?.provisioned?.demoDelegate?.password) {
      console.log('  Demo credentials (also saved in demo_api_server/.env):');
      if (result.provisioned.demoUser?.password) {
        console.log(`    demoUser      ${result.provisioned.demoUser.password}`);
      }
      if (result.provisioned.demoAdmin?.password) {
        console.log(`    demoAdmin     ${result.provisioned.demoAdmin.password}`);
      }
      if (result.provisioned.demoDelegate?.password) {
        console.log(`    demoDelegate  ${result.provisioned.demoDelegate.password}  (delegated user)`);
      }
      console.log('');
    }
    console.log('  Files written:');
    console.log('    demo_api_server/.env          all PingOne credentials');
    if (configPath) console.log(`    ${path.relative(process.cwd(), configPath).padEnd(30)}reference dump (resource IDs, demo creds, all non-secret config)`);
    console.log('');

    // TraT claims setup — non-fatal, runs after provisioning is complete.
    try {
      const { execSync } = require('child_process');
      execSync('node scripts/setupTratClaims.js', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
    } catch (err) {
      console.warn('[Bootstrap] TraT claims setup failed (non-fatal):', err.message);
    }

    // Offer to auto-run ./run.sh restart so the running services pick up
    // the new .env. Skipped under --non-interactive (CI / scripted runs print
    // the instruction and exit). The repo root is two levels up from this
    // script: demo_api_server/scripts/bootstrapPingOne.js → repo root.
    const REPO_ROOT = path.resolve(__dirname, '..', '..');
    const runBankSh = path.join(REPO_ROOT, 'run.sh');
    const runBankAvailable = require('fs').existsSync(runBankSh);

    if (NON_INTERACTIVE || FROM_INSTALLER || !runBankAvailable) {
      if (!FROM_INSTALLER) {
        console.log('  Restart services so they pick up the new .env values:');
        console.log(`    cd ${REPO_ROOT} && ./run.sh restart`);
        console.log('');
      }
      process.exit(0);
    }

    // Interactive — prompt to run it now.
    const tty = getInteractiveInput();
    const rl = readline.createInterface({ input: tty.stream, output: process.stdout, terminal: true });
    const answer = await prompt(rl, 'Restart services now? [Y/n]');
    rl.close();
    // tty stream is cached — do not destroy between prompts

    const trimmed = String(answer || '').trim();
    const yes = trimmed === '' || /^y(es)?$/i.test(trimmed);
    if (!yes) {
      console.log('');
      console.log('  Skipping. Restart later with:');
      console.log(`    cd ${REPO_ROOT} && ./run.sh restart`);
      console.log('');
      process.exit(0);
    }

    console.log('');
    console.log(`  Running: ${runBankSh} restart`);
    console.log('');
    const restartResult = require('child_process').spawnSync(runBankSh, ['restart'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    if (restartResult.error) {
      console.error('');
      console.error(`  Failed to spawn run.sh: ${restartResult.error.message}`);
      console.error(`  Run it manually: cd ${REPO_ROOT} && ./run.sh restart`);
      process.exit(1);
    }
    process.exit(restartResult.status || 0);
  } catch (err) {
    // If the worker credentials were rejected by PingOne and we used cached creds,
    // clear the cache and re-exec so the user is prompted for fresh credentials.
    // Guard with IS_RETRY so we only do this once — if the new creds also fail, exit.
    if (err.pingone?.code === 'invalid_client' && !IS_RETRY) {
      const hadCache = (() => { try { return require('fs').existsSync(CRED_CACHE_PATH); } catch (_) { return false; } })();
      if (hadCache) {
        console.error('');
        console.error('  PingOne rejected the worker credentials (invalid_client).');
        console.error('  This usually means the Client ID or Secret is wrong, or the worker app');
        console.error('  was deleted/rotated in the PingOne console.');
        console.error(`  Clearing cached credentials at ${CRED_CACHE_PATH} and re-opening the form…`);
        console.error('');
        clearCredCache();
        const { spawnSync } = require('child_process');
        const result = spawnSync(process.execPath, [__filename, ...args, '--_retry'], { stdio: 'inherit' });
        process.exit(result.status ?? 1);
      }
    }

    console.log('');
    console.log('═'.repeat(60));
    console.log('  Bootstrap failed');
    console.log('═'.repeat(60));
    console.error('');
    console.error(`  Error: ${err.message}`);
    console.error('');
    console.error('  Last step icon emitted:', lastIcon || '(none)');
    console.error(`  Counters before failure: ${counters.created} created, ${counters.exists} already existed, ${counters.failed} failed`);
    console.error('');
    console.error('  PingOne resources created up to this point are preserved (no rollback).');
    console.error('  Re-running this command is safe — idempotent steps will report "already exists" and reuse.');
    console.error('');
    process.exit(1);
  }
}

// Global error capture. When bootstrap is run as a child of setupFresh, the
// parent's runChild tees our stderr into setup.log — so all of these errors
// land there too. When run standalone, they go to terminal stderr only.
process.on('uncaughtException', (err) => {
  console.error('');
  console.error('UNCAUGHT EXCEPTION (bootstrap):');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('');
  console.error('UNHANDLED PROMISE REJECTION (bootstrap):');
  console.error(reason && reason.stack ? reason.stack : String(reason));
  process.exit(1);
});

main().catch((e) => {
  console.error(`Unexpected error: ${e.message}`);
  if (e && e.stack) console.error(e.stack);
  process.exit(1);
});
