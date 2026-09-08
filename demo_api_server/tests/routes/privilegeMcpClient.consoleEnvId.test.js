'use strict';

// The Privilege console API is tenanted on the tenant that owns the Agentic
// Apps, which is NOT the banking environment. Proven from the gateway log: the
// app reference base64-decodes to `0428ba4f-…@@@default@@@opensearch22`.
//
// consoleEnvId() read PRIVILEGE_SSO_ENV_ID first and nothing else. That variable
// is currently the banking env — startupConfigGuard warns about exactly that
// pairing on every boot — so every console read queried
// /api/<banking-env>/v1/applications and could never return these apps. The door
// store stayed empty however many times an operator pasted a console token.
//
// PRIVILEGE_CONSOLE_ENV_ID is its own variable rather than a repoint of
// PRIVILEGE_SSO_ENV_ID, which is paired with PRIVILEGE_SSO_CLIENT_ID/_SECRET for
// a client_credentials grant. standalone/ai-gateway-client has always kept the
// two apart under this same name.

const express = require('express');
const request = require('supertest');

const CONSOLE_ENV = '0428ba4f-169c-436b-aff9-b230496e0e3b';
const BANKING_ENV = '01d89b06-66d5-430e-9f28-65636843788b';

const ENV_KEYS = ['PRIVILEGE_CONSOLE_ENV_ID', 'PRIVILEGE_SSO_ENV_ID', 'PINGONE_ENVIRONMENT_ID'];
let saved;

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'console-env-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

// Capture the environment id the console call is actually addressed to.
function captureConsoleFetch(seen) {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    seen.push(u);
    const body = u.endsWith('/session-token')
      ? { session_id: 'sid-1' }
      : { Applications: [], PacPolicys: [] };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  });
}

beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.restoreAllMocks();
});

describe('console inventory targets the Privilege tenant', () => {
  test('PRIVILEGE_CONSOLE_ENV_ID wins over the SSO/banking env', async () => {
    process.env.PRIVILEGE_CONSOLE_ENV_ID = CONSOLE_ENV;
    process.env.PRIVILEGE_SSO_ENV_ID = BANKING_ENV;
    process.env.PINGONE_ENVIRONMENT_ID = BANKING_ENV;
    const seen = [];
    captureConsoleFetch(seen);

    await request(buildApp())
      .post('/api/privilege-mcp/console/connect')
      .send({ authToken: 'console-cookie' })
      .expect(200);

    const apps = seen.find((u) => u.includes('/v1/applications'));
    expect(apps).toContain(`/api/${CONSOLE_ENV}/v1/applications`);
    expect(apps).not.toContain(BANKING_ENV);
    expect(seen.some((u) => u.includes(`/api/${CONSOLE_ENV}/v1/pacpolicys`))).toBe(true);
  });

  test('falls back to the previous behaviour when the new var is unset', async () => {
    delete process.env.PRIVILEGE_CONSOLE_ENV_ID;
    process.env.PRIVILEGE_SSO_ENV_ID = BANKING_ENV;
    const seen = [];
    captureConsoleFetch(seen);

    await request(buildApp())
      .post('/api/privilege-mcp/console/connect')
      .send({ authToken: 'console-cookie' })
      .expect(200);

    expect(seen.find((u) => u.includes('/v1/applications'))).toContain(`/api/${BANKING_ENV}/`);
  });
});
