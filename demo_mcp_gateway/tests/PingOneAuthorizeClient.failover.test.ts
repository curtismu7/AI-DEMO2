// demo_mcp_gateway/tests/PingOneAuthorizeClient.failover.test.ts
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
const decoded: any = { sub: 'u1', scope: 'read', act: { sub: 'agent' } };

describe('PingOneAuthorizeClient real->mock failover', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fails over to the mock base when the real endpoint errors', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))            // real
      .mockResolvedValueOnce({ data: { decision: 'PERMIT' } });    // mock
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/list');
    expect(d.decision).toBe('PERMIT');
    expect(d.engine).toBe('mock-failover');
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      expect.stringContaining('http://authz-server:9001/governance/'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('does NOT fail over on a valid real DENY', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'DENY' } });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/list');
    expect(d.decision).toBe('DENY');
    expect(d.engine).toBe('real');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('does NOT fail over when primary already equals the mock', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('down'));
    const client = new PingOneAuthorizeClient({ ...baseConfig, pingAuthorizeEndpoint: 'http://authz-server:9001' });
    const d = await client.evaluate(decoded, 'tools/list');
    expect(d.decision).toBe('DENY');
    expect(d.engine).toBe('mock');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
