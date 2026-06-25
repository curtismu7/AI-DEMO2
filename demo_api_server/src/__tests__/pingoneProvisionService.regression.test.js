/**
 * @file pingoneProvisionService.regression.test.js
 *
 * Pragmatic-minimum regression tests for the PingOne provisioner. Locks in
 * three specific failure modes we hit during the 2026-05-13 chip-test debug
 * session, any of which is silent-failure-prone if the code drifts:
 *
 *   T1. createApplication's existing-app branch PATCHes grantTypes drift —
 *       not just redirectUris and tokenEndpointAuthMethod. (Root cause of
 *       today's blocker: Admin app was missing TOKEN_EXCHANGE on rerun.)
 *
 *   T2. Two-Exchange may_act wiring uses defined client IDs — i.e. it runs
 *       AFTER the AI Agent + MCP Exchanger apps have been provisioned, not
 *       before. (Today's b9ffa48d → 6607559e ordering bug.)
 *
 *   T3. Custom-named scopes (not literal 'openid') get POSTed to the new
 *       Two-Exchange resource servers. (Today's a4539a76 fix.)
 *
 * Tests mock `makeRequest` so no live PingOne is needed. We exercise the
 * class directly, not the singleton, so each test gets a clean instance.
 */

'use strict';

const { PingOneProvisionService } = require('../../services/pingoneProvisionService');

/** Stub a service with `makeRequest` replaced by a recording mock. */
function buildSvc({ workerToken = 'fake-worker-token' } = {}) {
  const svc = new PingOneProvisionService();
  svc.config = {
    environmentId: 'test-env',
    region: 'com',
    workerClientId: 'worker-client',
    workerClientSecret: 'worker-secret',
  };
  svc.workerToken = workerToken;
  svc.getWorkerToken = jest.fn().mockResolvedValue(workerToken);
  return svc;
}

