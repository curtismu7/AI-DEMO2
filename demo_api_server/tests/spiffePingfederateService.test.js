'use strict';

/**
 * Live SPIFFE → PingFederate exchange service.
 *
 * The happy path is exercised against the real stack by the compose profile;
 * these unit tests pin the CONTRACT: the feature flag gates the flow, the
 * config preflight names every missing variable, and the exchange request
 * shape matches what PingFederate's token-exchange processor policy expects
 * (actor_token_type=jwt, the SVID verbatim as actor_token).
 */
const path = require('path');

jest.mock('axios', () => {
  const post = jest.fn();
  return { __esModule: true, default: { post }, post };
});

const SVID_PAYLOAD = { iss: 'https://local.ping-devops.com:8443', sub: 'spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent', aud: ['https://local.ping-devops.com:9031'] };
const SVID = [
  Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(SVID_PAYLOAD)).toString('base64url'),
  'sig',
].join('.');

const CONFIG = {
  ff_spiffe_pf_exchange: 'false',
  spiffe_pf_issuer: 'https://local.ping-devops.com:8443',
  spiffe_pf_token_endpoint: 'https://local.ping-devops.com:9031/as/token.oauth2',
  spiffe_pf_svid_audience: 'https://local.ping-devops.com:9031',
  spiffe_pf_ca_path: '/nonexistent-ca.pem',
  spiffe_pf_exchange_client_id: 'exchanger',
  spiffe_pf_exchange_client_secret: 'exchanger-secret',
  spiffe_pf_subject_client_id: 'subject',
  spiffe_pf_subject_client_secret: 'subject-secret',
};

let spiffePingfederateService;
let axios;
let configStore;

function arm(flag) {
  // Capture the real implementation BEFORE spying (bind to the live function,
  // not the mocked property — that would recurse once another key falls through).
  const realGetEffective = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation(
    (key) => (key in CONFIG ? (flag && key === 'ff_spiffe_pf_exchange' ? 'true' : CONFIG[key]) : realGetEffective(key)),
  );
}

beforeEach(() => {
  // Global setup.js afterEach() does jest.resetModules(); require the service
  // and its axios instance inside each test so the mock factory applies to the
  // same module instance the service binds at load.
  configStore = require('../services/configStore');
  spiffePingfederateService = require('../services/spiffePingfederateService');
  axios = require('axios');
  arm(false);
});

afterEach(() => jest.restoreAllMocks());

describe('spiffePingfederateService', () => {
  it('throws a 503 config error when ff_spiffe_pf_exchange is off', async () => {
    await expect(spiffePingfederateService.exchangeWithPingFederate({}))
      .rejects.toMatchObject({ code: 'SPIFFE_PF_EXCHANGE_DISABLED', httpStatus: 503 });
  });

  it('names every missing variable in the config preflight', async () => {
    arm(true);
    const partial = { ...CONFIG, ff_spiffe_pf_exchange: 'true', spiffe_pf_exchange_client_id: '', spiffe_pf_subject_client_secret: '' };
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => partial[key] ?? '');
    await expect(spiffePingfederateService.exchangeWithPingFederate({}))
      .rejects.toMatchObject({
        code: 'SPIFFE_PF_EXCHANGE_CONFIG_INVALID',
        details: { missing: expect.arrayContaining(['SPIFFE_PF_EXCHANGE_CLIENT_ID', 'SPIFFE_PF_SUBJECT_CLIENT_SECRET']) },
      });
  });

  it('mints an SVID, sends actor_token_type=jwt with the SVID verbatim, and reports the actor SPIFFE ID', async () => {
    arm(true);
    const mintSpy = jest.spyOn(spiffePingfederateService, 'mintJwtSvid').mockResolvedValue(SVID);
    axios.post.mockImplementation(async (url) => {
      if (String(url).endsWith('/as/token.oauth2')) return { data: { access_token: 'pf-token-1' } };
      throw new Error('unexpected url ' + url);
    });
    const postSpy = axios.post;

    const result = await spiffePingfederateService.exchangeWithPingFederate({});

    expect(result.spiffeId).toBe('spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent');
    expect(result.accessToken).toBe('pf-token-1');
    expect(mintSpy).toHaveBeenCalledWith('https://local.ping-devops.com:9031');
    const exchangeCall = postSpy.mock.calls.find(([, body]) => String(body).includes('grant_type=urn'));
    expect(exchangeCall).toBeTruthy();
    const body = exchangeCall[1].toString();
    expect(body).toContain('actor_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Ajwt');
    expect(body).toContain('actor_token=' + encodeURIComponent(SVID));
    // The subject token request authenticated as the subject client, not the exchanger.
    const subjectCall = postSpy.mock.calls.find(([, body]) => String(body).includes('grant_type=client_credentials'));
    expect(subjectCall[2].auth.username).toBe('subject');
  });

  it('normalizes axios failures so client secrets never reach the error message', async () => {
    arm(true);
    axios.post.mockRejectedValue(new Error('boom with exchanger-secret inside'));
    await expect(spiffePingfederateService.exchangeWithPingFederate({})).rejects.toThrow(/boom/);
    const msg = await spiffePingfederateService.exchangeWithPingFederate({})
      .then(() => 'no-error')
      .catch((e) => String((e && e.message) || e));
    expect(msg).not.toContain('exchanger-secret');
  });
});
