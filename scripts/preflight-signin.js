'use strict';
/**
 * Real customer sign-in against a BFF, for scripts/preflight-demo.sh section 8.
 *
 * Calls loginViaBff directly rather than resolveSession: resolveSession returns a
 * cached cookie, or reads an old session out of LMDB, and either would turn this
 * into a check that passes without anyone signing in.
 *
 * Reads E2E_CUSTOMER_USERNAME/PASSWORD (or DEMO_USER_*) from the environment and
 * never prints them. BFF address: PREFLIGHT_BFF_BASE (default https://api.ping.demo:3001).
 *
 * Exit: 0 signed in · 1 sign-in failed · 2 not run (no credentials).
 */
const path = require('path');
const axios = require(path.resolve(__dirname, '../demo_api_server/node_modules/axios'));
const helpers = path.resolve(__dirname, '../demo_api_server/tests/real/helpers');
const { BFF_BASE, httpsAgent } = require(`${helpers}/constants`);
const { loginViaBff } = require(`${helpers}/session`);

const username = process.env.E2E_CUSTOMER_USERNAME || process.env.DEMO_USER_USERNAME;
const password = process.env.E2E_CUSTOMER_PASSWORD || process.env.DEMO_USER_PASSWORD;
const envId = process.env.PINGONE_ENVIRONMENT_ID;

(async () => {
  if (!username || !password || !envId) {
    console.log('not run: set E2E_CUSTOMER_USERNAME, E2E_CUSTOMER_PASSWORD and PINGONE_ENVIRONMENT_ID');
    process.exit(2);
  }
  const cookie = await loginViaBff({
    envId,
    region: process.env.PINGONE_REGION || 'com',
    username,
    password,
    loginPath: '/api/auth/oauth/user/login',
    callbackPath: '/api/auth/oauth/user/callback',
  });
  const r = await axios.get(`${BFF_BASE}/api/auth/oauth/user/status`, {
    httpsAgent, headers: { Cookie: cookie }, validateStatus: () => true,
  });
  if (r.data && r.data.authenticated === true) {
    console.log(`signed in via ${BFF_BASE}`);
    process.exit(0);
  }
  console.log(`login returned a cookie but status is not authenticated (HTTP ${r.status}, stale=${r.data && r.data.staleSession})`);
  process.exit(1);
})().catch((e) => {
  console.log(`sign-in failed: ${String(e.message).slice(0, 300)}`);
  process.exit(1);
});
