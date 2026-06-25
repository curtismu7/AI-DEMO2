'use strict';

/**
 * Scenario 1 — groupPolicy accessors over config/group-policy.json.
 * Verifies the demo data the simulated engine + live PingOne params rely on,
 * and the ff_authorize_group_policy gate.
 */

const groupPolicy = require('../../services/groupPolicy');

describe('groupPolicy', () => {
  describe('requiredGroupForTool', () => {
    it('returns the required group for a restricted tool', () => {
      expect(groupPolicy.requiredGroupForTool('get_sensitive_account_details')).toBe('PrivilegedBanking');
    });
    it('returns null for an unrestricted tool', () => {
      expect(groupPolicy.requiredGroupForTool('get_my_accounts')).toBeNull();
      expect(groupPolicy.requiredGroupForTool(undefined)).toBeNull();
    });
  });

  describe('groupsForUser', () => {
    it('returns membership for a known demo user', () => {
      expect(groupPolicy.groupsForUser('demoUser')).toContain('PrivilegedBanking');
    });
    it('returns an empty array for the out-of-group demo user', () => {
      expect(groupPolicy.groupsForUser('demoDelegate')).toEqual([]);
    });
    it('returns an empty array for an unknown user', () => {
      expect(groupPolicy.groupsForUser('nobody')).toEqual([]);
      expect(groupPolicy.groupsForUser(undefined)).toEqual([]);
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
});
