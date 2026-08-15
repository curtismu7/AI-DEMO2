'use strict';

/**
 * Path C (bankingdata) dispatch — routing + HTTP transport parity.
 */

import axios from 'axios';
import { routeTool, backendHttpUrl } from '../src/router';
import { buildBankingDataToolResult } from '../src/bankingDataDispatch';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CONFIG = {
  bankingResourceServerBaseUrl: 'https://api.ping.demo:3001',
} as unknown as GatewayConfig;

describe('Path C — bankingdata routing', () => {
  test('demo_show_accounts / demo_show_transactions route to bankingdata', () => {
    expect(routeTool('demo_show_accounts')).toBe('bankingdata');
    expect(routeTool('demo_show_transactions')).toBe('bankingdata');
  });

  test('backendHttpUrl resolves accounts and transactions routes', () => {
    expect(backendHttpUrl('bankingdata', 'demo_show_accounts', CONFIG)).toBe(
      'https://api.ping.demo:3001/api/resource-server/accounts',
    );
    expect(backendHttpUrl('bankingdata', 'demo_show_transactions', CONFIG)).toBe(
      'https://api.ping.demo:3001/api/resource-server/transactions',
    );
  });
});

describe('Path C — buildBankingDataToolResult', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns oauth_bearer result on 200', async () => {
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { accounts: [{ id: 'chk-1' }] },
    });
    const out = await buildBankingDataToolResult('demo_show_accounts', 'tok', CONFIG);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { _meta: { credentialPath: string; backendRoute: string } };
    expect(result._meta.credentialPath).toBe('oauth_bearer');
    expect(result._meta.backendRoute).toBe('/api/resource-server/accounts');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.ping.demo:3001/api/resource-server/accounts',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok' },
      }),
    );
  });

  test('maps 401 to Access token invalid', async () => {
    mockedAxios.get.mockResolvedValue({ status: 401, data: {} });
    const out = await buildBankingDataToolResult('demo_show_accounts', 'tok', CONFIG);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe(-32401);
    expect(out.message).toMatch(/Access token invalid/);
  });

  test('maps network failure to Backend route unreachable', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await buildBankingDataToolResult('demo_show_transactions', 'tok', CONFIG);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe(-32500);
    expect(out.message).toMatch(/Backend route unreachable/);
  });

  // MCP spec (2025-06-18+) structured tool output: a CallToolResult SHOULD carry
  // structuredContent alongside content[].text so a client can consume the data
  // without JSON-parsing text — demo_api_server/services/attackSimulatorService.js:1600-1603
  // already reads structuredContent defensively but nothing ever populated it.
  test('carries structuredContent matching the backend payload, alongside content[].text', async () => {
    const payload = { accounts: [{ id: 'chk-1', balance: 100 }] };
    mockedAxios.get.mockResolvedValue({ status: 200, data: payload });
    const out = await buildBankingDataToolResult('demo_show_accounts', 'tok', CONFIG);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { structuredContent: unknown; content: Array<{ text: string }> };
    expect(result.structuredContent).toEqual(payload);
    expect(JSON.parse(result.content[0].text)).toEqual(payload);
  });
});
