'use strict';

/**
 * MCP spec (2025-06-18+) structured tool output — a CallToolResult SHOULD
 * carry structuredContent alongside content[].text. Mirrors the same fix in
 * bankingDataDispatch.ts and dualTokenDispatch.ts.
 *
 * Only the real backend-dispatch branch gets structuredContent — the
 * Phase 266 gateway-only marker path (no backend call, literal
 * 'API_KEY_PATH_MARKER' text) has no data to carry, so it's left alone.
 */

import axios from 'axios';
import { buildApiKeyToolResult } from '../src/apiKeyDispatch';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CONFIG = {
  apiResourceServerBaseUrl: 'https://api.ping.demo:3001',
  apiResourceServerApiKey: 'service-key-ABCD',
} as unknown as GatewayConfig;

describe('buildApiKeyToolResult — structuredContent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('real backend dispatch (show_health_record) carries structuredContent matching the payload', async () => {
    const payload = { recordId: 'rec-1', patient: 'Jane Doe' };
    mockedAxios.get.mockResolvedValue({ status: 200, data: payload });

    const out = await buildApiKeyToolResult('show_health_record', 'u1', undefined, CONFIG);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { structuredContent: unknown; content: Array<{ text: string }> };
    expect(result.structuredContent).toEqual(payload);
    expect(JSON.parse(result.content[0].text)).toEqual(payload);
  });

  test('gateway-only marker path (special_offers) has no structuredContent — nothing to carry', async () => {
    const out = await buildApiKeyToolResult('special_offers', 'u1', undefined, CONFIG);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { structuredContent?: unknown };
    expect(result.structuredContent).toBeUndefined();
  });
});
