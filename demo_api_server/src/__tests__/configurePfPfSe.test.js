'use strict';
// Pure helpers of scripts/pingfederate/configure-pfpf-se.js. Nothing here talks to PingFederate.
const h = require('../../../scripts/pingfederate/configure-pfpf-se.js');

const SE = 'https://cmuir-pf.ping-devops.com';
const ACME = 'https://cmuir-pf-acme.ping-devops.com';
const RES = 'https://api.ping.demo:3036/mcp';

describe('configure-pfpf-se: which PingFederate are we talking to', () => {
  test('accepts the expected base URL, ignoring case and a trailing slash', () => {
    expect(h.checkIdentity({ federationInfo: { baseUrl: `${ACME.toUpperCase()}/` } }, 'cmuir-pf-acme.ping-devops.com').ok).toBe(true);
  });
  test('refuses another PingFederate and says what it saw', () => {
    const r = h.checkIdentity({ federationInfo: { baseUrl: SE } }, 'cmuir-pf-acme.ping-devops.com');
    expect(r.ok).toBe(false);
    expect(r.got).toBe(SE);
    expect(r.expected).toBe(ACME);
  });
  test('refuses when the admin API gave no base URL (not a PingFederate, or a wrong port)', () => {
    expect(h.checkIdentity(null, 'x.example').ok).toBe(false);
    expect(h.checkIdentity({ federationInfo: {} }, 'x.example').ok).toBe(false);
    expect(h.checkIdentity('<html>', 'x.example').ok).toBe(false);
  });
  test('the sides default to different hosts, namespaces and ports', () => {
    const i = h.sideDefaults('issuer');
    const r = h.sideDefaults('redeemer');
    expect(i.host).toBe('cmuir-pf.ping-devops.com');
    expect(r.host).toBe('cmuir-pf-acme.ping-devops.com');
    expect(i.ns).toBe('ping-devops-curtismuir');
    expect(r.ns).toBe('ping-devops-cmuir');
    expect(i.port).toBe('19999');
    expect(r.port).toBe('29999');
    expect(() => h.sideDefaults('both')).toThrow(/--side/);
  });
});

