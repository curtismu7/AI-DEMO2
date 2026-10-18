'use strict';
// ciba_login_enabled ships OFF; CIBA_LOGIN_ENABLED=true is the deploy-time switch.
describe('configStore ciba_login_enabled', () => {
  beforeEach(() => { delete process.env.CIBA_LOGIN_ENABLED; jest.resetModules(); });
  afterAll(() => { delete process.env.CIBA_LOGIN_ENABLED; });

  it('defaults to false', () => {
    const cs = require('../services/configStore');
    expect(String(cs.getEffective('ciba_login_enabled'))).toBe('false');
  });
  it('CIBA_LOGIN_ENABLED env turns it on', () => {
    process.env.CIBA_LOGIN_ENABLED = 'true';
    expect(require('../services/configStore').getEffective('ciba_login_enabled')).toBe('true');
  });
});
