'use strict';

/**
 * Phase 267 — mortgage Path A: routing + Authorize-layer scope decision.
 *
 *   1. Routing — show_mortgage is an apikey tool that resolves to the
 *      banking_mortgage_service URL; other apikey tools stay Gateway-only.
 *   2. Scope decision — mortgage:read is enforced by the Authorize
 *      layer, NOT the tool dispatch. When PingOne Authorize is unconfigured
 *      both transports apply evaluateScopeDecisionLocally(), which must mirror
 *      what a PA policy returns. This test proves the HTTP client
 *      (PingOneAuthorizeClient.evaluate) and the WS guard
 *      (pingAuthorizeGuard.guardToolCall) reach the SAME PERMIT/DENY outcome.
 */

import axios from 'axios';
import { routeTool, backendHttpUrl } from '../src/router';
import {
  evaluateScopeDecisionLocally,
  getScopesForGatewayTool,
} from '../src/auth/toolScopes';
import { PingOneAuthorizeClient } from '../src/auth/PingOneAuthorizeClient';
import { guardToolCall } from '../src/pingAuthorizeGuard';
import { buildApiKeyToolResult } from '../src/apiKeyDispatch';
import type { GatewayConfig } from '../src/config';
import type { DecodedGatewayToken } from '../src/tokenValidator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CONFIG = {
  mortgageServiceBaseUrl: 'http://localhost:8082',
  mortgageServiceApiKey: 'demo-mortgage-key-0000',
  // PingAuthorize intentionally NOT configured — exercises the local decision.
  pingAuthorizeEndpoint: '',
  pingAuthorizeWorkerId: '',
  p1azEnabled: false,
  gatewayResourceUri: 'https://gateway.example.com',
} as unknown as GatewayConfig;

const tokenWith = (scope: string): DecodedGatewayToken =>
  ({ sub: 'user-1', scope, aud: 'mcp-gw', exp: 9999999999 } as DecodedGatewayToken);

describe('Phase 267 — show_mortgage routing', () => {
  test('show_mortgage routes to the apikey disposition', () => {
    expect(routeTool('show_mortgage')).toBe('apikey');
  });

  test('backendHttpUrl returns the mortgage service URL for show_mortgage', () => {
    expect(backendHttpUrl('apikey', 'show_mortgage', CONFIG)).toBe(
      'http://localhost:8082/mortgage',
    );
  });

  test('other apikey tools stay Gateway-only (empty URL → static marker)', () => {
    expect(backendHttpUrl('apikey', 'user_profile_card', CONFIG)).toBe('');
    expect(backendHttpUrl('apikey', 'anything_else', CONFIG)).toBe('');
  });
});

describe('Phase 267 — local Authorize scope decision', () => {
  test('show_mortgage requires mortgage:read', () => {
    expect(getScopesForGatewayTool('show_mortgage')).toEqual([
      'mortgage:read',
    ]);
  });

  test('missing scope → DENY (insufficient_scope)', () => {
    const d = evaluateScopeDecisionLocally(
      'show_mortgage',
      'openid profile read write',
    );
    expect(d.decision).toBe('DENY');
    if (d.decision === 'DENY') {
      expect(d.missingScopes).toEqual(['mortgage:read']);
      expect(d.reason).toMatch(/insufficient_scope/);
    }
  });

  test('scope present → PERMIT', () => {
    expect(
      evaluateScopeDecisionLocally(
        'show_mortgage',
        'openid read mortgage:read',
      ),
    ).toEqual({ decision: 'PERMIT' });
  });

  test('empty / undefined scope claim → DENY (fails closed)', () => {
    expect(evaluateScopeDecisionLocally('show_mortgage', '').decision).toBe('DENY');
    expect(
      evaluateScopeDecisionLocally('show_mortgage', undefined).decision,
    ).toBe('DENY');
  });

  test('irregular whitespace in the claim is tolerated', () => {
    expect(
      evaluateScopeDecisionLocally(
        'show_mortgage',
        '  read   mortgage:read  ',
      ),
    ).toEqual({ decision: 'PERMIT' });
  });
});

