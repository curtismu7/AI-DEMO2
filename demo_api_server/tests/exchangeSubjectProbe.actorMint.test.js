'use strict';

/**
 * The startup exchange probe mints the AI Agent actor token with a PingOne app. Pointed at
 * PingFederate's token endpoint that fails with a PF "Invalid client or client credentials",
 * which reads like a stale secret and is not one. The mint is skipped there; everywhere else
 * it behaves exactly as before.
 */

// Default = flag OFF (no managed clients); the probe requires the relay lazily at call time.
const mockRelay = { manages: jest.fn(async () => false) };
jest.mock('../services/sidecarClientRelay', () => mockRelay);

const { mintAgentActorToken } = require('../services/exchangeSubjectProbe');

const PF = 'https://pingfederate:9031/as/token.oauth2';
const P1 = 'https://auth.pingone.com/env-1/as/token';

function deps({ endpoint, creds = true, mint } = {}) {
  const values = creds
    ? { pingone_ai_agent_actor_client_id: 'actor-client', pingone_ai_agent_actor_client_secret: 'actor-secret' }
    : {};
  return {
    configStore: { getEffective: (k) => values[k] },
    oauthService: {
      config: { tokenEndpoint: endpoint },
      getClientCredentialsTokenAs: mint || jest.fn().mockResolvedValue('actor-token'),
    },
  };
}

let warn;
let log;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('PingFederate token endpoint: no mint is attempted and no false "invalid client" warning', async () => {
  const d = deps({ endpoint: PF });
  await expect(mintAgentActorToken(d.configStore, d.oauthService)).resolves.toBeNull();
  expect(d.oauthService.getClientCredentialsTokenAs).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('skipped actor mint'));
});

test('PingOne token endpoint: mints exactly as before', async () => {
  const d = deps({ endpoint: P1 });
  await expect(mintAgentActorToken(d.configStore, d.oauthService)).resolves.toBe('actor-token');
  expect(d.oauthService.getClientCredentialsTokenAs).toHaveBeenCalledWith(
    'actor-client', 'actor-secret', 'agentgateway.ping.demo', 'post', 'agent:invoke',
  );
});

test('PingOne endpoint with a real mint failure still warns and returns null', async () => {
  const d = deps({ endpoint: P1, mint: jest.fn().mockRejectedValue(new Error('Client credentials failed: nope')) });
  await expect(mintAgentActorToken(d.configStore, d.oauthService)).resolves.toBeNull();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not mint actor CC token'), 'Client credentials failed: nope');
});

test('no actor credentials configured: null, nothing attempted', async () => {
  const d = deps({ endpoint: P1, creds: false });
  await expect(mintAgentActorToken(d.configStore, d.oauthService)).resolves.toBeNull();
  expect(d.oauthService.getClientCredentialsTokenAs).not.toHaveBeenCalled();
});

test('a sidecar-managed actor client with no local secret is still minted (the sidecar holds the secret)', async () => {
  mockRelay.manages.mockResolvedValueOnce(true);
  const d = deps({ endpoint: P1, creds: false });
  d.configStore.getEffective = (k) => (k === 'pingone_ai_agent_actor_client_id' ? 'actor-client' : undefined);

  await expect(mintAgentActorToken(d.configStore, d.oauthService)).resolves.toBe('actor-token');

  expect(d.oauthService.getClientCredentialsTokenAs).toHaveBeenCalledWith(
    'actor-client', undefined, 'agentgateway.ping.demo', 'post', 'agent:invoke',
  );
});

test('a missing config object does not crash the probe (treated as not PingFederate)', async () => {
  const d = deps({ endpoint: undefined });
  delete d.oauthService.config;
  await expect(mintAgentActorToken(d.configStore, d.oauthService)).resolves.toBe('actor-token');
});
