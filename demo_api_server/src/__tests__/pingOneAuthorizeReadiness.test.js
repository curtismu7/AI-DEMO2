/**
 * checkPolicyReadiness (P1AZ hardening amendment §E) — admin drift check.
 *
 * Verifies each configured gate's decision endpoint EXISTS in PingOne Authorize
 * by listing endpoints (no synthetic decisions). Classifies ready /
 * policy_not_found / not_configured / skipped / error. Never throws.
 */
jest.mock('../../services/configStore');
const configStore = require('../../services/configStore');
const svc = require('../../services/pingOneAuthorizeService');

let creds;
function setConfig(overrides = {}) {
  creds = {
    pingone_environment_id: 'env-1', pingone_region: 'com',
    authorize_worker_client_id: 'client-A', authorize_worker_client_secret: 'secret-A',
    authorize_decision_endpoint_id: 'tx-id',
    authorize_mcp_decision_endpoint_id: 'mcp-id',
    ...overrides,
  };
}

function routedFetch(endpointIds) {
  return jest.fn(async (url) => {
    if (String(url).endsWith('/as/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    }
    if (String(url).endsWith('/decisionEndpoints')) {
      return { ok: true, status: 200, text: async () => '',
        json: async () => ({ _embedded: { decisionEndpoints: endpointIds.map((id) => ({ id })) } }) };
    }
    return { ok: false, status: 500, text: async () => 'unexpected', json: async () => ({}) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setConfig();
  configStore.get = jest.fn(() => null);
  configStore.getEffective = jest.fn((k) => creds[k] ?? null);
  svc._resetAuthorizeRuntimeState();
});

test('ready when every configured endpoint id exists in PingOne', async () => {
  global.fetch = routedFetch(['tx-id', 'mcp-id', 'other']);
  const r = await svc.checkPolicyReadiness();
  expect(r.readiness).toBe('ready');
  expect(r.gates).toEqual(expect.arrayContaining([
    expect.objectContaining({ gate: expect.any(String), status: 'ready' }),
  ]));
});

test('policy_not_found when a configured endpoint id is missing from PingOne', async () => {
  global.fetch = routedFetch(['tx-id']); // mcp-id absent → drift
  const r = await svc.checkPolicyReadiness();
  expect(r.readiness).toBe('policy_not_found');
  const mcp = r.gates.find((g) => g.id === 'mcp-id');
  expect(mcp.status).toBe('policy_not_found');
});

test('not_configured when no endpoint ids are set', async () => {
  setConfig({ authorize_decision_endpoint_id: null, authorize_mcp_decision_endpoint_id: null });
  global.fetch = routedFetch(['whatever']);
  const r = await svc.checkPolicyReadiness();
  expect(r.readiness).toBe('not_configured');
});

test('skipped when worker credentials are missing (never throws)', async () => {
  setConfig({ authorize_worker_client_id: null, authorize_worker_client_secret: null });
  const r = await svc.checkPolicyReadiness();
  expect(r.readiness).toBe('skipped');
  expect(r.reason).toBe('worker_creds_missing');
});

test('error (not a throw) when listing endpoints fails', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).endsWith('/as/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    }
    return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
  });
  const r = await svc.checkPolicyReadiness();
  expect(r.readiness).toBe('error');
  expect(r.error).toBeDefined();
});
