'use strict';

/**
 * MCP spec (2025-06-18+) structured tool output — a CallToolResult SHOULD
 * carry structuredContent alongside content[].text. Mirrors the same fix in
 * bankingDataDispatch.ts (see bankingDataDispatch.test.ts).
 */

import axios from 'axios';
import { buildDualTokenToolResult } from '../src/dualTokenDispatch';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CONFIG = {
  bankingResourceServerBaseUrl: 'https://api.ping.demo:3001',
  bffInternalIdTokenUrl: 'https://api.ping.demo:3001/internal/id-token',
  bffInternalSecret: 'dev-shared-secret-change-me',
} as unknown as GatewayConfig;

describe('buildDualTokenToolResult — structuredContent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('carries structuredContent matching the identity payload, alongside content[].text', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { idToken: 'id-tok' } });
    const payload = { sub: 'u1', claims: { name: 'Test User' } };
    mockedAxios.post.mockResolvedValue({ status: 200, data: payload });

    const out = await buildDualTokenToolResult('user_profile_card', 'tok', 'u1', CONFIG);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { structuredContent: unknown; content: Array<{ text: string }> };
    expect(result.structuredContent).toEqual(payload);
    expect(JSON.parse(result.content[0].text)).toEqual(payload);
  });
});
