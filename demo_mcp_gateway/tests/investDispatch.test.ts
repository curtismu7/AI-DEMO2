'use strict';

import axios from 'axios';
import { routeTool, backendHttpUrl } from '../src/router';
import { getScopesForGatewayTool } from '../src/auth/toolScopes';
import { buildApiKeyToolResult } from '../src/apiKeyDispatch';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const cfg: any = { mortgageServiceBaseUrl: 'http://mortgage-service:8082' };

describe('show_investment api-key disposition', () => {
  test('routes to the apikey disposition', () => {
    expect(routeTool('show_investment')).toBe('apikey');
  });
  test('backend URL targets the /invest route', () => {
    expect(backendHttpUrl('apikey', 'show_investment', cfg)).toBe('http://mortgage-service:8082/invest');
  });
  test('requires invest:read scope', () => {
    expect(getScopesForGatewayTool('show_investment')).toContain('invest:read');
  });
});

// Mirrors tests/mortgageDispatch.test.ts's jest.mock('axios') mechanism —
// this repo has no nock/msw dependency, so outbound HTTP for the shared
// api_key dispatch is stubbed via a mocked axios module, not a network mock.
describe('show_investment _meta', () => {
  beforeEach(() => mockedAxios.get.mockReset());

  test('result _meta carries apiCall and the injected key last4', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { invest: { portfolioId: 'INV-8842' } } });
    const conf: any = {
      mortgageServiceBaseUrl: 'http://mortgage-service:8082',
      mortgageServiceApiKey: 'demo-invest-key-9999', // test fixture, not a real secret
    };
    const out: any = await buildApiKeyToolResult('show_investment', 'user-sub', undefined, conf);
    expect(out.ok).toBe(true);
    expect(out.result._meta.apiCall).toBe('GET /invest');
    expect(out.result._meta.apiKeyMaskedLast4).toBe('9999');
  });

  // Regression: the WS transport (index.ts) passes a MARKER-key-derived
  // last4 as apiKeyMaskedLast4 for ALL apikey tools, real-backend or not.
  // For a real-backend tool like show_investment, the injected
  // config.mortgageServiceApiKey (the key actually sent to the backend) must
  // win over that caller-passed marker last4 in the success _meta.
  test('WS-style call: injected backend key last4 wins over caller-passed marker last4', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { invest: { portfolioId: 'INV-7777' } } });
    const conf: any = {
      mortgageServiceBaseUrl: 'http://mortgage-service:8082',
      mortgageServiceApiKey: 'demo-invest-key-7777', // test fixture, not a real secret
    };
    const out: any = await buildApiKeyToolResult('show_investment', 'sub', '9999', conf);
    expect(out.ok).toBe(true);
    expect(out.result._meta.apiKeyMaskedLast4).toBe('7777');
  });
});
