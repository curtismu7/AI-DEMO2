'use strict';
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => null) }));
const configStore = require('../../services/configStore');
const { prereqs } = require('../../services/checks/configCheck');

describe('configCheck', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { jest.clearAllMocks(); process.env = { ...OLD_ENV }; });
  afterAll(() => { process.env = OLD_ENV; });

  test('fails when real P1AZ prereqs missing', async () => {
    configStore.getEffective.mockReturnValue(null);
    const r = await prereqs.run({ flags: { ff_authorize_simulated: false } });
    expect(r.status).toBe('fail');
    expect(r.meta.missing).toEqual(expect.arrayContaining(['authorize_worker_client_id', 'authorize_decision_endpoint_id']));
  });

  test('passes when real P1AZ prereqs present', async () => {
    configStore.getEffective.mockReturnValue('set');
    const r = await prereqs.run({ flags: { ff_authorize_simulated: false } });
    expect(r.status).toBe('pass');
  });

  test('fails when simulated+gateway+jwks needs AUTHZ_JWT_SECRET', async () => {
    delete process.env.AUTHZ_JWT_SECRET;
    const r = await prereqs.run({ flags: { ff_authorize_simulated: true, ff_mcp_gateway_pinggateway: true, ff_mcp_gateway_jwks: true } });
    expect(r.status).toBe('fail');
    expect(r.meta.missing).toContain('AUTHZ_JWT_SECRET');
  });
});
