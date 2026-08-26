'use strict';

/**
 * The Node gateway's half of the JIT credential broker.
 *
 * Before this, demo_mcp_gateway read the backend service key from process.env
 * once at boot and reused it for the process lifetime -- it never called the
 * broker at all, so "agents never see a real credential" was only true on the
 * PingGateway path. This makes the broker the single chokepoint for BOTH
 * gateways, so the claim does not quietly become false when
 * ff_mcp_gateway_pinggateway is flipped.
 */

import axios from 'axios';
import { buildApiKeyToolResult } from '../src/apiKeyDispatch';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const BASE = {
  apiResourceServerBaseUrl: 'http://localhost:8082',
  apiResourceServerApiKey: 'static-key-from-env',
  mcpResourceServerApiKey: 'static-invest-key',
  bffVaultKeyUrl: 'https://demo-api-server:3001/internal/vault/service-key',
  bffInternalSecret: 'test-internal-secret',
} as unknown as GatewayConfig;

const withJit = (on: boolean) => ({ ...BASE, jitCredentialsEnabled: on }) as GatewayConfig;

/** Record the outbound calls so we can assert what the backend actually got. */
function stubCalls(credential = 'minted.jwt.value') {
  const calls: Array<{ url: string; cfg: any }> = [];
  mockedAxios.get.mockImplementation(async (url: string, cfg: any) => {
    calls.push({ url, cfg });
    if (url.includes('/internal/vault/service-key')) {
      return { status: 200, data: { name: 'DEMO_API_RESOURCE_SERVER_KEY', value: credential } };
    }
    return { status: 200, data: { mortgage: { id: 'mtg-001' } } };
  });
  return calls;
}

describe('gateway fetches a JIT credential per call', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  test('OFF: sends the static env key and never calls the broker', async () => {
    const calls = stubCalls();
    await buildApiKeyToolResult('show_mortgage', 'user-1', undefined, withJit(false));

    expect(calls.some((c) => c.url.includes('service-key'))).toBe(false);
    const backend = calls.find((c) => c.url.includes('/mortgage'));
    expect(backend?.cfg.headers['X-API-Key']).toBe('static-key-from-env');
  });

  test('ON: fetches per call and sends the minted credential, not the static key', async () => {
    const calls = stubCalls('minted.jwt.value');
    await buildApiKeyToolResult('show_mortgage', 'user-1', undefined, withJit(true));

    const broker = calls.find((c) => c.url.includes('service-key'));
    expect(broker).toBeDefined();
    expect(broker?.cfg.headers['x-internal-gateway-secret']).toBe('test-internal-secret');

    const backend = calls.find((c) => c.url.includes('/mortgage'));
    expect(backend?.cfg.headers['X-API-Key']).toBe('minted.jwt.value');
    expect(backend?.cfg.headers['X-API-Key']).not.toBe('static-key-from-env');
  });

  test('ON: binds the credential to this tool and its backend route', async () => {
    const calls = stubCalls();
    await buildApiKeyToolResult('show_permit', 'user-1', undefined, withJit(true));

    const broker = calls.find((c) => c.url.includes('service-key'));
    // aud is the backend route segment the backend gates on; tool rides along.
    expect(broker?.url).toContain('aud=permit');
    expect(broker?.url).toContain('tool=show_permit');
  });

  test('ON: fails closed when the broker refuses — never falls back to the static key', async () => {
    const calls: Array<{ url: string }> = [];
    mockedAxios.get.mockImplementation(async (url: string) => {
      calls.push({ url });
      if (url.includes('service-key')) return { status: 503, data: { error: 'requester_revoked' } };
      return { status: 200, data: {} };
    });

    const out = await buildApiKeyToolResult('show_mortgage', 'user-1', undefined, withJit(true));

    expect(out.ok).toBe(false);
    // The backend must never be reached with a static key after a refusal.
    expect(calls.some((c) => c.url.includes('/mortgage'))).toBe(false);
  });

  test('ON: the invest tool uses its own key name', async () => {
    const calls = stubCalls();
    await buildApiKeyToolResult('show_investment', 'user-1', undefined, withJit(true));

    const broker = calls.find((c) => c.url.includes('service-key'));
    expect(broker?.url).toContain('name=DEMO_MCP_RESOURCE_SERVER_KEY');
    expect(broker?.url).toContain('aud=invest');
  });
});