describe('configure-pfpf-se: issuer side (SP connection for the redeemer)', () => {
  const template = {
    type: 'SP', id: 'aiDemoPfIdJagLocalPfSp', name: 'Local PF', entityId: 'https://local.ping-devops.com:9031', active: true,
    creationDate: 'x', modificationDate: 'y',
    credentials: { certs: [], signingSettings: { signingKeyPairRef: { id: 'k', location: 'https://localhost:9999/k' }, algorithm: 'SHA256withRSA' } },
    oauthTokenExchangeSettings: {
      resourceUris: ['https://old.example/mcp'], idJagEnabled: true, minutesBefore: 5, minutesAfter: 5,
      attributeContract: { coreAttributes: [{ name: 'TOKEN_SUBJECT' }], extendedAttributes: [{ name: 'client_id' }, { name: 'scope' }] },
      processorPolicyMappings: [
        { processorPolicyRef: { id: 'aiDemoPfIdJagPolicy' }, attributeSources: [], issuanceCriteria: { conditionalCriteria: [] },
          attributeContractFulfillment: {
            TOKEN_SUBJECT: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'TOKEN_SUBJECT' },
            client_id: { source: { type: 'TEXT' }, value: 'old-client' },
            scope: { source: { type: 'TEXT' }, value: 'mcp:invoke read' } } },
        { processorPolicyRef: { id: 'aiDemoSamlPolicy' }, attributeSources: [], issuanceCriteria: { conditionalCriteria: [] }, attributeContractFulfillment: {} },
      ],
    },
  };
  const opts = { id: 'aiDemoPfIdJagAcmeSp', name: 'ID-JAG to Acme PF', entityId: ACME, resource: RES, clientId: 'ai-demo-pf-idjag-redeemer' };

  test('copies the template shape: signing, token exchange settings, mappings', () => {
    const sp = h.cloneSpFrom(template, opts);
    expect(sp.id).toBe('aiDemoPfIdJagAcmeSp');
    expect(sp.entityId).toBe(ACME);
    expect(sp.credentials.signingSettings.algorithm).toBe('SHA256withRSA');
    expect(sp.credentials.signingSettings.signingKeyPairRef).toEqual({ id: 'k' });
    expect(sp.oauthTokenExchangeSettings.resourceUris).toEqual([RES]);
    expect(sp.oauthTokenExchangeSettings.idJagEnabled).toBe(true);
    const f = sp.oauthTokenExchangeSettings.processorPolicyMappings[0].attributeContractFulfillment;
    expect(f.client_id).toEqual({ source: { type: 'TEXT' }, value: 'ai-demo-pf-idjag-redeemer' });
    expect(f.scope.value).toBe('mcp:invoke read');
    expect(f.TOKEN_SUBJECT.source.type).toBe('TOKEN_EXCHANGE_PROCESSOR_POLICY');
  });
  test('leaves the SAML mapping to configure-saml-idjag.js and strips read-only fields', () => {
    const sp = h.cloneSpFrom(template, opts);
    expect(sp.oauthTokenExchangeSettings.processorPolicyMappings.map((m) => m.processorPolicyRef.id)).toEqual(['aiDemoPfIdJagPolicy']);
    expect(JSON.stringify(sp)).not.toMatch(/creationDate|modificationDate|location/);
  });
  test('does not mutate the template', () => {
    h.cloneSpFrom(template, opts);
    expect(template.oauthTokenExchangeSettings.resourceUris).toEqual(['https://old.example/mcp']);
    expect(template.oauthTokenExchangeSettings.processorPolicyMappings).toHaveLength(2);
  });
  test('throws, naming the template, when it carries no token exchange settings or no mapping', () => {
    expect(() => h.cloneSpFrom({ id: 'aiDemoPfIdJagLocalPfSp' }, opts)).toThrow(/aiDemoPfIdJagLocalPfSp/);
    const bare = JSON.parse(JSON.stringify(template));
    bare.oauthTokenExchangeSettings.processorPolicyMappings = [bare.oauthTokenExchangeSettings.processorPolicyMappings[1]];
    expect(() => h.cloneSpFrom(bare, opts)).toThrow(/mapping/);
  });
  test('summary shows policy, resource, client and scope but nothing secret', () => {
    const s = h.describeSp(h.cloneSpFrom(template, opts));
    expect(s).toEqual({ entityId: ACME, resourceUris: [RES], policies: ['aiDemoPfIdJagPolicy'], clientIds: ['ai-demo-pf-idjag-redeemer'], scopes: ['mcp:invoke read'], signingKey: 'k' });
  });
});

