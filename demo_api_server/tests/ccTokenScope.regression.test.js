/**
 * Regression: getClientCredentialsTokenAs must send an explicit `scope` so a
 * client granted scopes across >1 PingOne resource can mint an audience-bound
 * actor CC token.
 *
 * Bug: the 2-exchange AI Agent / MCP Exchanger apps are intentionally granted
 * scopes on two resources each. A CC request with `audience` but no `scope`
 * makes PingOne try every entitled scope -> spans multiple resources -> 400
 * `invalid_scope: "May not request scopes for multiple resources"`. The middle
 * agent's `get_my_transactions` (and every other tool) then 502'd because the
 * actor token could not be obtained.
 *
 * This locks the request shape at the real seam (the body PingOne receives).
 */
const axios = require('axios');

jest.mock('axios');
jest.mock('../config/oauth', () => ({
  tokenEndpoint: 'https://auth.example.com/env/as/token',
}));

const oauthService = require('../services/oauthService');

describe('getClientCredentialsTokenAs — RFC 8707 single-resource scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });
  });

  function lastPostBody() {
    const [, body] = axios.post.mock.calls[0];
    return new URLSearchParams(body);
  }

  test('includes scope in the token request body when provided', async () => {
    await oauthService.getClientCredentialsTokenAs(
      'agent-client', 'secret', 'agentgateway.ping.demo', 'basic', 'agent:invoke'
    );
    const body = lastPostBody();
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('audience')).toBe('agentgateway.ping.demo');
    expect(body.get('scope')).toBe('agent:invoke');
  });

  test('joins an array scope with spaces', async () => {
    await oauthService.getClientCredentialsTokenAs(
      'mcp-client', 'secret', 'mcp-gateway.ping.demo', 'basic', ['mcp:invoke', 'read']
    );
    expect(lastPostBody().get('scope')).toBe('mcp:invoke read');
  });

  test('omits scope param entirely when not provided (back-compat)', async () => {
    await oauthService.getClientCredentialsTokenAs(
      'c', 's', 'aud.example.com', 'basic'
    );
    expect(lastPostBody().has('scope')).toBe(false);
  });
});
