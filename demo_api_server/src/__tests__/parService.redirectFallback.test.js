// demo_api_server/src/__tests__/parService.redirectFallback.test.js
'use strict';

/**
 * Runtime harden: when PingOne rejects the preferred redirect_uri, try every
 * known demo host before failing the live intent-binding demo.
 */
jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const {
  pushAuthorizationRequestWithRedirectFallback,
  isParRedirectUriMismatch,
} = require('../../services/parService');

describe('pushAuthorizationRequestWithRedirectFallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects Redirect URI mismatch', () => {
    expect(isParRedirectUriMismatch('PAR push failed: Redirect URI mismatch')).toBe(true);
    expect(isParRedirectUriMismatch(new Error('invalid_client'))).toBe(false);
  });

  it('returns on first successful redirect_uri', async () => {
    axios.post.mockResolvedValueOnce({
      data: { request_uri: 'urn:ietf:params:oauth:request_uri:ok', expires_in: 60 },
    });
    const result = await pushAuthorizationRequestWithRedirectFallback(
      'https://auth.example/as/par',
      'client',
      'secret',
      { scope: 'openid', authorization_details: [{ amount: 80 }] },
      [
        'https://local.ping-devops.com:4000/api/auth/oauth/ai-agent-placeholder-callback',
        'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback',
      ],
    );
    expect(result.requestUri).toBe('urn:ietf:params:oauth:request_uri:ok');
    expect(result.redirectUri).toContain('local.ping-devops.com');
    expect(result.usedFallback).toBe(false);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('retries next known host after Redirect URI mismatch', async () => {
    axios.post
      .mockRejectedValueOnce({
        response: { data: { error_description: 'Redirect URI mismatch' } },
      })
      .mockResolvedValueOnce({
        data: { request_uri: 'urn:ietf:params:oauth:request_uri:fallback', expires_in: 60 },
      });

    const result = await pushAuthorizationRequestWithRedirectFallback(
      'https://auth.example/as/par',
      'client',
      'secret',
      { scope: 'openid' },
      [
        'https://local.ping-devops.com:4000/api/auth/oauth/ai-agent-placeholder-callback',
        'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback',
      ],
    );

    expect(result.requestUri).toBe('urn:ietf:params:oauth:request_uri:fallback');
    expect(result.redirectUri).toContain('api.ping.demo');
    expect(result.usedFallback).toBe(true);
    expect(result.triedRedirects).toHaveLength(2);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-mismatch errors', async () => {
    axios.post.mockRejectedValueOnce({
      response: { data: { error: 'invalid_client' } },
    });
    await expect(
      pushAuthorizationRequestWithRedirectFallback(
        'https://auth.example/as/par',
        'client',
        'secret',
        { scope: 'openid' },
        [
          'https://local.ping-devops.com:4000/api/auth/oauth/ai-agent-placeholder-callback',
          'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback',
        ],
      ),
    ).rejects.toThrow(/invalid_client/);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
