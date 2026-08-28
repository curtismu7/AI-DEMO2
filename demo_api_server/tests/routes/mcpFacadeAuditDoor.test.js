'use strict';

// The audit door narrows by SCOPE, not by filtering. Its `scopes` field is the
// single thing that makes an MCP client ask for a narrow token: the façade
// advertises it in oauth-protected-resource metadata and in the 401 challenge,
// the client requests exactly that, and the gateway then filters tools/list to
// what the token permits.
//
// Widen this door's scopes and nothing here breaks visibly — the client just
// silently gets the full banking surface through a URL labelled "audit". These
// tests are the alarm for that.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/mcpFacade');

const { DOORS } = router.__test;

function buildApp() {
  const app = express();
  app.use('/mcp-facade', router);
  return app;
}

describe('mcp-facade audit door', () => {
  it('advertises exactly audit:read — nothing wider', () => {
    expect(DOORS.audit).toBeDefined();
    expect(DOORS.audit.scopes).toEqual(['audit:read']);
  });

  it('serves audit:read as scopes_supported in resource metadata', async () => {
    // This is what an MCP client reads to decide which scope to request, so it
    // has to be the narrow one even though the upstream is the shared gateway.
    const res = await request(buildApp())
      .get('/mcp-facade/audit/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.scopes_supported).toEqual(['audit:read']);
  });

  it('points at the shared gateway, not an audit-only backend', () => {
    // The gateway is deliberately NOT audit-only. If this ever pointed straight
    // at demo_mcp_audit, the door would look correct while proving nothing about
    // gateway enforcement — the tools would be narrow because the backend was.
    expect(DOORS.audit.upstream()).toBe(DOORS['agent-gateway'].upstream());
  });

  it('is strictly narrower than the agent-gateway door it shares an upstream with', () => {
    // Same code path, same backend, different advertised scope. That difference
    // is the entire mechanism.
    const wide = DOORS['agent-gateway'].scopes;
    expect(wide.length).toBeGreaterThan(DOORS.audit.scopes.length);
    for (const s of DOORS.audit.scopes) {
      expect(wide).not.toContain(s);
    }
  });

  it('does not carry a tool allowlist of its own', () => {
    // Guard against a future "helpful" filter here: narrowing must stay a
    // property of the token, or a scope regression stops being observable.
    expect(DOORS.audit.allowedTools).toBeUndefined();
    expect(DOORS.audit.toolAllowlist).toBeUndefined();
  });
});
