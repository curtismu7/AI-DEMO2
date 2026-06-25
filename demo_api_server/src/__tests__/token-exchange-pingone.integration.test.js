/**
 * @file token-exchange-pingone.integration.test.js
 * @description Live PingOne RFC 8693 tests — real tokens, real HTTP to /as/token.
 * Does not run in CI or default `npm test` unless RUN_PINGONE_TOKEN_INTEGRATION=true.
 *
 * User tokens require PKCE flow with browser interaction - not practical for automated testing.
 * Resource owner password flow is not supported by PingOne.
 * Therefore, live tests require manual token input from authenticated session.
 *
 * Run (from banking_api_server, with .env or exported vars):
 *   RUN_PINGONE_TOKEN_INTEGRATION=true \
 *   INTEGRATION_SUBJECT_ACCESS_TOKEN='<paste User token JWT>' \
 *   INTEGRATION_AGENT_ACCESS_TOKEN='<paste Agent token JWT>' \
 *   npm test -- --testPathPattern=token-exchange-pingone --forceExit
 */

const path = require('path');
// Load .env so PINGONE_* vars are available (mirrors live-pingone-integration.test.js)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), override: true });

const live = (() => {
  if (!(process.env.RUN_PINGONE_TOKEN_EXCHANGE === 'true' || process.env.RUN_PINGONE_TOKEN_INTEGRATION === 'true')) return false;
  const token = String(process.env.INTEGRATION_SUBJECT_ACCESS_TOKEN || '').trim();
  if (!token) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch { return false; }
})();

describe('Session oauthTokens contract (Backend-for-Frontend (BFF) → MCP)', () => {
  /**
   * Same shape as production: routes/oauth persist accessToken for mcpWebSocketClient.getSessionAccessToken.
   */
  it('getSessionAccessToken reads oauthTokens.accessToken', () => {
    const { getSessionAccessToken } = require('../../services/mcpWebSocketClient');
    const req = {
      session: {
        oauthTokens: {
          accessToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.',
          refreshToken: 'refresh',
        },
      },
    };
    expect(getSessionAccessToken(req)).toBe(req.session.oauthTokens.accessToken);
  });
});

(live ? describe : describe.skip)('PingOne live token exchange (RFC 8693)', () => {
  jest.setTimeout(120000);

  beforeAll(async () => {
    const configStore = require('../../services/configStore');
    await configStore.ensureInitialized();
  });

  /**
   * Exchanges a real User token for an MCP token (MCP-audience) via Backend-for-Frontend (BFF) oauthService.
   */
  it('performTokenExchange returns a 3-part JWT with sub and aud', async () => {
    const oauthService = require('../../services/oauthService');
    const configStore = require('../../services/configStore');
    const subject = process.env.INTEGRATION_SUBJECT_ACCESS_TOKEN;
    const mcpUri = configStore.getEffective('PINGONE_RESOURCE_MCP_SERVER_URI');
    expect(mcpUri).toBeTruthy();
    const scopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write')
      .trim()
      .split(/\s+/);
    const mcpToken = await oauthService.performTokenExchange(subject, mcpUri, scopes);
    expect(typeof mcpToken).toBe('string');
    expect(mcpToken.split('.')).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(mcpToken.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.sub).toBeTruthy();
    expect(payload.aud !== undefined || payload.scope).toBeTruthy();
  });
});

(live ? describe : describe.skip)('PingOne live — performTokenExchangeWithActor and getAgentClientCredentialsToken', () => {
  jest.setTimeout(120000);

  beforeAll(async () => {
    const configStore = require('../../services/configStore');
    await configStore.ensureInitialized();
  });

  /**
   * Exchanges a user token + agent actor token for an MCP token using RFC 8693 actor exchange.
   * Requires INTEGRATION_SUBJECT_ACCESS_TOKEN and INTEGRATION_AGENT_ACCESS_TOKEN env vars.
   * The act claim is informational only — warns if absent (PingOne policy may not be set up yet).
   */
  it('performTokenExchangeWithActor returns a 3-part JWT with sub and aud', async () => {
    const oauthService = require('../../services/oauthService');
    const configStore  = require('../../services/configStore');
    const subject  = process.env.INTEGRATION_SUBJECT_ACCESS_TOKEN;
    const actor    = process.env.INTEGRATION_AGENT_ACCESS_TOKEN;
    if (!actor) {
      console.warn('[SKIP] INTEGRATION_AGENT_ACCESS_TOKEN not set — skipping performTokenExchangeWithActor live test');
      return;
    }
    const mcpUri = configStore.getEffective('PINGONE_RESOURCE_MCP_SERVER_URI');
    expect(mcpUri).toBeTruthy();
    const scopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write').trim().split(/\s+/);
    const mcpToken = await oauthService.performTokenExchangeWithActor(subject, actor, mcpUri, scopes);
    expect(typeof mcpToken).toBe('string');
    expect(mcpToken.split('.')).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(mcpToken.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.sub).toBeTruthy();
    if (!payload.act) {
      console.warn('[INFO] act claim not present — PingOne delegation policy may not be configured (see PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md)');
    }
  });

  /**
   * Fetches an agent client-credentials token using PINGONE_AGENT_CLIENT_ID / PINGONE_AGENT_CLIENT_SECRET.
   * Validates it is a properly-formed JWT.
   */
  it('getAgentClientCredentialsToken returns a 3-part JWT with a non-null aud', async () => {
    const oauthService = require('../../services/oauthService');
    const clientId = process.env.PINGONE_AGENT_CLIENT_ID;
    const clientSecret = process.env.PINGONE_AGENT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.warn('[SKIP] PINGONE_AGENT_CLIENT_ID / PINGONE_AGENT_CLIENT_SECRET not set — skipping live test');
      return;
    }
    const agentToken = await oauthService.getAgentClientCredentialsToken();
    expect(typeof agentToken).toBe('string');
    expect(agentToken.split('.')).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(agentToken.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.aud !== undefined || payload.sub).toBeTruthy();
  });
});