describe('PingOneProvisionService — regression suite', () => {
  let svc;

  beforeEach(() => {
    svc = buildSvc();
  });

  // ──────────────────────────────────────────────────────────────────────
  // T1: existing-app reconcile PATCHes grantTypes drift
  //
  // This is the root cause of the entire 2026-05-13 chip-test session. The
  // Admin app needs TOKEN_EXCHANGE on its grantTypes for the BFF's
  // performTokenExchange to work. Fresh installs add it (line ~452 default
  // CLIENT_SECRET_BASIC + the per-app updateApplication block sets it).
  // Reruns SHOULD reconcile drift but didn't until commit 6416f081.
  // ──────────────────────────────────────────────────────────────────────
  describe('createApplication: existing-app reconcile', () => {
    it('PATCHes grantTypes when existing app is missing a required grant', async () => {
      const existing = {
        id: 'existing-app-123',
        name: 'Super Banking Admin App',
        type: 'WEB_APP',
        enabled: true,
        // The exact drift case from today: app exists but has only AUTHORIZATION_CODE.
        grantTypes: ['AUTHORIZATION_CODE'],
        tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC',
        redirectUris: ['https://api.ping.demo:4000/api/auth/oauth/callback'],
      };
      // findResourceByName → returns the existing app.
      svc.findResourceByName = jest.fn().mockResolvedValue(existing);
      // makeRequest returns the refreshed application on GET after PATCH.
      svc.makeRequest = jest.fn((method, path, body) => {
        if (method === 'PUT' || method === 'PATCH') return Promise.resolve({ data: { ...existing, ...body } });
        if (method === 'GET') return Promise.resolve({ data: { ...existing, grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN', 'TOKEN_EXCHANGE'] } });
        return Promise.resolve({ data: existing });
      });

      const result = await svc.createApplication(
        'Super Banking Admin App',
        'desc',
        'WEB_APP',
        ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
      );

      expect(result.exists).toBe(true);
      expect(result.patched).toBe(true);
      expect(result.driftedFields).toEqual(expect.arrayContaining(['grantTypes']));

      // Find the PUT/PATCH call that updated grantTypes.
      const updateCall = svc.makeRequest.mock.calls.find(([method, , body]) =>
        (method === 'PUT' || method === 'PATCH') && body && body.grantTypes,
      );
      expect(updateCall).toBeDefined();
      const patched = updateCall[2];
      // grantTypes must be uppercase normalized and include TOKEN_EXCHANGE.
      expect(patched.grantTypes).toEqual(expect.arrayContaining([
        'AUTHORIZATION_CODE',
        'REFRESH_TOKEN',
        'TOKEN_EXCHANGE',
      ]));
    });

    it('does NOT PATCH when existing grantTypes already match', async () => {
      const existing = {
        id: 'existing-app-456',
        name: 'Super Banking Admin App',
        type: 'WEB_APP',
        enabled: true,
        grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN', 'TOKEN_EXCHANGE'],
        // Must match desiredAuthMethod ('CLIENT_SECRET_POST' for non-worker apps)
        tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
      };
      svc.findResourceByName = jest.fn().mockResolvedValue(existing);
      svc.makeRequest = jest.fn().mockResolvedValue({ data: existing });

      const result = await svc.createApplication(
        'Super Banking Admin App',
        'desc',
        'WEB_APP',
        ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
      );

      // Should return exists:true with patched:false.
      expect(result.exists).toBe(true);
      expect(result.patched).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // T2: createScopes accepts custom-named scopes on new resource servers
  //
  // The original Phase A code (commit 99996769) tried to POST a scope
  // literally named 'openid' to a CUSTOM resource — PingOne rejects that
  // because 'openid' is system-reserved. Commit a4539a76 switched to custom
  // names. This test ensures the createScopes path accepts and forwards
  // custom names without trying to POST 'openid' itself.
  // ──────────────────────────────────────────────────────────────────────
  describe('createScopes: custom scope names on resource servers', () => {
    it('POSTs custom-named scopes (not openid) to a resource server', async () => {
      svc.makeRequest = jest.fn((method, path, body) => {
        // GET /resources/{id}/scopes returns no existing scopes.
        if (method === 'GET' && path.includes('/scopes')) {
          return Promise.resolve({ data: { _embedded: { scopes: [] } } });
        }
        // POST /resources/{id}/scopes accepts and returns the created scope.
        if (method === 'POST' && path.includes('/scopes')) {
          return Promise.resolve({ data: { id: 'scope-' + body.name, name: body.name } });
        }
        return Promise.resolve({ data: {} });
      });

      const results = await svc.createScopes('resource-id-123', [
        { name: 'banking:two-exchange:final', description: 'Step 4 marker' },
        { name: 'read', description: 'Read' },
      ]);

      // Each scope POST should have happened with the exact custom name.
      const postedNames = svc.makeRequest.mock.calls
        .filter(([method, path]) => method === 'POST' && path.includes('/scopes'))
        .map(([, , body]) => body.name);
      expect(postedNames).toEqual(expect.arrayContaining([
        'banking:two-exchange:final',
        'read',
      ]));
      // No 'openid' should ever be POSTed (it's reserved on CUSTOM resources).
      expect(postedNames).not.toContain('openid');
      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // T1c: source — AI Agent and MCP Exchanger apps are NOT created as WORKER.
  //
  // The 2026-05-13 token-flow audit + live PingOne spike test confirmed that
  // WORKER-type apps silently bind their CC tokens to aud=https://api.pingone.com
  // (the Mgmt API resource), regardless of the requested `audience` parameter.
  // When that worker-aud token is used as actor_token in an RFC 8693 exchange,
  // PingOne refuses ("Token exchange can only be used to issue tokens for
  // custom resources" — applied to the actor's aud, not the target).
  //
  // Fix shipped: AI Agent + MCP Exchanger created as WEB_APP. This test pins
  // that choice at the source-text level so a future refactor doesn't quietly
  // revert it.
  // ──────────────────────────────────────────────────────────────────────
  describe('source: AI Agent and MCP Exchanger app types', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../services/pingoneProvisionService.js'),
      'utf8',
    );
    const lines = src.split('\n');

    // Walk lines; when we see the app name literal, look at the next 5 lines
    // for the createApplication 3rd positional arg (the app type).
    function appTypeFor(appName) {
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes(`'${appName}'`)) continue;
        // Confirm this is the createApplication call (look back up to 3 lines).
        const prior = lines.slice(Math.max(0, i - 3), i).join('\n');
        if (!/createApplication\(/.test(prior)) continue;
        // The type arg is the next quoted UPPERCASE_WITH_UNDERSCORE string.
        for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
          const m = lines[j].match(/['"`]([A-Z][A-Z_]+)['"`]/);
          if (m) return m[1];
        }
      }
      return null;
    }

    it('Super Banking AI Agent is NOT created as WORKER', () => {
      const type = appTypeFor('Super Banking AI Agent');
      expect(type).not.toBeNull();
      expect(type).not.toBe('WORKER');
      expect(type).toBe('WEB_APP');
    });

    it('Super Banking MCP Exchanger is NOT created as WORKER', () => {
      const type = appTypeFor('Super Banking MCP Exchanger');
      expect(type).not.toBeNull();
      expect(type).not.toBe('WORKER');
      expect(type).toBe('WEB_APP');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // T2b: source-level ordering — Two-Exchange may_act block runs AFTER
  // the AI Agent app create.
  //
  // The bug shipped in commit b9ffa48d: the may_act wiring block was placed
  // BEFORE the AI Agent app create step in provisionEnvironment(). When the
  // wiring code read `provisioned.aiAgentApp?.clientId`, the optional chain
  // returned undefined and the call silently no-op'd. Fixed in 6607559e by
  // moving the block down. This test pins that relative ordering at the
  // source-text level — if anyone moves the may_act block back above the
  // AI Agent app create, this fails.
  // ──────────────────────────────────────────────────────────────────────
  describe('source: Two-Exchange may_act wiring placement', () => {
    it('the may_act wiring block appears AFTER the MCP Exchanger app create', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../services/pingoneProvisionService.js'),
        'utf8',
      );
      // may_act wiring uses provisioned.mcpExchangerApp?.clientId, so it must
      // come AFTER the MCP Exchanger app is created (not after AI Agent).
      const mcpExchangerCreateIdx = src.indexOf("'Super Banking MCP Exchanger'");
      // Search for the actual wiring step string in production
      const mayActWiringIdx = src.indexOf('Wiring may_act token claim');
      expect(mcpExchangerCreateIdx).toBeGreaterThan(-1);
      expect(mayActWiringIdx).toBeGreaterThan(-1);
      // The wiring step must appear LATER in the file (so it runs LATER at runtime).
      expect(mayActWiringIdx).toBeGreaterThan(mcpExchangerCreateIdx);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // T3: _setResourceAttribute uses the client_id that was passed to it
  //
  // The ordering bug we hit today (b9ffa48d → 6607559e): the may_act block
  // was placed BEFORE the AI Agent app create step, so when the wiring code
  // read `provisioned.aiAgentApp?.clientId`, it was undefined and the call
  // silently no-op'd. This test isolates _setResourceAttribute and confirms
  // it makes the expected PUT only when the value is truthy — which the
  // caller's `if (clientId && resourceId)` guard then leverages.
  // ──────────────────────────────────────────────────────────────────────
  describe('_setResourceAttribute: may_act wiring contract', () => {
    it('makes a PUT/POST that carries the may_act sub value', async () => {
      const calls = [];
      svc.makeRequest = jest.fn((method, path, body) => {
        calls.push({ method, path, body });
        // attributes list endpoint
        if (method === 'GET' && path.includes('/attributes')) {
          return Promise.resolve({ data: { _embedded: { attributes: [] } } });
        }
        return Promise.resolve({ data: { id: 'attr-1' } });
      });

      const targetClientId = '66cd8e4c-35d8-4758-ab2d-2a7561842051';
      await svc._setResourceAttribute(
        'resource-id-final',
        'may_act',
        JSON.stringify({ sub: targetClientId }),
      );

      // Should have made at least one mutating call (POST or PUT) that
      // includes the target client_id in the body's value/name.
      const mutating = calls.filter(c => c.method === 'POST' || c.method === 'PUT');
      expect(mutating.length).toBeGreaterThan(0);
      const carriesValue = mutating.some(c => {
        const flat = JSON.stringify(c.body || '');
        return flat.includes(targetClientId);
      });
      expect(carriesValue).toBe(true);
    });
  });
});
