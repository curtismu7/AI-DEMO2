/**
 * @file pingOneAuthorizeTierParameters.test.js
 *
 * The PEP half of the UC21 tier relocation.
 *
 * PingOne Authorize's DSL has no set/contains operator, so `tiers.groupToTier`
 * (a PingOne group ARRAY -> tier name) cannot live in the cloud policy. The BFF
 * resolves membership and forwards the flattened SCALAR `UserTier` — the same
 * precedent as InRequiredGroup and TokenKidKnown. The cloud conditions
 * IsStandardTier / ExceedsTierAmountCap then read `UserTier` and `Amount` and
 * own the thresholds.
 *
 * That split only holds if three things line up, and nothing else checks them
 * together:
 *   1. the PEP actually emits UserTier + Amount on the decision request;
 *   2. the STRING it emits is one the generated cloud condition compares against
 *      (a rename on either side makes every tier rule silently unreachable —
 *      P1AZ would PERMIT while the simulator kept denying);
 *   3. omitting the tier keeps the request inert, so the rules stay dormant when
 *      ff_authorize_group_policy is off.
 *
 * Ties demo_api_server/services/{groupPolicy,pingOneAuthorizeService}.js to
 * snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json.
 */
'use strict';

jest.mock('../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

const fs = require('fs');
const path = require('path');

const groupPolicy = require('../services/groupPolicy');
const { buildMcpDelegationParameters } = require('../services/pingOneAuthorizeService');

const SNAP = path.join(
  __dirname, '..', '..', 'snapshots',
  'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json',
);
const ATTR_USER_TIER = '12345678-0015-4321-abcd-000000000015';
const ATTR_AMOUNT = '12345678-0001-4321-abcd-000000000001';
const COND_IS_STANDARD_TIER = '23456789-0015-4321-abcd-000000000015';
const COND_EXCEEDS_TIER_CAP = '23456789-0018-4321-abcd-000000000018';

const snapshot = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const findById = (id) => snapshot.find((o) => o.id === id);

/** Every string constant a snapshot condition compares against. */
function constantsOf(cond) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    const c = n.comparison && n.comparison.right && n.comparison.right.constant;
    if (c && typeof c.value === 'string') out.push(c.value);
    if (n.and) (n.and.conditions || []).forEach(walk);
    if (n.or) (n.or.conditions || []).forEach(walk);
    if (n.not) walk(n.not.condition);
  };
  walk(cond.condition);
  return out;
}

const baseArgs = {
  userId: 'user-1',
  toolName: 'create_transfer',
  transactionType: 'transfer',
};

