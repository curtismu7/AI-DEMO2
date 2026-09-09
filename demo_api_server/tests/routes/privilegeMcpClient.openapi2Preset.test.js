'use strict';

// `openapi2` is the OpenAPI MCP Agentic App that has never discovered a tool.
// Everything recorded about that failure so far is INFERENCE — from the image
// differential (Privilege's `mcp/openapi` ships without Ping's `mcp-shim`,
// unlike every catalog image that works) and from an empty console tool list.
// Nobody has ever authenticated through the door and asked it for its tools,
// which is the only direct measurement, and the one Ping will actually want.
//
// The door probe on the Privilege MCP Client page does exactly that
// (POST /doors/probe -> initialize + tools/list -> a count or the error text),
// but it can only probe a URL the page offers. `openapi2` reaches the picker
// through console discovery only, so on any deployment where nobody has
// connected the console it is not selectable at all. This preset pins it, the
// same way the PingOne-admin door is pinned rather than left to discovery.
//
// Delete this preset once the question is settled — either Ping fixes the image
// or the door proves it serves tools.

const express = require('express');
const request = require('supertest');

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-openapi2-preset-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

const OPENAPI2_PRESET = /openapi2/i;

describe('privilege-mcp /state — openapi2 probe preset', () => {
  const savedGateway = process.env.PRIVILEGE_MCPGW_URL;

  afterEach(() => {
    if (savedGateway === undefined) delete process.env.PRIVILEGE_MCPGW_URL;
    else process.env.PRIVILEGE_MCPGW_URL = savedGateway;
  });

  it('offers an openapi2 door so the probe can measure it', async () => {
    const res = await request(buildApp()).get('/api/privilege-mcp/state');
    expect(res.status).toBe(200);
    const preset = (res.body.presets || []).find((p) => OPENAPI2_PRESET.test(p.label || ''));
    expect(preset).toBeDefined();
    // Straight at the AI Gateway, like every other Privilege app door. Not the
    // façade: the façade adds its own hop and would blur which side failed.
    expect(preset.mode).toBe('privilege');
    expect(preset.url).toMatch(/\/openapi2\/mcp$/);
  });

  it('follows the gateway origin instead of hardcoding a host', async () => {
    // The 2026-09-01 lesson: a door pinned to a literal host goes dark the day
    // the gateway moves, and reads as an application bug rather than a stale URL.
    process.env.PRIVILEGE_MCPGW_URL = 'https://gw.example.test/some-app/mcp';
    const res = await request(buildApp()).get('/api/privilege-mcp/state');
    const preset = (res.body.presets || []).find((p) => OPENAPI2_PRESET.test(p.label || ''));
    expect(preset.url).toBe('https://gw.example.test/openapi2/mcp');
  });
});
