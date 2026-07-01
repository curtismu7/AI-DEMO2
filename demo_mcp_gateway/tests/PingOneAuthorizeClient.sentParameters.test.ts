// demo_mcp_gateway/tests/PingOneAuthorizeClient.sentParameters.test.ts
import axios from 'axios';
import { PingOneAuthorizeClient } from '../src/auth/PingOneAuthorizeClient';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const baseConfig: any = {
  pingAuthorizeEndpoint: 'https://real.example/authz',
  pingAuthorizeMockBase: 'http://authz-server:9001',
  pingAuthorizeWorkerId: 'mcp-gateway',
  gatewayResourceUri: 'mcpgateway.ping.demo',
  p1azEnabled: true,
};
const decoded: any = { sub: 'u1', scope: 'read transfer', act: { sub: 'agent' } };

describe('PingOneAuthorizeClient — sentParameters', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the exact attributes sent to the decision endpoint', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { decision: 'PERMIT', decision_id: 'dec-abc', policy_version: 'cloud-v7' },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer', { amount: 100 });

    expect(d.decision).toBe('PERMIT');
    expect(d.decisionId).toBe('dec-abc');
    expect(d.policyVersion).toBe('cloud-v7');
    expect(d.sentParameters).toBeDefined();
    expect(d.sentParameters!.ToolName).toBe('create_transfer');
    expect(d.sentParameters!.ClientId).toBe('u1');
    expect(d.sentParameters!.ActClientId).toBe('agent');
    expect(d.sentParameters!.TransactionAmount).toBe('100');
    expect(d.sentParameters!.TokenScopes).toBe('read transfer');
  });

  it('omits sentParameters on the no-P1AZ local-scope fallback', async () => {
    const client = new PingOneAuthorizeClient({ ...baseConfig, p1azEnabled: false, pingAuthorizeEndpoint: '' });
    const d = await client.evaluate(decoded, 'tools/call', 'get_my_accounts', {});
    expect(d.sentParameters).toBeUndefined();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});