describe('Phase 267 — HTTP and WS transports behave identically (no-PA mode)', () => {
  const httpClient = new PingOneAuthorizeClient(CONFIG);

  test('both DENY when mortgage:read is absent', async () => {
    const decoded = tokenWith('openid read');

    const http = await httpClient.evaluate(decoded, 'tools/call', 'show_mortgage');
    const ws = await guardToolCall('show_mortgage', decoded, CONFIG);

    expect(http.decision).toBe('DENY');
    expect(ws.permitted).toBe(false);
    // Same logical reason on both transports.
    expect(http.reason).toMatch(/insufficient_scope/);
    expect(ws.reason).toMatch(/insufficient_scope/);
  });

  test('both PERMIT when mortgage:read is present', async () => {
    const decoded = tokenWith('openid read mortgage:read');

    const http = await httpClient.evaluate(decoded, 'tools/call', 'show_mortgage');
    const ws = await guardToolCall('show_mortgage', decoded, CONFIG);

    expect(http.decision).toBe('PERMIT');
    expect(ws.permitted).toBe(true);
  });

  test('a read-only tool still PERMITs with a basic bearer (no regression)', async () => {
    const decoded = tokenWith('openid read');

    const http = await httpClient.evaluate(decoded, 'tools/call', 'get_my_accounts');
    const ws = await guardToolCall('get_my_accounts', decoded, CONFIG);

    expect(http.decision).toBe('PERMIT');
    expect(ws.permitted).toBe(true);
  });
});

// REGRESSION: the api_key dispatch is a SINGLE shared function
// (buildApiKeyToolResult) called by BOTH transports. Before this, the
// dispatch was inlined in the WS handler only; HTTP POST /mcp raw-proxied
// show_mortgage to the OLB upstream → "Unknown tool". This block proves the
// shared dispatch reaches banking_mortgage_service and shapes the result —
// the exact behaviour both index.ts (WS) and authorizeMcpRequest.ts (HTTP)
// now depend on (BL-02 transport parity).
describe('Phase 267 — shared api_key dispatch (buildApiKeyToolResult, BL-02)', () => {
  beforeEach(() => mockedAxios.get.mockReset());

  test('show_mortgage → calls mortgage service with X-API-Key + X-User-Sub, no OAuth', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { mortgage: { id: 'mtg-001' } } });

    const out = await buildApiKeyToolResult('show_mortgage', 'user-1', 'AB12', CONFIG);

    expect(out.ok).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:8082/mortgage',
      expect.objectContaining({
        headers: { 'X-API-Key': 'demo-mortgage-key-0000', 'X-User-Sub': 'user-1' },
      }),
    );
    if (out.ok) {
      const r = out.result as { content: Array<{ text: string }>; _meta: Record<string, unknown> };
      expect(JSON.parse(r.content[0].text)).toEqual({ mortgage: { id: 'mtg-001' } });
      expect(r._meta.backend).toBe('demo_data_service');
      expect(r._meta.credentialPath).toBe('api_key');
    }
    // No Authorization header anywhere — the OAuth bearer is dropped at the gateway.
    const callOpts = mockedAxios.get.mock.calls[0][1] as { headers: Record<string, string> };
    expect(callOpts.headers).not.toHaveProperty('Authorization');
  });

  test('mortgage backend 401 → JSON-RPC error -32401 (api-key rejected)', async () => {
    mockedAxios.get.mockResolvedValue({ status: 401, data: {} });
    const out = await buildApiKeyToolResult('show_mortgage', 'user-1', 'AB12', CONFIG);
    expect(out).toEqual(
      expect.objectContaining({ ok: false, code: -32401 }),
    );
  });

  test('mortgage backend unreachable → JSON-RPC error -32500', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await buildApiKeyToolResult('show_mortgage', 'user-1', 'AB12', CONFIG);
    expect(out).toEqual(
      expect.objectContaining({ ok: false, code: -32500 }),
    );
  });

  test('apikey tool with no real backend → Phase 266 Gateway-only marker (no axios call)', async () => {
    const out = await buildApiKeyToolResult('user_profile_card', 'user-1', 'AB12', CONFIG);
    expect(out.ok).toBe(true);
    expect(mockedAxios.get).not.toHaveBeenCalled();
    if (out.ok) {
      const r = out.result as { content: Array<{ text: string }> };
      expect(r.content[0].text).toBe('API_KEY_PATH_MARKER');
    }
  });
});
