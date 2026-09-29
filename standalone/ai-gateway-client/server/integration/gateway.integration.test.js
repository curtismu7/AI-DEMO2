'use strict';
const test = require('node:test');
const { readIntegrationConfig, withRelayServer } = require('./support');
const { runGatewayChecks } = require('./gatewayChecks');

test('same bearer can use the allowed app and receives 403 on the denied app', async () => {
  // Validate operator inputs before starting the relay or making any request.
  const { token, fixture } = readIntegrationConfig();
  await withRelayServer((baseUrl) => runGatewayChecks({ baseUrl, fixture, token }));
});
