/**
 * Focused apiClient tests: the OTel span + X-Request-ID correlation
 * interceptors appended after every other interceptor (see apiClient.js).
 */
/* eslint-disable import/first -- jest.mock must run before axios import */

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
      defaults: { headers: { common: {} } },
    },
  };
});

import axios from 'axios';
import { isSpanContextValid } from '@opentelemetry/api';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import '../apiClient';

const mockClient = axios.create.mock.results[0].value;

// Every existing interceptor is registered first (see apiClient.js) — the
// OTel pair is appended last: request index 4, response index 4.
const requestCalls = mockClient.interceptors.request.use.mock.calls;
const responseCalls = mockClient.interceptors.response.use.mock.calls;
const otelRequestFn = requestCalls[requestCalls.length - 1][0];
const [otelResponseSuccessFn, otelResponseErrorFn] = responseCalls[responseCalls.length - 1];

// Must run BEFORE the "with a registered provider" block below: apiClient.js
// captures its `tracer` reference once at module load via @opentelemetry/api's
// ProxyTracer, which lazily delegates to whichever real provider registers
// later — but only forward, never back. trace.disable() (needed to reset
// between tests) breaks that delegation for a tracer reference obtained
// before the disable() call, so the provider below is registered exactly
// once, after this no-provider case is already verified.
describe('apiClient OTel span + X-Request-ID correlation — no provider registered', () => {
  it('no-ops (no header, no stashed span)', () => {
    const config = { method: 'get', url: '/api/accounts', headers: {} };
    const out = otelRequestFn(config);
    expect(out.headers['X-Request-ID']).toBeUndefined();
    expect(out._otelSpan).toBeUndefined();
  });
});

describe('apiClient OTel span + X-Request-ID correlation — with a registered provider', () => {
  beforeAll(() => {
    new WebTracerProvider().register();
  });

  it('sets X-Request-ID to the active span trace ID', () => {
    const config = { method: 'get', url: '/api/accounts', headers: {} };
    const out = otelRequestFn(config);

    expect(out.headers['X-Request-ID']).toMatch(/^[0-9a-f]{32}$/);
    expect(isSpanContextValid(out._otelSpan.spanContext())).toBe(true);
  });

  it('ends the stashed span on a successful response without altering it', () => {
    const config = otelRequestFn({ method: 'get', url: '/api/accounts', headers: {} });
    const endSpy = vi.spyOn(config._otelSpan, 'end');

    const response = { config, status: 200, data: {} };
    const out = otelResponseSuccessFn(response);

    expect(out).toBe(response);
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it('ends the stashed span on an error response and re-rejects unchanged', async () => {
    const config = otelRequestFn({ method: 'get', url: '/api/accounts', headers: {} });
    const endSpy = vi.spyOn(config._otelSpan, 'end');

    const error = { config, response: { status: 500 } };
    await expect(otelResponseErrorFn(error)).rejects.toBe(error);
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when a response has no stashed span (e.g. a pre-existing interceptor short-circuited)', () => {
    expect(() => otelResponseSuccessFn({ config: {} })).not.toThrow();
  });
});
