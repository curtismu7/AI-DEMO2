'use strict';

/**
 * SPIFFE → Privilege gateway (federated workload identity) service tests.
 *
 * Offline: outbound network is blocked by the unit-test guard, so axios is
 * mocked. These tests pin the CONTRACT, mirroring spiffePingfederateService.test.js:
 *  - the flag gates the flow (503 config error when off)
 *  - unknown token modes are refused
 *  - raw-svid mints an SVID via the SPIRE agent path with the gateway as audience
 *  - pf-exchanged delegates to the PF exchange service
 *  - pf-client-credentials mints a PF token then presents it
 *  - the gateway's non-2xx (401/403) is RETURNED as data, not thrown — the
 *    refusal is the demo result
 *  - no client secret survives into any error reaching the caller
 */
jest.mock('axios', () => {
  const post = jest.fn();
  return { __esModule: true, default: { post }, post };
});

const CONFIG = {
  ff_spiffe_privilege: 'false',
  spiffe_privilege_gateway_url: 'https://mcpgw.example.test',
  spiffe_pf_issuer: 'https://pf.example.test',
  spiffe_pf_token_endpoint: 'https://pf.example.test/as/token.oauth2',
  spiffe_pf_ca_path: '/nonexistent-ca.pem',
  spiffe_pf_subject_client_id: 'subject',
  spiffe_pf_subject_client_secret: 'subject-secret',
};

let spiffePrivilegeService;
let spiffePingfederateService;
let axios;
let configStore;

function arm(flag) {
  const realGetEffective = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation(
    (key) => (key in CONFIG ? (flag && key === 'ff_spiffe_privilege' ? 'true' : CONFIG[key]) : realGetEffective(key)),
  );
}

beforeEach(() => {
  // Global setup.js afterEach() does jest.resetModules(); require per test so
  // the axios mock factory binds to the same instance the service loads.
  configStore = require('../services/configStore');
  spiffePrivilegeService = require('../services/spiffePrivilegeService');
  spiffePingfederateService = require('../services/spiffePingfederateService');
  axios = require('axios');
  arm(false);
});

afterEach(() => jest.restoreAllMocks());

describe('spiffePrivilegeService.callPrivilegeWithWorkloadIdentity', () => {
  it('refuses with a 503 config error when ff_spiffe_privilege is off', async () => {
    await expect(spiffePrivilegeService.callPrivilegeWithWorkloadIdentity({ tokenMode: 'raw-svid' }))
      .rejects.toMatchObject({ code: 'SPIFFE_PRIVILEGE_DISABLED', httpStatus: 503 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('refuses an unknown token mode with 400', async () => {
    arm(true);
    await expect(spiffePrivilegeService.callPrivilegeWithWorkloadIdentity({ tokenMode: 'mystery' }))
      .rejects.toMatchObject({ code: 'SPIFFE_PRIVILEGE_BAD_MODE', httpStatus: 400 });
  });

  it('raw-svid mints an SVID with the gateway as audience and presents it as Bearer', async () => {
    arm(true);
    const svidPayload = { sub: 'spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent' };
    const svid = `${Buffer.from('{"alg":"RS256","kid":"k1"}').toString('base64url')}.${Buffer.from(JSON.stringify(svidPayload)).toString('base64url')}.sig`;
    const mint = jest.spyOn(spiffePingfederateService, 'mintJwtSvid').mockResolvedValue(svid);
    axios.post.mockResolvedValueOnce({ status: 200, data: { jsonrpc: '2.0', id: 1, result: { tools: [] } } });

    const out = await spiffePrivilegeService.callPrivilegeWithWorkloadIdentity({ tokenMode: 'raw-svid' });

    expect(mint).toHaveBeenCalledWith('https://mcpgw.example.test');
    expect(out.tokenMode).toBe('raw-svid');
    expect(out.claims).toEqual(svidPayload);
    expect(out.gatewayStatus).toBe(200);
    const [url, , config] = axios.post.mock.calls[0];
    expect(url).toBe('https://mcpgw.example.test/mcp');
    expect(config.headers.Authorization).toBe(`Bearer ${svid}`);
  });

  it('pf-exchanged delegates to the PF exchange and forwards its token', async () => {
    arm(true);
    jest.spyOn(spiffePingfederateService, 'exchangeWithPingFederate').mockResolvedValue({
      accessToken: 'pf-token', spiffeId: 'spiffe://bxfinance.demo/x', actorSpiffeId: 'spiffe://bxfinance.demo/x', issuer: 'https://pf.example.test',
    });
    axios.post.mockResolvedValueOnce({ status: 403, data: { error: 'Access Denied for pf-token' } });

    const out = await spiffePrivilegeService.callPrivilegeWithWorkloadIdentity({ tokenMode: 'pf-exchanged' });

    expect(out.token).toBe('pf-token');
    // A 403 from the gateway is the demo result, not an exception.
    expect(out.gatewayStatus).toBe(403);
    expect(out.gatewayBody.error).toMatch(/Access Denied/);
  });

  it('pf-client-credentials mints a PF token then presents it', async () => {
    arm(true);
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { access_token: 'cc-token' } })
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const out = await spiffePrivilegeService.callPrivilegeWithWorkloadIdentity({ tokenMode: 'pf-client-credentials' });

    expect(out.token).toBe('cc-token');
    expect(out.gatewayStatus).toBe(200);
    const [tokenUrl, body] = axios.post.mock.calls[0];
    expect(tokenUrl).toBe('https://pf.example.test/as/token.oauth2');
    expect(String(body)).toContain('grant_type=client_credentials');
  });

  it('pf-client-credentials without a configured PF client is a 503 config error', async () => {
    arm(true);
    const partial = { ...CONFIG, ff_spiffe_privilege: 'true', spiffe_pf_subject_client_id: '', spiffe_pf_subject_client_secret: '' };
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => partial[key] ?? '');
    await expect(spiffePrivilegeService.callPrivilegeWithWorkloadIdentity({ tokenMode: 'pf-client-credentials' }))
      .rejects.toMatchObject({ code: 'SPIFFE_PRIVILEGE_CONFIG_INVALID', httpStatus: 503 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('a PF client secret never appears in an error reaching the caller', async () => {
    arm(true);
    axios.post.mockImplementationOnce(() => {
      const e = new Error('Request failed with status 401 subject-secret');
      e.isAxiosError = true;
      e.response = { status: 401, headers: {}, config: { headers: {} } };
      throw e;
    });
    await expect(spiffePrivilegeService.callPrivilegeWithWorkloadIdentity({ tokenMode: 'pf-client-credentials' }))
      .rejects.toMatchObject({ message: expect.not.stringContaining('subject-secret') });
  });

  it('exposes the three token modes', () => {
    expect(spiffePrivilegeService.TOKEN_MODES).toEqual(['raw-svid', 'pf-exchanged', 'pf-client-credentials']);
  });
});
