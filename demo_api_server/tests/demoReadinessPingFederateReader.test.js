'use strict';

const { createPingFederateReader, baselineMismatches } = require('../services/demoReadinessPingFederateReader');
const { createAuditService } = require('../services/demoReadinessAuditService');

const BASE = 'https://pf.example.test:9999/pf-admin-api/v1';
const ENV = {
  PINGFEDERATE_ADMIN_API_BASE: BASE,
  PINGFEDERATE_ADMIN_PASSWORD: 'admin-password',
  PF_EXCHANGER_CLIENT_ID: 'exchanger',
};
const PROFILES = {
  accessTokenManagers: { gatewayAtm: { issuer: 'https://pf.example.test', audience: 'https://gateway.example.test' } },
  roles: {
    exchanger: { kind: 'oauth-client', objectId: 'PF_EXCHANGER_CLIENT_ID',
      baseline: { present: true, grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'], defaultAccessTokenManagerRef: 'gatewayAtm', tokenExchangeProcessorPolicyRef: 'policy' } },
    'a2a-specialist': { kind: 'service-provider', objectId: 'A2A',
      baseline: { present: true, resourceUris: ['https://a.example.test', 'https://b.example.test'], idJagEnabled: true } },
    'davinci-login': { kind: 'oauth-client', objectId: 'user-client', baseline: { present: true, davinciAdapterConfigured: true } },
    rar: { kind: 'oauth-client', objectId: 'PF_RAR_CLIENT', baseline: { present: true, rarDetailTypes: ['banking_transaction'] } },
    cimd: { kind: 'oauth-client', objectId: 'PF_CIMD_CLIENT', baseline: { present: true, cimdEnabled: true, metadataUrls: ['https://app.example.test/client-metadata.json'], pkceRequired: true } },
  },
};

function live(overrides = {}) {
  return {
    'oauth/clients': [
      { clientId: 'exchanger', grantTypes: ['TOKEN_EXCHANGE', 'CLIENT_CREDENTIALS'], defaultAccessTokenManagerRef: { id: 'gatewayAtm' },
        tokenExchangeProcessorPolicyRef: { id: 'policy' }, clientAuth: { type: 'SECRET', encryptedSecret: 'ENCRYPTED-SECRET' } },
      { clientId: 'user-client', grantTypes: ['AUTHORIZATION_CODE'] },
    ],
    'oauth/accessTokenManagers': [{ id: 'gatewayAtm', configuration: { fields: [
      { name: 'Issuer Claim Value', value: 'https://pf.example.test' }, { name: 'Audience Claim Value', value: 'https://gateway.example.test' },
    ] } }],
    'idp/spConnections': [
      { id: 'aiDemoA2aOneSp', oauthTokenExchangeSettings: { resourceUris: ['https://b.example.test'], idJagEnabled: true } },
      { id: 'aiDemoA2aTwoSp', oauthTokenExchangeSettings: { resourceUris: ['https://a.example.test'], idJagEnabled: true } },
      { id: 'unrelatedSp', oauthTokenExchangeSettings: { resourceUris: ['https://other.example.test'], idJagEnabled: false } },
    ],
    'idp/adapters': [{ id: 'form', pluginDescriptorRef: { id: 'com.pingidentity.adapters.htmlform.idp.HtmlFormIdpAuthnAdapter' } }],
    'oauth/authorizationDetailTypes': [],
    'oauth/cimd/settings': { cimdEnabled: false },
    'oauth/cimd/policies': [],
    ...overrides,
  };
}

function reader(state, { env = ENV, calls = [] } = {}) {
  const get = async (url, options) => {
    calls.push({ url, options });
    const resource = url.slice(BASE.length + 1);
    if (!(resource in state)) return { status: 404, body: {} };
    // Lists come back wrapped in items; the CIMD settings are a single object.
    return { status: 200, body: Array.isArray(state[resource]) ? { items: state[resource] } : state[resource] };
  };
  return createPingFederateReader({ env, get, profiles: PROFILES });
}

describe('demoReadinessPingFederateReader', () => {
  it('reads each role into a comparable, secret-free view', async () => {
    const pf = reader(live());
    const role = (name) => pf.readProfile({ role: name, profile: PROFILES.roles[name] });

    expect(baselineMismatches(PROFILES.roles.exchanger.baseline, await role('exchanger'))).toEqual([]);
    expect(await role('a2a-specialist')).toEqual({ present: true, resourceUris: ['https://a.example.test', 'https://b.example.test'], idJagEnabled: true });
    expect(await role('davinci-login')).toEqual({ present: true, davinciAdapterConfigured: false });
    expect(await role('rar')).toEqual({ present: false, rarDetailTypes: [] });
    expect(JSON.stringify([await role('exchanger'), await pf.readConfiguration()])).not.toMatch(/ENCRYPTED-SECRET|admin-password/);
  });

  it('reports the four families against the baseline', async () => {
    expect(await reader(live()).readConfiguration()).toEqual({
      clientGrantProcessorAtm: { status: 'pass', observed: { mismatched: {} } },
      specialistResourceUriIdJag: { status: 'pass', observed: { mismatched: {} } },
      davinciClientAdapter: { status: 'fail', observed: { mismatched: { 'davinci-login': ['davinciAdapterConfigured'] } } },
      jwksAudience: { status: 'pass', observed: { mismatched: {} } },
    });
  });

  it('fails a family when the live server drifts from the baseline', async () => {
    const state = live();
    state['oauth/clients'][0].tokenExchangeProcessorPolicyRef = { id: 'other-policy' };
    state['oauth/accessTokenManagers'][0].configuration.fields[1].value = 'https://elsewhere.example.test';
    state['idp/spConnections'][1].oauthTokenExchangeSettings.idJagEnabled = false;
    const families = await reader(state).readConfiguration();

    expect(families.clientGrantProcessorAtm).toEqual({ status: 'fail', observed: { mismatched: { exchanger: ['tokenExchangeProcessorPolicyRef'] } } });
    expect(families.jwksAudience).toEqual({ status: 'fail', observed: { mismatched: { gatewayAtm: ['audience'] } } });
    expect(families.specialistResourceUriIdJag).toEqual({ status: 'fail', observed: { mismatched: { 'a2a-specialist': ['idJagEnabled'] } } });
  });

  it('makes one set of GETs for a whole audit, with basic auth and TLS verification on by default', async () => {
    const calls = [];
    const pf = reader(live(), { calls });
    await pf.readConfiguration();
    for (const [role, profile] of Object.entries(PROFILES.roles)) await pf.readProfile({ role, profile });

    expect(calls).toHaveLength(7);
    for (const { options } of calls) {
      expect(options.insecure).toBe(false);
      expect(options.headers.Authorization).toBe('Basic ' + Buffer.from('administrator:admin-password').toString('base64'));
    }
  });

  it('skips TLS verification only when the operator sets PINGFEDERATE_ADMIN_TLS_INSECURE=1', async () => {
    const calls = [];
    await reader(live(), { calls, env: { ...ENV, PINGFEDERATE_ADMIN_TLS_INSECURE: '1' } }).readConfiguration();
    expect(calls.every(({ options }) => options.insecure === true)).toBe(true);
  });

  it('rejects without credentials and on a failed read, then retries on the next call', async () => {
    const { PINGFEDERATE_ADMIN_PASSWORD, ...noPassword } = ENV;
    await expect(reader(live(), { env: noPassword }).readConfiguration()).rejects.toThrow('PingFederate Admin API credentials are unavailable');

    const state = live();
    delete state['idp/adapters'];
    const pf = reader(state);
    await expect(pf.readConfiguration()).rejects.toThrow('PingFederate Admin API read returned HTTP 404');
    state['idp/adapters'] = [];
    await expect(pf.readConfiguration()).resolves.toBeDefined();
  });

  it('drives the audit rows: baseline match passes, drift and absent roles fail, no admin-api row', async () => {
    const audit = createAuditService({ adapters: { pingFederate: reader(live()) }, pfProfiles: PROFILES });
    const rows = Object.fromEntries((await audit.auditPingFederateConfiguration({})).map((row) => [row.id, row]));

    expect(rows['pingfederate:profile:exchanger'].status).toBe('pass');
    expect(rows['pingfederate:profile:a2a-specialist'].status).toBe('pass');
    expect(rows['pingfederate:profile:davinci-login']).toMatchObject({ status: 'fail', observed: { davinciAdapterConfigured: false } });
    expect(rows['pingfederate:profile:rar']).toMatchObject({ status: 'fail', observed: { present: false, rarDetailTypes: [] } });
    expect(rows['pingfederate:davinciClientAdapter'].status).toBe('fail');
    expect(rows).not.toHaveProperty('pingfederate:admin-api');
  });

  describe('CIMD and RAR, which have no pre-registered client', () => {
    const URL = 'https://app.example.test/client-metadata.json';
    const provisioned = () => live({
      'oauth/cimd/settings': { cimdEnabled: true },
      'oauth/cimd/policies': [
        { id: 'demo', enabled: true, metadataUrls: [URL], requireProofKeyForCodeExchange: true },
        { id: 'off', enabled: false, metadataUrls: ['https://*.example.test/*'], requireProofKeyForCodeExchange: false },
      ],
      'oauth/authorizationDetailTypes': [{ id: 'x', type: 'banking_transaction', active: true }, { id: 'y', type: 'retired', active: false }],
    });
    const role = (state, name) => reader(state).readProfile({ role: name, profile: PROFILES.roles[name] });

    it('match the baseline once provisioned, ignoring disabled policies and inactive types', async () => {
      const cimd = await role(provisioned(), 'cimd');
      expect(cimd).toEqual({ present: true, cimdEnabled: true, metadataUrls: [URL], pkceRequired: true });
      expect(baselineMismatches(PROFILES.roles.cimd.baseline, cimd)).toEqual([]);
      expect(await role(provisioned(), 'rar')).toEqual({ present: true, rarDetailTypes: ['banking_transaction'] });
    });

    it('fail CIMD when it is switched off, when a wider URL pattern is enabled, or when PKCE is not required', async () => {
      const mismatches = async (change) => {
        const state = provisioned();
        change(state);
        return baselineMismatches(PROFILES.roles.cimd.baseline, await role(state, 'cimd'));
      };
      expect(await mismatches((state) => { state['oauth/cimd/settings'].cimdEnabled = false; })).toEqual(['present', 'cimdEnabled']);
      expect(await mismatches((state) => { state['oauth/cimd/policies'][1].enabled = true; })).toEqual(['metadataUrls', 'pkceRequired']);
      expect(await mismatches((state) => { state['oauth/cimd/policies'][0].requireProofKeyForCodeExchange = false; })).toEqual(['pkceRequired']);
    });
  });
});
