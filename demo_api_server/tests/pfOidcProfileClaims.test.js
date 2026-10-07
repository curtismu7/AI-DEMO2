'use strict';

const {
  DATA_STORE_ID, SOURCE_ID, LOOKUP_PATH, CLAIM_NAMES, REQUIRED_ATTRIBUTES, withProfile, profileFacts, dataStoreAttributes,
} = require('../../scripts/pingfederate/oidc-profile-claims');

// The policy as it is today on the local PingFederate (aiDemoPfOidcPolicy): `sub` only.
const todaysPolicy = () => ({
  id: 'aiDemoPfOidcPolicy',
  name: 'AI Demo PF OIDC Policy',
  idTokenLifetime: 5,
  attributeContract: { coreAttributes: [{ name: 'sub', multiValued: false }], extendedAttributes: [] },
  attributeMapping: {
    attributeSources: [],
    attributeContractFulfillment: { sub: { source: { type: 'TOKEN' }, value: 'Username' } },
    issuanceCriteria: { conditionalCriteria: [] },
  },
  accessTokenManagerRef: { id: 'aiDemoPfJwtAtm' },
  scopeAttributeMappings: {},
});

describe('PingFederate OIDC profile claims', () => {
  test('adds the profile claims, a PingOne lookup source, and where each value comes from', () => {
    const policy = withProfile(todaysPolicy(), true);

    expect(policy.attributeContract.extendedAttributes.map((attribute) => attribute.name).sort()).toEqual([...CLAIM_NAMES].sort());
    for (const attribute of policy.attributeContract.extendedAttributes) {
      expect(attribute).toMatchObject({ includeInIdToken: true, includeInUserInfo: true, multiValued: false });
    }
    expect(policy.attributeMapping.attributeSources).toEqual([expect.objectContaining({
      type: 'CUSTOM', id: SOURCE_ID, dataStoreRef: { id: DATA_STORE_ID },
      filterFields: [{ name: 'Resource Path', value: LOOKUP_PATH }],
    })]);
    const fulfilled = policy.attributeMapping.attributeContractFulfillment;
    expect(fulfilled.email).toEqual({ source: { type: 'CUSTOM_DATA_STORE', id: SOURCE_ID }, value: 'p1Email' });
    expect(fulfilled.given_name.value).toBe('p1GivenName');
    expect(fulfilled.family_name.value).toBe('p1FamilyName');
    expect(fulfilled.name.value).toBe('p1FormattedName');
    expect(fulfilled.phone_number.value).toBe('p1MobilePhone');
  });

  test('releases the PingFederate username as preferred_username, so an email never becomes the username', () => {
    // The BFF names a user preferred_username, then email, then sub. Without this claim, releasing email
    // would store every PingFederate user under their email address.
    const fulfilled = withProfile(todaysPolicy(), true).attributeMapping.attributeContractFulfillment;

    expect(fulfilled.preferred_username).toEqual({ source: { type: 'TOKEN' }, value: 'Username' });
    expect(fulfilled.sub).toEqual({ source: { type: 'TOKEN' }, value: 'Username' });
  });

  test('looks the person up by the same username the policy already maps sub from', () => {
    expect(LOOKUP_PATH).toBe('/users?filter=username%20eq%20%22${Username}%22');
  });

  test('is idempotent: adding twice changes nothing more', () => {
    const once = withProfile(todaysPolicy(), true);
    const twice = withProfile(once, true);

    expect(twice).toEqual(once);
    expect(profileFacts(twice)).toEqual(profileFacts(once));
  });

  test('removing it restores the policy exactly, and removing from one without it changes nothing', () => {
    const original = todaysPolicy();

    expect(withProfile(withProfile(original, true), false)).toEqual(original);
    expect(withProfile(original, false)).toEqual(original);
  });

  test('leaves everything else in the policy alone, including claims someone else added', () => {
    const policy = todaysPolicy();
    policy.attributeContract.extendedAttributes.push({ name: 'tenant', includeInIdToken: true, includeInUserInfo: false, multiValued: false });
    policy.attributeMapping.attributeContractFulfillment.tenant = { source: { type: 'TEXT' }, value: 'demo' };
    policy.attributeMapping.attributeSources.push({ type: 'CUSTOM', id: 'other', dataStoreRef: { id: 'x' }, filterFields: [] });

    const added = withProfile(policy, true);
    expect(added.attributeContract.extendedAttributes.map((attribute) => attribute.name)).toContain('tenant');
    expect(added.attributeMapping.attributeContractFulfillment.tenant).toEqual({ source: { type: 'TEXT' }, value: 'demo' });
    expect(added.attributeMapping.attributeSources.map((source) => source.id)).toEqual(['other', SOURCE_ID]);
    expect(added.idTokenLifetime).toBe(5);
    expect(added.accessTokenManagerRef).toEqual({ id: 'aiDemoPfJwtAtm' });

    expect(withProfile(added, false)).toEqual(policy);
  });

  test('does not change the policy it was given', () => {
    const policy = todaysPolicy();
    withProfile(policy, true);

    expect(policy).toEqual(todaysPolicy());
  });

  test('profileFacts tells a policy with the claims from one without', () => {
    expect(profileFacts(todaysPolicy())).toEqual({ claims: [], source: [], fulfilled: {} });
    const facts = profileFacts(withProfile(todaysPolicy(), true));
    expect(facts.claims).toHaveLength(CLAIM_NAMES.length);
    expect(facts.source).toEqual([{ dataStore: DATA_STORE_ID, path: LOOKUP_PATH }]);
    expect(facts.fulfilled.email).toBe('CUSTOM_DATA_STORE:p1Email');
  });

  test('knows which attributes the data store must define, and reads them off a data store body', () => {
    expect(REQUIRED_ATTRIBUTES.sort()).toEqual(['p1Email', 'p1FamilyName', 'p1FormattedName', 'p1GivenName', 'p1MobilePhone']);
    const store = { configuration: { tables: [
      { name: 'Base URLs and Tags', rows: [] },
      { name: 'Attributes', rows: [
        { fields: [{ name: 'Local Attribute', value: 'p1Email' }, { name: 'JSON Response Attribute Path', value: '/x' }] },
        { fields: [{ name: 'Local Attribute', value: 'p1UserId' }, { name: 'JSON Response Attribute Path', value: '/y' }] },
      ] },
    ] } };

    expect(dataStoreAttributes(store)).toEqual(['p1Email', 'p1UserId']);
    expect(dataStoreAttributes({})).toEqual([]);
  });

  test('the user-gate contract defines every attribute the claims need', () => {
    const contract = require('../../spiffe/pingfederate/pf-pingone-user-gate.json');

    for (const name of REQUIRED_ATTRIBUTES) expect(contract.dataStore.attributes).toHaveProperty(name);
    // and the gate's own attributes are still there
    for (const name of ['p1UserId', 'p1Enabled', 'mayActSub', 'matchCount']) expect(contract.dataStore.attributes).toHaveProperty(name);
  });
});
