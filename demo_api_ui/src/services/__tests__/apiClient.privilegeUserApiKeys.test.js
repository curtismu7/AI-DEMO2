import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';

let apiClient;
let store;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  apiClient = (await import('../apiClient')).default;
  store = await import('../apiTrafficStore');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function adapterFor(status, data) {
  return async (config) => {
    const response = { config, status, statusText: 'test', headers: {}, data };
    if (status >= 400) throw new AxiosError('Synthetic failure', 'ERR_BAD_RESPONSE', config, null, response);
    return response;
  };
}

describe('apiClient traffic-capture opt-out', () => {
  it.each([200, 500])('keeps an opted-out %s request and its response out of memory and localStorage', async (status) => {
    const result = apiClient.post('/api/admin/privilege-user-api/credentials', { api_key: 'synthetic-request', current_password: 'synthetic-password' }, {
      _skipTrafficCapture: true, _silent: true, adapter: adapterFor(status, { users: ['synthetic-response'] }),
    });
    if (status >= 400) await expect(result).rejects.toMatchObject({ response: { status } });
    else expect((await result).data).toEqual({ users: ['synthetic-response'] });
    vi.advanceTimersByTime(1500);
    expect(store.getAll()).toEqual([]);
    expect(localStorage.getItem('api-traffic-store')).toBeNull();
  });

  it.each([200, 500])('still captures a normal %s request with redacted request and response bodies', async (status) => {
    const result = apiClient.post('/api/synthetic', { apiKey: 'synthetic-request', label: 'safe' }, {
      _silent: true, adapter: adapterFor(status, { nested: { api_secret: 'synthetic-response' }, ok: true }),
    });
    if (status >= 400) await expect(result).rejects.toMatchObject({ response: { status } });
    else await result;
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]).toMatchObject({ status, requestBody: { apiKey: '***', label: 'safe' }, responseBody: { nested: { api_secret: '***' }, ok: true } });
    vi.advanceTimersByTime(1500);
    expect(JSON.parse(localStorage.getItem('api-traffic-store'))).toEqual(store.getAll());
    expect(localStorage.getItem('api-traffic-store')).not.toContain('synthetic-request');
    expect(localStorage.getItem('api-traffic-store')).not.toContain('synthetic-response');
  });
});
