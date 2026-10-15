#!/usr/bin/env node
'use strict';
/**
 * auth-cookie.js — sign in as the demo customer through the app's own pi.flow
 * API (the modal's endpoints, no browser) and print the session Cookie header,
 * so promptfoo can call /api/agent/invoke authenticated:
 *
 *   AGENT_COOKIE="$(node promptfoo/auth-cookie.js)" npx promptfoo eval ...
 *
 * Prints ONLY the header value, never credentials. Credentials come from
 * demo_api_server/.env (DEMO_USER_*), the one place that defines them; the
 * stale E2E_* copies in .env.e2e are only a fallback. Target: E2E_BASE_URL.
 *
 * Needs the local server's pi.flow sign-in: aic_login_enabled must be off (AIC
 * login redirects to ForgeRock instead) and the account must finish at the
 * password step (an OTP / device / passkey step cannot be scripted).
 */
const fs = require('fs');
const path = require('path');

const UI_ROOT = path.resolve(__dirname, '..', '..', 'demo_api_ui');
const USER_API = '/api/auth/oauth/user';

/** Cookies that apply to baseUrl's host, as a Cookie header. Throws without a session cookie. */
function cookieHeader(cookies, baseUrl) {
  const host = new URL(baseUrl).hostname;
  const applies = (c) => {
    const d = c.domain.replace(/^\./, '');
    return host === d || host.endsWith(`.${d}`);
  };
  const mine = cookies.filter(applies);
  if (!mine.some((c) => c.name === 'connect.sid')) {
    throw new Error(`login finished but no connect.sid cookie was set for ${host}`);
  }
  return mine.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** KEY=VALUE lines into env; existing keys win, like playwright.config.js. */
function parseEnvFile(text, env) {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    env[key] = val;
  }
}

/** The credentials-step reply -> the URL that completes the login, or a clear error. */
function afterCredentials(status, body) {
  if (status === 401) throw new Error(body.message || 'username or password is incorrect');
  if (status === 409) throw new Error(`pi.flow was not started (${body.error || 'pi_flow_not_started'})`);
  if (body.redirectTo) return body.redirectTo;
  if (body.step) throw new Error(`sign-in needs an extra "${body.step}" step, which cannot be scripted`);
  throw new Error(`unexpected credentials reply (HTTP ${status})`);
}

async function main() {
  const { seedDemoCredentials } = require(path.join(UI_ROOT, 'tests/helpers/demoCredentials'));
  const { mainCheckoutPath } = require(path.join(UI_ROOT, 'tests/e2e/helpers/repoRoots'));
  seedDemoCredentials(); // demo_api_server/.env outranks the stale .env.e2e copy
  for (const file of [path.join(UI_ROOT, 'tests/e2e/.env.e2e'), mainCheckoutPath('demo_api_ui/tests/e2e/.env.e2e')]) {
    if (file && fs.existsSync(file)) parseEnvFile(fs.readFileSync(file, 'utf8'), process.env);
  }
  const { E2E_CUSTOMER_USERNAME: username, E2E_CUSTOMER_PASSWORD: password } = process.env;
  if (!username || !password) throw new Error('no customer credentials: set DEMO_USER_USERNAME/PASSWORD in demo_api_server/.env');
  const base = process.env.E2E_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'https://ai-demo.ping-devops.com';

  const jar = new Map();
  const call = async (url, init = {}) => {
    const res = await fetch(new URL(url, base), {
      redirect: 'manual',
      ...init,
      headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(init.headers || {}) },
    });
    for (const line of res.headers.getSetCookie()) {
      const kv = line.split(';')[0];
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return res;
  };

  const opened = await call(`${USER_API}/login?pi_flow=1&force=true`);
  if (opened.status !== 200) {
    throw new Error(`pi.flow did not open (HTTP ${opened.status}); with aic_login_enabled on, login redirects to AIC instead`);
  }
  const creds = await call(`${USER_API}/pi-flow/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  let next = afterCredentials(creds.status, await creds.json().catch(() => ({})));
  for (let hop = 0; next && hop < 8; hop += 1) { // callback -> app: sets the authenticated session
    const res = await call(next);
    next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
  }
  const status = await call(`${USER_API}/status`);
  const body = await status.json().catch(() => ({}));
  if (!(body.authenticated || body.isAuthenticated || body.user)) throw new Error('login completed but the session is not authenticated');

  const host = new URL(base).hostname;
  process.stdout.write(cookieHeader([...jar].map(([name, value]) => ({ name, value, domain: host })), base));
}

module.exports = { cookieHeader, parseEnvFile, afterCredentials };

if (require.main === module) {
  main().catch((e) => { console.error(`[auth-cookie] ${e.message}`); process.exit(1); });
}
