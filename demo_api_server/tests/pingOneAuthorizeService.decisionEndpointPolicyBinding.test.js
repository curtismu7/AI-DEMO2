'use strict';

/**
 * Decision endpoints must be created with `policy: { id }`, not `policyId`.
 *
 * `_createDecisionEndpointResource` sent `policyId` for its whole life. PingOne
 * answers 201 and silently drops the field, so every endpoint provisioned by
 * `provisionDemoDecisionEndpoints` came out with NO policy binding and fell
 * through to the environment's root policy tree. Nothing failed, nothing logged,
 * and a GET on the endpoint showed no `policy` key at all — the only way to see
 * it was to read the endpoint back and notice the absence.
 *
 * Measured live 2026-09-09 against the AI Demo environment:
 *   POST { policyId }      -> 201, GET shows no `policy` key
 *   POST { policy:{ id } } -> 201, GET shows policy:{ id: ... }
 *   PUT  { policy:{ id } } -> 400 INVALID_DATA "Cannot update policy id"
 *   PUT  { policyId }      -> 200, and still ignored
 *
 * The binding is create-only, so a wrong one cannot be patched later — which is
 * what makes the silent drop expensive rather than merely untidy.
 */

process.env.PINGONE_ENVIRONMENT_ID = process.env.PINGONE_ENVIRONMENT_ID || 'env-under-test';
process.env.PINGONE_WORKER_CLIENT_ID = process.env.PINGONE_WORKER_CLIENT_ID || 'worker-client';
process.env.PINGONE_WORKER_CLIENT_SECRET = process.env.PINGONE_WORKER_CLIENT_SECRET || 'worker-secret';

const svc = require('../services/pingOneAuthorizeService');

/** Capture every decisionEndpoints POST body the service sends. */
function mockPingOne() {
  const posts = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();

    if (u.includes('/as/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
        text: async () => '{}',
      };
    }

    if (u.includes('/decisionEndpoints') && method === 'GET') {
      // No endpoints exist yet, so provisioning takes the create branch.
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { decisionEndpoints: [] } }),
        text: async () => '{}',
      };
    }

    if (u.includes('/decisionEndpoints') && method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push(body);
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: `ep-${posts.length}`, name: body.name }),
        text: async () => '{}',
      };
    }

    throw new Error(`unexpected request in test: ${method} ${u}`);
  });
  return posts;
}

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('provisionDemoDecisionEndpoints — policy binding', () => {
  it('sends policy:{id} on create, never the ignored policyId field', async () => {
    const posts = mockPingOne();

    await svc.provisionDemoDecisionEndpoints({ policyId: 'policy-under-test' });

    expect(posts.length).toBe(2); // transaction + mcp
    for (const body of posts) {
      expect(body.policy).toEqual({ id: 'policy-under-test' });
      // The whole bug: this key is accepted and discarded by PingOne.
      expect(body).not.toHaveProperty('policyId');
    }
  });

  it('omits the binding entirely when no policyId is supplied', async () => {
    const posts = mockPingOne();

    await svc.provisionDemoDecisionEndpoints({});

    expect(posts.length).toBe(2);
    for (const body of posts) {
      expect(body).not.toHaveProperty('policy');
      expect(body).not.toHaveProperty('policyId');
    }
  });

  it('still sends the endpoint name and recordRecentRequests', async () => {
    const posts = mockPingOne();

    await svc.provisionDemoDecisionEndpoints({ policyId: 'policy-under-test' });

    for (const body of posts) {
      expect(typeof body.name).toBe('string');
      expect(body.name.length).toBeGreaterThan(0);
      expect(body.recordRecentRequests).toBe(true);
    }
  });
});
