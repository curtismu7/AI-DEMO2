/**
 * agentCCTokenService — scope + vertical options.
 * The agent token must carry the requested scopes (write-toggle picker) and a
 * `vertical` claim so PingOne Authorize can scope tools/list per vertical.
 */
const axios = require('axios');

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: (key) => {
    const map = {
      pingone_mcp_token_exchanger_client_id: 'agent-client',
      pingone_mcp_token_exchanger_client_secret: 'agent-secret',
      pingone_mcp_token_exchanger_cc_auth_method: 'post',
    };
    return map[key];
  },
}));
jest.mock('../../config/oauth', () => ({ tokenEndpoint: 'https://auth.pingone.com/token' }));
jest.mock('../../utils/tokenUtils', () => ({ decodeJwt: () => ({ claims: { sub: 'agent-client' } }) }));

const { getAgentCCToken } = require('../../services/agentCCTokenService');

describe('getAgentCCToken — scope + vertical', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'records:read' } });
  });

  it('requests the given scopes and includes vertical in the token request body', async () => {
    await getAgentCCToken({}, { scope: ['records:read'], vertical: 'healthcare' });
    const body = axios.post.mock.calls[0][1]; // URLSearchParams (string after toString)
    const params = new URLSearchParams(body);
    expect(params.get('scope')).toBe('records:read');
    expect(params.get('vertical')).toBe('healthcare');
  });

  it('returns scope and vertical on the result for the token cache', async () => {
    const out = await getAgentCCToken({}, { scope: ['records:read', 'write'], vertical: 'healthcare' });
    expect(out.scope).toBe('records:read'); // echoed from PingOne response
    expect(out.vertical).toBe('healthcare');
    expect(out.access_token).toBe('tok');
  });
});
