'use strict';

import axios from 'axios';
import { guardToolsList } from '../src/pingAuthorizeGuard';
import type { GatewayConfig } from '../src/config';
import type { DecodedGatewayToken } from '../src/tokenValidator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const config = {
  p1azEnabled: true,
  pingAuthorizeEndpoint: 'http://localhost:9999',
  pingAuthorizeWorkerId: 'policy-1',
  gatewayResourceUri: 'mcpgateway.ping.demo',
} as unknown as GatewayConfig;

const decoded = {
  sub: 'demoUser',
  scope: 'records:read',
  act: { sub: 'agent-1' },
} as unknown as DecodedGatewayToken;

describe('guardToolsList — per-tool advice parsing', () => {
  beforeEach(() => mockedAxios.post.mockReset());

  it('parses AllowedVertical and DeniedTools advice', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        decision: 'PERMIT',
        advice: [
          { name: 'AllowedVertical', value: 'healthcare' },
          { name: 'DeniedTools', value: JSON.stringify([{ name: 'book_appointment', reason: 'insufficient_scope: requires write' }]) },
        ],
      },
    } as never);

    const out = await guardToolsList(decoded, config, 'healthcare', ['view_records', 'book_appointment']);
    expect(out.permitted).toBe(true);
    expect(out.allowedVertical).toBe('healthcare');
    expect(out.deniedTools?.[0].name).toBe('book_appointment');
    expect(out.deniedTools?.[0].reason).toMatch(/write/);
  });

  it('sends CandidateTools, TokenScopes, and Vertical in the decision request', async () => {
    mockedAxios.post.mockResolvedValue({ data: { decision: 'PERMIT', advice: [] } } as never);
    await guardToolsList(decoded, config, 'healthcare', ['view_records']);
    const body = (mockedAxios.post.mock.calls[0][1] as { parameters: Record<string, string> }).parameters;
    expect(body.CandidateTools).toBe(JSON.stringify(['view_records']));
    expect(body.TokenScopes).toBe('records:read');
    expect(body.Vertical).toBe('healthcare');
  });

  it('DENY decision returns not permitted', async () => {
    mockedAxios.post.mockResolvedValue({ data: { decision: 'DENY', reason: 'nope' } } as never);
    const out = await guardToolsList(decoded, config, 'healthcare', ['view_records']);
    expect(out.permitted).toBe(false);
  });
});
