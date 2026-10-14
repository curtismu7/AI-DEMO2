'use strict';
jest.mock('../../../services/tokenValidationService');
jest.mock('../../../services/oboConfig', () => ({
  getOboConfig: () => ({ audience: 'obo-demo.ping.demo', issuer: 'https://iss', jwksUri: 'https://iss/jwks' }),
}));
const { validateToken } = require('../../../services/tokenValidationService');
const { verifyDownstream } = require('../../../services/oboDownstream');

test('accepts a token with the OBO audience and an act object', async () => {
  validateToken.mockResolvedValue({ sub: 'u1', act: { client_id: 'agent' } });
  const r = await verifyDownstream('t');
  expect(r).toEqual({ status: 200, acting_for: 'u1', acted_by: { client_id: 'agent' } });
  expect(validateToken).toHaveBeenCalledWith('t', { jwksUri: 'https://iss/jwks', issuer: 'https://iss', audience: 'obo-demo.ping.demo' });
});

test('rejects a valid token that has no act claim', async () => {
  validateToken.mockResolvedValue({ sub: 'u1' });
  expect((await verifyDownstream('t')).status).toBe(401);
});

test('rejects act as a bare string', async () => {
  validateToken.mockResolvedValue({ sub: 'u1', act: 'agent' });
  expect((await verifyDownstream('t')).status).toBe(401);
});

test('rejects when validation throws (wrong audience, bad signature)', async () => {
  validateToken.mockRejectedValue(new Error('jwt audience invalid'));
  const r = await verifyDownstream('t');
  expect(r.status).toBe(401);
  expect(r.error).toMatch(/audience/);
});
