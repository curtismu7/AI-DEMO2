/**
 * MCP inspector timeout override — the BFF gives MCP transports 15s (WebSocket,
 * HTTP) to 30s (stdio, hosted PingOne MCP) before answering or falling back.
 * apiClient's blanket 10s timeout aborted those calls in the browser while the
 * server went on to succeed, stacking "timeout of 10000ms exceeded" toasts over
 * a working inspector. Inspector URLs get 35s; everything else keeps the default.
 */
/* eslint-disable import/first -- vi.mock must run before axios import */

import { describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => {
  const mockClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: vi.fn(() => mockClient),
      get: mockClient.get,
      post: mockClient.post,
      defaults: { headers: { common: {} } },
    },
  };
});

import axios from 'axios';
import '../apiClient';

const mockClient = axios.create.mock.results[0].value;
// Request interceptors in registration order: 0 = spinner, 1 = traffic start,
// 2 = auth token, 3 = MCP inspector timeout override.
const timeoutInterceptor = mockClient.interceptors.request.use.mock.calls[3][0];

describe('apiClient MCP inspector timeout override', () => {
  it('raises the timeout to 35s for /api/mcp/inspector/* calls', () => {
    const config = timeoutInterceptor({ url: '/api/mcp/inspector/pingone-tools', timeout: 10000 });
    expect(config.timeout).toBe(35000);
  });

  it('leaves every other URL on the default timeout', () => {
    const config = timeoutInterceptor({ url: '/api/accounts/my', timeout: 10000 });
    expect(config.timeout).toBe(10000);
  });
});
