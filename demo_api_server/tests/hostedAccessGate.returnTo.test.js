'use strict';

// The wall bounces a signed-out browser to the front-door login. The original query string
// (e.g. ?return_to=/mfa-test on the app login) must ride along, or the page the user started on is lost.
const { createHostedAccessGate } = require('../middleware/hostedAccessGate');

function run(url) {
  const gate = createHostedAccessGate({ policy: { enabled: true }, hasApproval: () => false });
  const res = { redirect: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
  gate({ method: 'GET', originalUrl: url, url, headers: { accept: 'text/html' }, hostedSession: {}, session: {} }, res, jest.fn());
  return res.redirect.mock.calls[0]?.[0];
}

describe('hosted access wall redirect keeps the return path', () => {
  test('keeps the query string of the gated URL', () => {
    expect(run('/api/auth/oauth/user/login?return_to=%2Fmfa-test'))
      .toBe('/api/auth/hosted-access/login?return_to=%2Fapi%2Fauth%2Foauth%2Fuser%2Flogin%3Freturn_to%3D%252Fmfa-test');
  });
});
