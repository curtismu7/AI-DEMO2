'use strict';
/**
 * The OIDC claims PingFederate adds to a sign-in from the PingOne directory.
 *
 * PingFederate's own user (the simple PCV: "demouser") has no profile, so its ID token carried only `sub`.
 * The same people live in the PingOne environment, which is the system of record (see the user gate in
 * pf-pingone-user-gate.json), so the OIDC policy looks the PingOne account up by username and releases its
 * email, name and phone. A claim with no value in PingOne is simply omitted.
 *
 * `preferred_username` is released too, and it matters: the BFF names a user preferred_username, then
 * email, then sub. Releasing an email without it would store every PingFederate user under their email
 * address instead of their PingFederate username.
 *
 * Pure functions only; provision-pf-oidc-profile.js applies them.
 */
const DATA_STORE_ID = 'aiDemoPingOneUsersRest';
const SOURCE_ID = 'p1profile';
// ${Username} is the access token manager's attribute the policy already maps `sub` from.
const LOOKUP_PATH = '/users?filter=username%20eq%20%22${Username}%22';

// claim -> where its value comes from: the PingFederate username itself, or a data store attribute.
const CLAIMS = [
  { claim: 'preferred_username', from: { type: 'TOKEN', value: 'Username' } },
  { claim: 'email', attribute: 'p1Email' },
  { claim: 'given_name', attribute: 'p1GivenName' },
  { claim: 'family_name', attribute: 'p1FamilyName' },
  { claim: 'name', attribute: 'p1FormattedName' },
  { claim: 'phone_number', attribute: 'p1MobilePhone' },
];
const CLAIM_NAMES = CLAIMS.map((entry) => entry.claim);
// The data store attributes this needs (spiffe/pingfederate/pf-pingone-user-gate.json defines them).
const REQUIRED_ATTRIBUTES = CLAIMS.filter((entry) => entry.attribute).map((entry) => entry.attribute);

function profileSource() {
  return {
    type: 'CUSTOM',
    id: SOURCE_ID,
    description: 'PingOne profile of the signed-in user',
    dataStoreRef: { id: DATA_STORE_ID },
    filterFields: [{ name: 'Resource Path', value: LOOKUP_PATH }],
  };
}

function fulfilment(entry) {
  if (entry.from) return { source: { type: entry.from.type }, value: entry.from.value };
  return { source: { type: 'CUSTOM_DATA_STORE', id: SOURCE_ID }, value: entry.attribute };
}

// A copy of the policy with the profile claims present (true) or taken off again (false). Anything else the
// policy has, including claims added by someone else, is left alone.
function withProfile(policy, present) {
  const out = JSON.parse(JSON.stringify(policy));
  const contract = out.attributeContract || { coreAttributes: [], extendedAttributes: [] };
  const mapping = out.attributeMapping || { attributeSources: [], attributeContractFulfillment: {}, issuanceCriteria: { conditionalCriteria: [] } };

  const extended = (contract.extendedAttributes || []).filter((attribute) => !CLAIM_NAMES.includes(attribute.name));
  const sources = (mapping.attributeSources || []).filter((source) => source.id !== SOURCE_ID);
  const fulfilled = { ...(mapping.attributeContractFulfillment || {}) };
  for (const name of CLAIM_NAMES) delete fulfilled[name];

  if (present) {
    for (const entry of CLAIMS) {
      extended.push({ name: entry.claim, includeInIdToken: true, includeInUserInfo: true, multiValued: false });
      fulfilled[entry.claim] = fulfilment(entry);
    }
    sources.push(profileSource());
  }
  contract.extendedAttributes = extended;
  mapping.attributeSources = sources;
  mapping.attributeContractFulfillment = fulfilled;
  out.attributeContract = contract;
  out.attributeMapping = mapping;
  return out;
}

// What this feature's footprint on a policy looks like, for comparing "have" with "want".
function profileFacts(policy) {
  const contract = policy?.attributeContract || {};
  const mapping = policy?.attributeMapping || {};
  const claims = (contract.extendedAttributes || []).filter((attribute) => CLAIM_NAMES.includes(attribute.name))
    .map((attribute) => `${attribute.name}:${attribute.includeInIdToken ? 'id' : '-'}${attribute.includeInUserInfo ? 'ui' : '-'}`).sort();
  const source = (mapping.attributeSources || []).filter((entry) => entry.id === SOURCE_ID)
    .map((entry) => ({
      dataStore: entry.dataStoreRef?.id,
      path: (entry.filterFields || []).find((field) => field.name === 'Resource Path')?.value,
    }));
  const fulfilled = Object.fromEntries(CLAIM_NAMES
    .filter((name) => mapping.attributeContractFulfillment?.[name])
    .map((name) => [name, `${mapping.attributeContractFulfillment[name].source?.type}:${mapping.attributeContractFulfillment[name].value}`]));
  return { claims, source, fulfilled };
}

// The data store attribute names a data store body defines (so the policy is never pointed at ones it lacks).
function dataStoreAttributes(store) {
  const table = (store?.configuration?.tables || []).find((entry) => entry.name === 'Attributes');
  return (table?.rows || []).map((row) => (row.fields || []).find((field) => field.name === 'Local Attribute')?.value).filter(Boolean);
}

module.exports = {
  DATA_STORE_ID, SOURCE_ID, LOOKUP_PATH, CLAIMS, CLAIM_NAMES, REQUIRED_ATTRIBUTES,
  withProfile, profileFacts, dataStoreAttributes,
};
