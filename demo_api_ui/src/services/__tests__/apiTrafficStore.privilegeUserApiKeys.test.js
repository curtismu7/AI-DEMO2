import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fields = ['api_key', 'api_secret', 'apiKey', 'apiSecret', 'current_password', 'currentPassword'];
let store;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  store = await import('../apiTrafficStore');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('browser Privilege credential redaction', () => {
  it.each(fields)('redacts %s case-insensitively at every depth without mutating the body', (field) => {
    const key = field.toUpperCase();
    const body = [{ [key]: 'synthetic', nested: { [field]: 'synthetic' }, count: 2 }, 'safe', null];
    const original = structuredClone(body);
    expect(store.redactBody(body)).toEqual([{ [key]: '***', nested: { [field]: '***' }, count: 2 }, 'safe', null]);
    expect(body).toEqual(original);
  });

  it('redacts both bodies before ring-buffer insertion and localStorage persistence', () => {
    store.appendTrafficEntry({ requestBody: { nested: { api_key: 'synthetic' } }, responseBody: { rows: [{ APISECRET: 'synthetic' }] } });
    expect(store.getAll()[0].requestBody).toEqual({ nested: { api_key: '***' } });
    expect(store.getAll()[0].responseBody).toEqual({ rows: [{ APISECRET: '***' }] });
    vi.advanceTimersByTime(1500);
    expect(JSON.parse(localStorage.getItem('api-traffic-store'))).toEqual(store.getAll());
    expect(localStorage.getItem('api-traffic-store')).not.toContain('synthetic');
  });
});