describe('UC21 tier attributes reach PingOne Authorize', () => {
  test('the PEP forwards UserTier and Amount — the two the tier rules read', () => {
    const params = buildMcpDelegationParameters({
      ...baseArgs,
      userTier: 'Standard',
      amount: 5000,
    });

    expect(params.UserTier).toBe('Standard');
    expect(params.Amount).toBe(5000);
  });

  test('omitting the tier omits the key, keeping the cloud rules dormant', () => {
    // ff_authorize_group_policy off => no tier resolved => the attribute falls
    // back to its 'none' default and no tier rule can fire. Sending a null or ''
    // would instead claim "the tier was resolved and is empty".
    //
    // ⚠️ This is also the shape of the relocated control's fail-open, and it is
    // reachable at runtime. mcpToolAuthorizationService.js:1231-1244 self-heals a
    // live PingOne 400 naming `parameters.UserGroups` (INVALID_VALUE) by calling
    // groupPolicy.disableGroupPolicy() and retrying with requiredGroup,
    // userGroups, userTier and inRequiredGroup all stripped. UserTier then
    // defaults to 'none' in the cloud and EVERY tier ceiling goes dormant —
    // PERMIT, not DENY. The retry does surface (autoDisabledGroupPolicy ->
    // DemoAuthzFallbackModal.jsx), but disableGroupPolicy PERSISTS the flag off
    // via configStore.setRaw, so only the first call after the fault is
    // announced; every later one is quietly unenforced until the flag is
    // re-enabled. Treat "tier DENY stopped firing" as "check the flag" first.
    const params = buildMcpDelegationParameters({ ...baseArgs, userTier: null, amount: 5000 });

    expect(params).not.toHaveProperty('UserTier');
    expect(findById(ATTR_USER_TIER).defaultValue).toBe('none');
  });

  test('the tier string the PEP sends is one the cloud condition matches', () => {
    // The contract. groupPolicy.resolveUserTier is the only producer of this
    // value; ExceedsTierAmountCap is the only consumer. A rename on either side
    // makes every tier rule unreachable in the cloud while the simulator, which
    // reads the same manifest, keeps denying — a silent PERMIT.
    const cloudTiers = new Set([
      ...constantsOf(findById(COND_IS_STANDARD_TIER)),
      ...constantsOf(findById(COND_EXCEEDS_TIER_CAP)).filter((v) => !/^\d+$/.test(v)),
    ]);

    for (const tier of Object.keys(groupPolicy.getTierDefinitions('banking'))) {
      const params = buildMcpDelegationParameters({ ...baseArgs, userTier: tier, amount: 1 });
      expect(cloudTiers.has(params.UserTier)).toBe(true);
    }
  });

  test('every group in groupToTier resolves to a tier the cloud policy knows', () => {
    // Membership resolution is the part that stays at the PEP. Prove the PEP's
    // output domain is exactly the cloud's input domain, including the default.
    const cloudTiers = new Set([
      ...constantsOf(findById(COND_IS_STANDARD_TIER)),
      ...constantsOf(findById(COND_EXCEEDS_TIER_CAP)).filter((v) => !/^\d+$/.test(v)),
    ]);

    // A member of no group falls to the default tier.
    expect(cloudTiers.has(groupPolicy.resolveUserTier([], 'banking'))).toBe(true);

    const manifest = require('../config/verticals/banking/manifest.json');
    for (const groupName of Object.keys(manifest.tiers.groupToTier)) {
      const tier = groupPolicy.resolveUserTier([groupName], 'banking');
      expect(tier).toBe(manifest.tiers.groupToTier[groupName]);
      expect(cloudTiers.has(tier)).toBe(true);
    }
  });

  test('the cloud ceilings are the manifest ceilings the simulator uses', () => {
    // Same numbers, one source. This is the assertion that fails if someone
    // edits the manifest and does not regenerate the snapshot.
    const defs = groupPolicy.getTierDefinitions('banking');
    const cond = findById(COND_EXCEEDS_TIER_CAP);
    const emitted = {};
    for (const branch of cond.condition.or.conditions) {
      const [tierNode, amountNode] = branch.and.conditions;
      const tier = tierNode.reference
        ? constantsOf(findById(COND_IS_STANDARD_TIER))[0]
        : tierNode.comparison.right.constant.value;
      expect(amountNode.comparison.left.attribute.id).toBe(ATTR_AMOUNT);
      emitted[tier] = amountNode.comparison.right.constant.value;
    }

    for (const [tier, def] of Object.entries(defs)) {
      expect(emitted[tier]).toBe(String(def.maxAmountUsd));
    }
  });

  test('the ceiling is a policy constant, never a PEP-supplied attribute', () => {
    // Forwarding a pre-computed UserMaxAmountUsd would leave P1AZ evaluating
    // "Amount > whatever the BFF said" — the threshold would be back in
    // JavaScript, which is what moving it into P1AZ was for.
    const params = buildMcpDelegationParameters({
      ...baseArgs, userTier: 'Standard', amount: 5000,
    });
    expect(params).not.toHaveProperty('UserMaxAmountUsd');

    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.comparison && n.comparison.right && n.comparison.right.attribute) {
        throw new Error('a tier ceiling is compared against an attribute');
      }
      if (n.and) (n.and.conditions || []).forEach(walk);
      if (n.or) (n.or.conditions || []).forEach(walk);
    };
    expect(() => walk(findById(COND_EXCEEDS_TIER_CAP).condition)).not.toThrow();
  });
});