describe('configure-pfpf-se: redeemer side (Acme)', () => {
  test('IdP connection trusts the issuer entity and its JWKS, mapped to our token manager', () => {
    const c = h.buildIdpConnection({ id: 'idjagFromSePf', entityId: SE, atmId: 'idjagRedeemerAtm' });
    expect(c.entityId).toBe(SE);
    expect(c.idpBrowserSso.oidcProviderSettings.jwksURL).toBe(`${SE}/pf/JWKS`);
    expect(c.idpBrowserSso.oidcProviderSettings.tokenEndpoint).toBe(`${SE}/as/token.oauth2`);
    const m = c.idpOAuthGrantAttributeMapping.accessTokenManagerMappings[0];
    expect(m.accessTokenManagerRef).toEqual({ id: 'idjagRedeemerAtm' });
    expect(m.attributeContractFulfillment.sub).toEqual({ source: { type: 'ASSERTION' }, value: 'sub' });
    expect(m.attributeContractFulfillment.client_id.value).toBe('client_id');
    expect(m.attributeContractFulfillment.scope.value).toBe('scope');
    expect(m.attributeContractFulfillment.act.source.type).toBe('NO_MAPPING');
  });
  test('client: EXTENSION grant only, secret auth, default token manager, secret kept out of everything else', () => {
    const c = h.buildRedeemerClient('s3cret', { clientId: 'ai-demo-pf-idjag-redeemer', atmId: 'idjagRedeemerAtm' });
    expect(c.grantTypes).toEqual(['EXTENSION']);
    expect(c.clientAuth).toEqual({ type: 'SECRET', secret: 's3cret' });
    expect(c.defaultAccessTokenManagerRef).toEqual({ id: 'idjagRedeemerAtm' });
    expect(c.restrictToDefaultAccessTokenManager).toBe(true);
    expect(c.redirectUris).toEqual([]);
    expect(JSON.stringify(h.describeClient(c))).not.toContain('s3cret');
  });
  const descriptor = { id: 'JWT-PLUGIN', configDescriptor: { fields: [
    { name: 'Token Lifetime', defaultValue: '120' }, { name: 'JWS Algorithm', defaultValue: 'RS256' },
    { name: 'Issuer Claim Value' }, { name: 'Audience Claim Value' }, { name: 'Active Signing Certificate Key ID' } ] } };
  test('token manager: Resource URIs include the resource, audience and issuer are set, keys not published', () => {
    const a = h.buildRedeemerAtm(descriptor, { id: 'idjagRedeemerAtm', issuer: ACME, resource: RES, signingKeyId: 'acme-idjag-signing' });
    expect(a.selectionSettings.resourceUris).toEqual([RES]);
    const f = Object.fromEntries(a.configuration.fields.map((x) => [x.name, x.value]));
    expect(f['Issuer Claim Value']).toBe(ACME);
    expect(f['Audience Claim Value']).toBe(RES);
    expect(f['Publish Keys to the PingFederate JWKS Endpoint']).toBe('false');
    expect(f['Use Centralized Signing Key']).toBe('false');
    expect(f['Active Signing Certificate Key ID']).toBe('idjagRedeemerAtm-key');
    expect(a.configuration.tables.find((t) => t.name === 'Certificates').rows[0].fields).toEqual([
      { name: 'Key ID', value: 'idjagRedeemerAtm-key' }, { name: 'Certificate', value: 'acme-idjag-signing' }]);
    expect(a.attributeContract.extendedAttributes.map((x) => x.name)).toEqual(['sub', 'Username', 'act', 'scope', 'client_id']);
  });
  test('a non-URL resource is not put in Resource URIs (PingFederate rejects it)', () => {
    expect(h.buildRedeemerAtm(descriptor, { id: 'a', issuer: ACME, resource: 'urn:x', signingKeyId: 'k' }).selectionSettings.resourceUris).toEqual([]);
  });
  test('missingScopes only reports what is absent', () => {
    expect(h.missingScopes({ scopes: [{ name: 'read' }] }, ['mcp:invoke', 'read'])).toEqual(['mcp:invoke']);
    expect(h.missingScopes({}, ['read'])).toEqual(['read']);
  });
  test('scopes in an ID-JAG scope string split on spaces', () => {
    expect(h.scopeNames('mcp:invoke  accounts:read read')).toEqual(['mcp:invoke', 'accounts:read', 'read']);
  });
});

describe('configure-pfpf-se: redeemer secret', () => {
  test('envValue reads KEY=value and never returns another key', () => {
    expect(h.envValue('A=1\nPF_IDJAG_PF_REDEEMER_CLIENT_SECRET=abc\nB=2\n', 'PF_IDJAG_PF_REDEEMER_CLIENT_SECRET')).toBe('abc');
    expect(h.envValue('A=1\n', 'PF_IDJAG_PF_REDEEMER_CLIENT_SECRET')).toBe('');
  });
});
