/**
 * agentCCTokenService with a client the identity sidecar manages (ff_agent_identity_sidecar).
 * The machine-token form goes through the relay with no secret; PingOne's own error, relayed by
 * the sidecar, is rejected exactly as a direct error is; unmanaged is unchanged.
 */
const axios = require('axios');

jest.mock('axios');
const mockConfig = { secret: undefined };
jest.mock('../../services/configStore', () => ({
  getEffective: (key) => {
    const map = {
      pingone_mcp_token_exchanger_client_id: 'exchanger-client',
      pingone_mcp_token_exchanger_client_secret: mockConfig.secret,
      pingone_mcp_token_exchanger_cc_auth_method: 'post',
    };
    return map[key];
  },
}));
jest.mock('../../services/oauthEndpointResolver', () => ({
  getPingOneTokenEndpoint: () => 'https://auth.pingone.com/test-env/as/token',
}));
jest.mock('../../utils/tokenUtils', () => ({ decodeJwt: () => ({ claims: { sub: 'exchanger-client' } }) }));
const mockRelay = { manages: jest.fn(), post: jest.fn() };
jest.mock('../../services/sidecarClientRelay', () => mockRelay);

const { getAgentCCToken } = require('../../services/agentCCTokenService');

const ok = { status: 200, data: { access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'mcp:invoke' } };

describe('getAgentCCToken — sidecar-managed client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.secret = undefined;
  });

  it('a managed client with no local secret is fetched through the relay, with no secret sent', async () => {
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockResolvedValue(ok);

    const out = await getAgentCCToken({}, { scope: ['mcp:invoke'] });

    expect(out.access_token).toBe('tok');
    expect(axios.post).not.toHaveBeenCalled();
    const [kind, body] = mockRelay.post.mock.calls[0];
    expect(kind).toBe('token');
    const form = new URLSearchParams(body.toString());
    expect(form.get('client_id')).toBe('exchanger-client');
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('mcp:invoke');
    expect(form.has('client_secret')).toBe(false);
  });

  it('even a locally held secret is not sent once the sidecar manages the client', async () => {
    mockConfig.secret = 'local-secret';
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockResolvedValue(ok);

    await getAgentCCToken({});

    expect(new URLSearchParams(mockRelay.post.mock.calls[0][1].toString()).has('client_secret')).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('PingOne\'s error relayed by the sidecar is rejected the way a direct error is', async () => {
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockRejectedValue(Object.assign(new Error('Request failed'), {
      response: { status: 401, data: { error: 'invalid_client', error_description: 'Client authentication failed' } },
    }));

    await expect(getAgentCCToken({})).rejects.toMatchObject({ code: 'invalid_client', httpStatus: 401 });
  });

  it('a relay that cannot reach the sidecar is an error, not a fallback to the local secret', async () => {
    mockConfig.secret = 'local-secret';
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockRejectedValue(new Error('Identity sidecar relay (token) unreachable (ECONNREFUSED)'));

    await expect(getAgentCCToken({})).rejects.toThrow(/unreachable/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('unmanaged with no secret is still the original "not configured" error', async () => {
    mockRelay.manages.mockResolvedValue(false);
    await expect(getAgentCCToken({})).rejects.toMatchObject({ code: 'agent_not_configured', httpStatus: 503 });
    expect(mockRelay.post).not.toHaveBeenCalled();
  });

  it('unmanaged with a secret goes to PingOne directly, as before', async () => {
    mockConfig.secret = 'local-secret';
    mockRelay.manages.mockResolvedValue(false);
    axios.post.mockResolvedValue(ok);

    await getAgentCCToken({});

    expect(mockRelay.post).not.toHaveBeenCalled();
    expect(new URLSearchParams(axios.post.mock.calls[0][1]).get('client_secret')).toBe('local-secret');
  });
});
