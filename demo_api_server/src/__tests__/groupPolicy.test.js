'use strict';

/**
 * Vertical-scoped groupPolicy — manifest-backed accessors + legacy fallback.
 */

const { verticalManifest } = require('../../services/verticalManifest');
const groupPolicy = require('../../services/groupPolicy');

describe('groupPolicy', () => {
  beforeAll(() => {
    verticalManifest.init();
  });

  beforeEach(() => {
    groupPolicy._reset();
  });

  describe('requiredGroupForTool', () => {
    it('returns the privileged group for a restricted tool', () => {
      expect(groupPolicy.requiredGroupForTool('get_sensitive_account_details', 'banking'))
        .toBe('AI_Demo_Privileged');
    });

    it('returns the SAME group for another vertical — one group serves all', () => {
      // The privileged group used to be per-vertical (Banking_Privileged,
      // Healthcare_Privileged, … 11 names for one concept). They are now a single
      // generic group so a demo does not have to manage 11 memberships. This is
      // behaviour-preserving: demoUser/demoAdmin were already privileged in every
      // vertical and demoDelegate in none. The per-vertical part that still
      // matters is WHICH TOOL is gated, which restrictedTools still declares.
      expect(groupPolicy.requiredGroupForTool('sensitive_patient_records', 'healthcare'))
        .toBe('AI_Demo_Privileged');
      expect(groupPolicy.requiredGroupForTool('sensitive_tax_record', 'government'))
        .toBe('AI_Demo_Privileged');
    });

    it('returns null for an unrestricted tool', () => {
      expect(groupPolicy.requiredGroupForTool('get_my_accounts', 'banking')).toBeNull();
      expect(groupPolicy.requiredGroupForTool(undefined, 'banking')).toBeNull();
    });

    it('finding #48: fails closed (non-null) for a non-banking vertical when manifest resolution throws', () => {
      const spy = jest
        .spyOn(verticalManifest.resolver, 'resolve')
        .mockImplementation(() => {
          throw new Error('manifest resolution boom');
        });
      try {
        expect(groupPolicy.requiredGroupForTool('sensitive_patient_records', 'healthcare')).not.toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('falls back to the legacy banking config when manifest resolution throws for banking', () => {
      const spy = jest
        .spyOn(verticalManifest.resolver, 'resolve')
        .mockImplementation(() => {
          throw new Error('manifest resolution boom');
        });
      try {
        expect(groupPolicy.requiredGroupForTool('get_sensitive_account_details', 'banking'))
          .toBe('AI_Demo_Privileged');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('groupsForUserSync', () => {
    it('returns banking membership for demoUser', () => {
      const groups = groupPolicy.groupsForUserSync('demoUser', 'banking');
      expect(groups).toContain('AI_Demo_Privileged');
      // premiumTier is deliberately NOT collapsed into the generic group: banking's
      // tiers.groupToTier maps it to PrivateBanking, so sharing it would make every
      // privileged user PrivateBanking and delete UC21's Standard-denied case.
      expect(groups).toContain('Banking_PremiumTier');
    });

    it('returns delegates group for demoDelegate in banking', () => {
      expect(groupPolicy.groupsForUserSync('demoDelegate', 'banking')).toContain('AI_Demo_Delegates');
    });

    it('returns empty for demoDelegate in healthcare (deny demo)', () => {
      expect(groupPolicy.groupsForUserSync('demoDelegate', 'healthcare')).toEqual([]);
    });

    it('returns empty for unknown user', () => {
      expect(groupPolicy.groupsForUserSync('nobody', 'banking')).toEqual([]);
      expect(groupPolicy.groupsForUserSync(undefined, 'banking')).toEqual([]);
    });
  });

  describe('resolveUserTier', () => {
    it('maps Banking_PremiumTier to PrivateBanking tier', () => {
      expect(groupPolicy.resolveUserTier(['Banking_PremiumTier'], 'banking')).toBe('PrivateBanking');
    });

    it('defaults to Standard when no tier group', () => {
      expect(groupPolicy.resolveUserTier([], 'banking')).toBe('Standard');
    });
  });

  describe('isEnabled', () => {
    it('is off by default and on only when the flag is "true"', () => {
      expect(groupPolicy.isEnabled({ getEffective: () => 'false' })).toBe(false);
      expect(groupPolicy.isEnabled({ getEffective: () => undefined })).toBe(false);
      expect(groupPolicy.isEnabled({ getEffective: () => 'true' })).toBe(true);
      expect(groupPolicy.isEnabled({ getEffective: () => true })).toBe(true);
    });
  });

  describe('isUserGroupsAttributeError', () => {
    it('detects PingOne INVALID_VALUE on parameters.UserGroups', () => {
      const err = new Error(
        'PingOne Authorize decision endpoint evaluation failed (400): ' +
        '{ "details": [ { "target": "parameters.UserGroups", "code": "INVALID_VALUE" } ] }',
      );
      expect(groupPolicy.isUserGroupsAttributeError(err)).toBe(true);
    });

    it('returns false for unrelated PingOne errors', () => {
      expect(groupPolicy.isUserGroupsAttributeError(new Error('ECONNREFUSED'))).toBe(false);
    });
  });

  describe('suppressGroupParams', () => {
    beforeEach(() => groupPolicy._resetGroupParamSuppression());
    afterEach(() => groupPolicy._resetGroupParamSuppression());

    it('is not suppressed by default', () => {
      expect(groupPolicy.areGroupParamsSuppressed()).toBe(false);
    });

    it('suppresses group params after a UserGroups rejection', () => {
      groupPolicy.suppressGroupParams();
      expect(groupPolicy.areGroupParamsSuppressed()).toBe(true);
    });

    it('expires so a transient upstream fault heals itself', () => {
      const t0 = 1_000_000;
      groupPolicy.suppressGroupParams(t0);
      expect(groupPolicy.areGroupParamsSuppressed(t0 + 60_000)).toBe(true);
      expect(groupPolicy.areGroupParamsSuppressed(t0 + 11 * 60_000)).toBe(false);
    });

    // The regression this replaced: the old disableGroupPolicy() wrote
    // ff_authorize_group_policy=false through configStore, which persisted and
    // also stopped userTier being resolved, silently disarming every tier
    // ceiling. Suppression must never touch operator-owned config.
    it('never writes to configStore', () => {
      const setRaw = jest.fn();
      groupPolicy.suppressGroupParams();
      expect(setRaw).not.toHaveBeenCalled();
      expect(groupPolicy.disableGroupPolicy).toBeUndefined();
    });
  });
});
