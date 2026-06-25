/**
 * @file configStore-saas.test.js
 * @description Vercel + KV vs env-only read-only behavior.
 */

describe('configStore SaaS / Vercel', () => {
  let origVercel;
  let origKvUrl;
  let origKvTok;

  beforeEach(() => {
    origVercel = process.env.VERCEL;
    origKvUrl = process.env.KV_REST_API_URL;
    origKvTok = process.env.KV_REST_API_TOKEN;
  });

  afterEach(() => {
    if (origVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = origVercel;
    if (origKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = origKvUrl;
    if (origKvTok === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = origKvTok;
    jest.resetModules();
  });

  it('isReadOnly is false when VERCEL and KV credentials are set', () => {
    process.env.VERCEL = '1';
    process.env.KV_REST_API_URL = 'https://x.upstash.io';
    process.env.KV_REST_API_TOKEN = 'tok';
    const configStore = require('../../services/configStore');
    expect(configStore.isReadOnly()).toBe(false);
  });

  it('isReadOnly is false with SQLite storage backend', () => {
    process.env.VERCEL = '1';
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const configStore = require('../../services/configStore');
    expect(configStore.isReadOnly()).toBe(false);
    expect(configStore.getStorageType()).toBe('lmdb');
  });
});
