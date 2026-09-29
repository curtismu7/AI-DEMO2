'use strict';
const assert = require('node:assert/strict');
const { configureDoor, postGateway } = require('./support');

async function runGatewayChecks({ baseUrl, fixture, token }) {
  try {
    const configured = await configureDoor(baseUrl, fixture.allowed.url, token);
    assert.equal(configured.status, 200, 'allowed app configuration must succeed');

    const listed = await postGateway(baseUrl, '/tools/list', token, {});
    assert.equal(listed.status, 200, 'allowed app tools/list must succeed');
    const catalog = await listed.json();
    assert.ok(Array.isArray(catalog.tools), 'allowed app must return a tools array');
    assert.ok(catalog.tools.some((tool) => tool.name === fixture.allowed.tool.name),
      'allowed app must expose the configured read-only tool');

    const called = await postGateway(baseUrl, '/tools/call', token, {
      name: fixture.allowed.tool.name,
      arguments: fixture.allowed.tool.arguments || {},
    });
    assert.equal(called.status, 200, 'configured read-only tool call must succeed');
    const rpc = await called.json();
    assert.ok(rpc.result && typeof rpc.result === 'object' && !Array.isArray(rpc.result)
      && Object.keys(rpc.result).length > 0, 'read-only tool must return a nonempty MCP result');
    assert.ok(rpc.result.isError !== true, 'read-only tool result must not report an error');

    // Probe while the allowed app is current; never call a denied live tool.
    const probed = await postGateway(baseUrl, '/doors/probe', token, { urls: [fixture.deniedDoor.url] });
    assert.equal(probed.status, 200, 'door probe route must succeed');
    const probeText = await probed.text();
    assert.ok(!probeText.includes(token), 'door probe failure must not disclose the bearer');
    const probe = JSON.parse(probeText);
    assert.ok(Array.isArray(probe.results), 'door probe must return a results array');
    assert.equal(probe.results.length, 1, 'door probe must return only the configured denied door');
    assert.ok(probe.results[0].url === fixture.deniedDoor.url, 'door probe must identify the configured denied door');
    assert.ok(probe.results[0].ok === false, 'denied door probe must fail');
    const probeStatus = Number.isInteger(probe.results[0].status) ? probe.results[0].status : 'unknown';
    assert.equal(probeStatus, 403,
      `denied door must return policy denial, not 401 or 5xx (upstream HTTP ${probeStatus})`);

    const deniedConfig = await configureDoor(baseUrl, fixture.deniedDoor.url, token);
    assert.equal(deniedConfig.status, 200, 'denied app configuration must succeed');
    const denied = await postGateway(baseUrl, '/tools/list', token, {});
    assert.equal(denied.status, 403,
      `denied app tools/list must return policy denial, not 401 or 5xx (HTTP ${denied.status})`);
    const deniedText = await denied.text();
    assert.ok(!deniedText.includes(token), 'denied app failure must not disclose the bearer');
  } catch (err) {
    // Assertions contain only statuses/booleans and fixed messages. Network and
    // parser exceptions can include fixture URLs or bodies, so do not echo them.
    if (err instanceof assert.AssertionError) throw err;
    throw new Error('Live gateway verification could not complete; check staging connectivity and response format');
  }
}

module.exports = { runGatewayChecks };
