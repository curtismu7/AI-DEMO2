#!/usr/bin/env node
/**
 * One command for the URL smoke spec (tests/e2e/url-smoke.spec.js):
 *
 *   npm run test:e2e:smoke                      start vite on a free port, run the spec, stop vite
 *   npm run test:e2e:smoke -- --headed          extra arguments go to `playwright test`
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 BANKING_UI_PORT=4000 npm run test:e2e:smoke    use a UI that is already running
 *   PLAYWRIGHT_BASE_URL=https://host npm run test:e2e:smoke                     test a deployment
 *
 * The script this replaces was `playwright test tests/e2e/url-smoke.spec.js`, whose config starts `npm start`
 * (vite on 5173) and then waits for a UI on :4000, so it only ever worked against an already-running stack.
 *
 * Not in the CI job list on purpose: the spec visits ~110 routes in a real browser (minutes on a loaded runner,
 * most of it Vite compiling each page the first time). It is the manual / pre-release lock; CI keeps the fast
 * static checks (check-ui-patterns, the Vitest suites) and the one-spec movie-reel lock.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(HERE, '..');

/** Decide whether this run needs its own dev server, from the environment. Pure, so it is unit tested. */
export function planRun(env = process.env) {
  const own = !(env.PLAYWRIGHT_SKIP_WEBSERVER === '1' || env.PLAYWRIGHT_SKIP_WEBSERVER === 'true' || env.PLAYWRIGHT_BASE_URL || env.BASE_URL);
  return { startServer: own };
}

/** The playwright command line for a UI on `port` (or the caller's own target when no server is started). */
export function playwrightArgs(extra = []) {
  return ['test', 'tests/e2e/url-smoke.spec.js', ...extra];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the dev server did not answer on ${url} within ${ms / 1000}s`);
}

async function main() {
  const extra = process.argv.slice(2);
  const env = { ...process.env };
  let vite = null;
  if (planRun(env).startServer) {
    const port = await freePort();
    vite = spawn(path.join(UI, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: UI, stdio: 'ignore' });
    env.BANKING_UI_PORT = String(port);
    env.PLAYWRIGHT_SKIP_WEBSERVER = '1';
    env.CI = env.CI || 'true';
    await waitFor(`http://127.0.0.1:${port}/`, 120000);
  }
  const stop = () => vite && !vite.killed && vite.kill('SIGTERM');
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  const pw = spawn(path.join(UI, 'node_modules/.bin/playwright'), playwrightArgs(extra), { cwd: UI, env, stdio: 'inherit' });
  pw.on('exit', (code) => {
    stop();
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
