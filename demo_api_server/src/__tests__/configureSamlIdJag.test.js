'use strict';
// Pure helpers of scripts/pingfederate/configure-saml-idjag.js. Nothing here talks to PingFederate.
const h = require('../../../scripts/pingfederate/configure-saml-idjag.js');

const existing = {
  processorPolicyRef: { id: 'acmeIdJagPolicy' },
  attributeSources: [],
  issuanceCriteria: { conditionalCriteria: [] },
  attributeContractFulfillment: {
    TOKEN_SUBJECT: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'TOKEN_SUBJECT' },
    client_id: { source: { type: 'TEXT' }, value: 'old-client' },
    scope: { source: { type: 'TEXT' }, value: 'mcp:invoke read' },
  },
};
const sp = { id: 'sp1', entityId: 'https://mcp.example', oauthTokenExchangeSettings: { resourceUris: ['r'], processorPolicyMappings: [existing] } };

describe('configure-saml-idjag helpers', () => {
  test('mapping copies the existing shape and swaps only the policy ref', () => {
    const m = h.buildPolicyMapping(sp);
    expect(m.processorPolicyRef).toEqual({ id: h.POLICY_ID });
    expect(m.attributeContractFulfillment.scope).toEqual(existing.attributeContractFulfillment.scope);
    expect(m.attributeContractFulfillment.TOKEN_SUBJECT).toEqual(existing.attributeContractFulfillment.TOKEN_SUBJECT);
    expect(m.attributeContractFulfillment.client_id.value).toBe('old-client');
    expect(existing.processorPolicyRef.id).toBe('acmeIdJagPolicy'); // source not mutated
  });

  test('client_id override replaces only client_id', () => {
    const m = h.buildPolicyMapping(sp, { clientId: 'redeemer' });
    expect(m.attributeContractFulfillment.client_id).toEqual({ source: { type: 'TEXT' }, value: 'redeemer' });
    expect(m.attributeContractFulfillment.scope.value).toBe('mcp:invoke read');
  });

  test('no mapping to copy returns null', () => {
    expect(h.buildPolicyMapping({ oauthTokenExchangeSettings: { processorPolicyMappings: [] } })).toBeNull();
  });

  test('addMapping adds once and skips when present', () => {
    const next = h.addMapping(sp, h.buildPolicyMapping(sp));
    expect(next.oauthTokenExchangeSettings.processorPolicyMappings).toHaveLength(2);
    expect(sp.oauthTokenExchangeSettings.processorPolicyMappings).toHaveLength(1);
    expect(h.hasPolicyMapping(next)).toBe(true);
    expect(h.addMapping(next, h.buildPolicyMapping(next))).toBeNull();
  });

  test('removeMapping drops only our mapping and nothing else', () => {
    const withOurs = h.addMapping(sp, h.buildPolicyMapping(sp));
    expect(h.removeMapping(withOurs)).toEqual(sp);
    expect(h.removeMapping(sp)).toBeNull();
  });

  test('unresolvedPolicyRefs flags attributes the policy does not provide', () => {
    const m = h.buildPolicyMapping(sp);
    expect(h.unresolvedPolicyRefs(m, h.buildPolicy())).toEqual([]);
    m.attributeContractFulfillment.x = { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'nope' };
    expect(h.unresolvedPolicyRefs(m, h.buildPolicy())).toEqual(['nope']);
  });

  test('CA id is lower case', () => {
    expect(h.CA_ID).toBe('aidemosamlca');
    expect(h.assertLowerCaseId(h.CA_ID)).toBe('aidemosamlca');
    expect(() => h.assertLowerCaseId('AiDemoSamlCa')).toThrow(/lower case/);
    expect(h.buildCaImport('PEM').id).toBe('aidemosamlca');
  });

  test('policy is SAML typed with subject and TOKEN_SUBJECT from SAML_SUBJECT', () => {
    const p = h.buildPolicy().processorMappings[0];
    expect(p.subjectTokenType).toBe('urn:ietf:params:oauth:token-type:saml2');
    expect(p.attributeContractFulfillment.subject.value).toBe('SAML_SUBJECT');
    expect(p.attributeContractFulfillment.TOKEN_SUBJECT.value).toBe('SAML_SUBJECT');
  });

  test('client is token exchange only with the policy ref', () => {
    const c = h.buildClient('s');
    expect(c.grantTypes).toEqual(['TOKEN_EXCHANGE']);
    expect(c.tokenExchangeProcessorPolicyRef.id).toBe(h.POLICY_ID);
  });

  test('flag parsing', () => {
    expect(h.parseArgs(['--dry-run', '--ns=x', '--pf-pf-entity=https://a/b?c=d'])).toEqual({ 'dry-run': true, ns: 'x', 'pf-pf-entity': 'https://a/b?c=d' });
  });

  test('findSpByEntity selects by entity id and refuses ambiguity', () => {
    const items = [{ id: 'a', entityId: 'e1' }, { id: 'b', entityId: 'e2' }];
    expect(h.findSpByEntity(items, 'e2').id).toBe('b');
    expect(h.findSpByEntity(items, 'zz')).toBeNull();
    expect(() => h.findSpByEntity([...items, { id: 'c', entityId: 'e1' }], 'e1')).toThrow(/matches 2/);
  });

  test('buildProcessor takes field names from the descriptor and leaves the optional DN tables empty', () => {
    const d = { id: 'desc.Saml20', configDescriptor: { fields: [{ name: 'Audience' }, { name: 'X', defaultValue: 1 }],
      tables: [{ name: 'Valid Certificate Issuer DNs', columns: [{ name: 'Issuer DN' }] }, { name: 'Valid Certificate Subject DNs', columns: [{ name: 'Subject DN' }] }] } };
    const p = h.buildProcessor(d, { audience: 'aud' });
    expect(p.configuration.fields).toEqual(expect.arrayContaining([{ name: 'Audience', value: 'aud' }, { name: 'X', value: '1' }]));
    expect(p.configuration.tables).toEqual([{ name: 'Valid Certificate Issuer DNs', rows: [] }, { name: 'Valid Certificate Subject DNs', rows: [] }]);
    expect(JSON.stringify(p)).not.toMatch(/aidemosamlca/);
    expect(() => h.buildProcessor({ id: 'd', configDescriptor: { fields: [], tables: [] } }, { audience: 'a' })).toThrow(/Audience/);
  });

  test('buildProcessor restricts only the issuer table when an issuer DN is given', () => {
    const d = { id: 'd', configDescriptor: { fields: [{ name: 'Audience' }],
      tables: [{ name: 'Valid Certificate Issuer DNs', columns: [{ name: 'Issuer DN' }] }, { name: 'Valid Certificate Subject DNs', columns: [{ name: 'Subject DN' }] }] } };
    const p = h.buildProcessor(d, { audience: 'a', issuerDn: 'CN=x,O=y' });
    expect(p.configuration.tables[0].rows[0].fields).toEqual([{ name: 'Issuer DN', value: 'CN=x,O=y' }]);
    expect(p.configuration.tables[1].rows).toEqual([]);
  });

  test('upsertEnvLine replaces or appends and keeps other lines', () => {
    expect(h.upsertEnvLine('A=1\nK=old\n', 'K', 'new')).toBe('A=1\nK=new\n');
    expect(h.upsertEnvLine('A=1\n', 'K', 'v')).toBe('A=1\nK=v\n');
    expect(h.envValue('A=1\nK=v\n', 'K')).toBe('v');
  });
});
