'use strict';

const safeRequestLogUrl = require('../../utils/safeRequestLogUrl');

describe('safeRequestLogUrl', () => {
  test('omits all query parameters from the PF OAuth callback access-log URL', () => {
    expect(safeRequestLogUrl({
      originalUrl: '/api/pf-ai-agent/cimd/callback?code=single-use-code&state=csrf-state&error_description=private',
    })).toBe('/api/pf-ai-agent/cimd/callback');
  });

  test('omits all query parameters from the AIC OAuth callback access-log URL', () => {
    expect(safeRequestLogUrl({ originalUrl: '/api/aic-demo/callback?code=single-use-code&state=csrf-state' }))
      .toBe('/api/aic-demo/callback');
  });

  test('redacts the RAR user key from request URLs', () => {
    expect(safeRequestLogUrl({
      originalUrl: '/api/pf-ai-agent/rar/start?scenario=allowed&userKey=private-user&debug=true',
    })).toBe('/api/pf-ai-agent/rar/start?scenario=allowed&debug=true');
  });

  test('preserves the full URL for other routes', () => {
    expect(safeRequestLogUrl({ originalUrl: '/api/pf-ai-agent/status?tab=features' }))
      .toBe('/api/pf-ai-agent/status?tab=features');
  });
});
