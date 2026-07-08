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
    it('returns the banking privileged group for a restricted tool', () => {
      expect(groupPolicy.requiredGroupForTool('get_sensitive_account_details', 'banking'))
        .toBe('Banking_Privileged');
    });

    it('returns the healthcare privileged group for sensitive_patient_records', () => {
      expect(groupPolicy.requiredGroupForTool('sensitive_patient_records', 'healthcare'))
        .toBe('Healthcare_Privileged');
    });

    it('returns null for an unrestricted tool', () => {
      expect(groupPolicy.requiredGroupForTool('get_my_accounts', 'banking')).toBeNull();
      expect(groupPolicy.requiredGroupForTool(undefined, 'banking')).toBeNull();
    });
  });

  describe('groupsForUserSync', () => {
    it('returns banking membership for demoUser', () => {
      const groups = groupPolicy.groupsForUserSync('demoUser', 'banking');
      expect(groups).toContain('Banking_Privileged');
      expect(groups).toContain('Banking_PremiumTier');
    });

    it('returns delegates group for demoDelegate in banking', () => {
      expect(groupPolicy.groupsForUserSync('demoDelegate', 'banking')).toContain('Banking_Delegates');
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

  describe('disableGroupPolicy', () => {
    it('persists ff_authorize_group_policy=false via configStore.setRaw', async () => {
      const setRaw = jest.fn().mockResolvedValue(undefined);
      await groupPolicy.disableGroupPolicy({ setRaw });
      expect(setRaw).toHaveBeenCalledWith({ ff_authorize_group_policy: 'false' });
    });
  });
});
