'use strict';

// The façade forwards the request BODY untouched but only an allowlist of
// headers. MCP 2026-07-28 requires Mcp-Method (and Mcp-Name on tools/call) to
// mirror the body whenever the body carries Modern `_meta` — so dropping those
// headers builds a request that declares Modern and then violates its own
// contract. The gateway answers -32020 "Missing required header: Mcp-Method",
// and both ends look correct in isolation: the relay DID send it, the gateway
// DID require it, and the door in between silently removed it.
//
// Live symptom before this fix: every tools/list through the audit door failed
// with -32020 despite a valid audit:read token.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/mcpFacade');

function buildApp() {
  const app = express();
  app.use('/mcp-facade', router);
  return app;
}

describe('mcp-facade — Modern per-request headers survive the hop', () => {
  let seen;

  beforeEach(() => {
    seen = null;
    global.fetch = jest.fn(async (_url, opts = {}) => {
      seen = opts.headers || {};
      return {
        ok: true,
        status: 200,
        headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
      };
    });
  });
  afterEach(() => { delete global.fetch; });

  function post(headers) {
    return request(buildApp())
      .post('/mcp-facade/agent-gateway/mcp')
      .set('Authorization', 'Bearer t')
      .set(headers)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } });
  }

  const lower = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]));

  it('forwards Mcp-Method upstream', async () => {
    await post({ 'Mcp-Method': 'tools/list' });
    expect(lower(seen)['mcp-method']).toBe('tools/list');
  });

  it('forwards Mcp-Name for tools/call', async () => {
    await post({ 'Mcp-Method': 'tools/call', 'Mcp-Name': 'search_audit_activities' });
    expect(lower(seen)['mcp-name']).toBe('search_audit_activities');
  });

  it('forwards the open-ended Mcp-Param-* family', async () => {
    // One per x-mcp-header tool argument, so it cannot be an allowlist entry.
    await post({ 'Mcp-Method': 'tools/call', 'Mcp-Param-Owner': 'acme' });
    expect(lower(seen)['mcp-param-owner']).toBe('acme');
  });

  it('still forwards the original three', async () => {
    await post({ 'Mcp-Protocol-Version': '2026-07-28', 'Mcp-Session-Id': 'sess-1' });
    const h = lower(seen);
    expect(h['mcp-protocol-version']).toBe('2026-07-28');
    expect(h['mcp-session-id']).toBe('sess-1');
    expect(h.authorization).toBe('Bearer t');
  });

  it('does not invent headers the caller never sent', async () => {
    await post({});
    const h = lower(seen);
    expect(h['mcp-method']).toBeUndefined();
    expect(h['mcp-name']).toBeUndefined();
  });
});
