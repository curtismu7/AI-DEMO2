'use strict';
const { callPingGateway } = require('../services/pingGatewayClient');
test('callPingGateway is a function returning a promise', () => {
  expect(typeof callPingGateway).toBe('function');
  const p = callPingGateway('GET', '/nope').catch(() => 'rejected'); // no gateway in unit env
  expect(p).toBeInstanceOf(Promise);
  return expect(p).resolves.toBeDefined();
});
