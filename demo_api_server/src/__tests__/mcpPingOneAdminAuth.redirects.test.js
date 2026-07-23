// demo_api_server/src/__tests__/mcpPingOneAdminAuth.redirects.test.js
'use strict';

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'PUBLIC_APP_URL') return 'https://api.ping.demo:4000';
    return undefined;
  }),
}));

const { _test } = require('../../routes/mcpPingOneAdminAuth');

describe('mcpPingOneAdminAuth inspector redirects', () => {
  const prevCors = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (prevCors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = prevCors;
  });

  it('callbackUrl uses PUBLIC_APP_URL from configStore', () => {
    expect(_test.callbackUrl({})).toBe(
      'https://api.ping.demo:4000/api/mcp/inspector/pingone-admin/callback'
    );
  });

  it('inspectorCallbackUrls always includes both local demo UI hosts', () => {
    process.env.CORS_ORIGIN = '';
    const urls = _test.inspectorCallbackUrls({});
    expect(urls).toEqual(
      expect.arrayContaining([
        'https://api.ping.demo:4000/api/mcp/inspector/pingone-admin/callback',
        'https://local.ping-devops.com:4000/api/mcp/inspector/pingone-admin/callback',
      ])
    );
  });

  it('inspectorCallbackUrls adds origins from CORS_ORIGIN', () => {
    process.env.CORS_ORIGIN = 'https://ai-demo.ping-devops.com,https://example.test:4000';
    const urls = _test.inspectorCallbackUrls({});
    expect(urls).toContain(
      'https://ai-demo.ping-devops.com/api/mcp/inspector/pingone-admin/callback'
    );
    expect(urls).toContain('https://example.test:4000/api/mcp/inspector/pingone-admin/callback');
  });
});
