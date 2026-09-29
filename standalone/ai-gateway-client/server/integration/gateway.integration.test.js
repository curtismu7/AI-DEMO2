'use strict';
const test = require('node:test');
const { readIntegrationConfig, withRelayServer } = require('./support');
const { runGatewayChecks } = require('./gatewayChecks');

test('same identity uses door-scoped bearers for allowed access and policy denial', async () => {
  // Validate operator inputs before starting the relay or making any request.
  const { token, deniedToken, fixture } = readIntegrationConfig();
  await withRelayServer((baseUrl) => runGatewayChecks({ baseUrl, fixture, token, deniedToken }));
});
