'use strict';

const {
  ACTIONS,
  DEFAULT_PREFERENCES,
  normalizePreferences,
  serializePreferences,
  failoverPreferences,
  evaluatePreferences,
} = require('../services/agentPreferencesService');

describe('agentPreferencesService', () => {
  describe('normalizePreferences', () => {
    test('returns defaults for null/undefined/non-object input', () => {
      expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
      expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
      expect(normalizePreferences('junk')).toEqual(DEFAULT_PREFERENCES);
    });

    test('filters invalid allowedActions and keeps canonical order', () => {
      const prefs = normalizePreferences({ allowedActions: ['write', 'bogus'] });
      expect(prefs.allowedActions).toEqual(['write']);
    });

    test('falls back to defaults when allowedActions is empty or all-invalid', () => {
      expect(normalizePreferences({ allowedActions: [] }).allowedActions).toEqual(ACTIONS.slice());
      expect(normalizePreferences({ allowedActions: ['nope'] }).allowedActions).toEqual(ACTIONS.slice());
    });

    test('preserves an explicitly restricted action list', () => {
      expect(normalizePreferences({ allowedActions: ['read'] }).allowedActions).toEqual(['read']);
    });

    test('accepts a finite non-negative maxAmount and rejects others', () => {
      expect(normalizePreferences({ maxAmount: 500 }).maxAmount).toBe(500);
      expect(normalizePreferences({ maxAmount: -1 }).maxAmount).toBeUndefined();
      expect(normalizePreferences({ maxAmount: '500' }).maxAmount).toBeUndefined();
      expect(normalizePreferences({ maxAmount: NaN }).maxAmount).toBeUndefined();
    });

    test('validates unknownAgentPolicy values', () => {
      expect(normalizePreferences({ unknownAgentPolicy: 'deny' }).unknownAgentPolicy).toBe('deny');
      expect(normalizePreferences({ unknownAgentPolicy: 'bogus' }).unknownAgentPolicy).toBe('hitl');
    });
  });

  describe('serializePreferences / normalizePreferences round-trip', () => {
    test('serialized object re-normalizes to the same object', () => {
      const prefs = normalizePreferences({ allowedActions: ['read'], maxAmount: 250, unknownAgentPolicy: 'deny' });
      const serialized = serializePreferences(prefs);
      expect(typeof serialized).toBe('object'); // PingOne JSON attribute requires an object
      const back = normalizePreferences(serialized);
      expect(back).toEqual(prefs);
    });
  });

  describe('failoverPreferences', () => {
    const configStore = { get: jest.fn() };

    test('fail-closed (default deny mode): no allowed actions, HITL unknown-agent policy', () => {
      const simulatedAuthorizeService = {
        resolveAuthorizeMode: jest.fn(() => ({ failoverMode: 'deny' })),
      };
      expect(failoverPreferences(simulatedAuthorizeService, configStore)).toEqual({
        allowedActions: [],
        detectAgent: true,
        unknownAgentPolicy: 'hitl',
      });
    });

    test('failover_mode=permit opens the gate fully', () => {
      const simulatedAuthorizeService = {
        resolveAuthorizeMode: jest.fn(() => ({ failoverMode: 'permit' })),
      };
      const prefs = failoverPreferences(simulatedAuthorizeService, configStore);
      expect(prefs.allowedActions).toEqual(ACTIONS.slice());
      expect(prefs.unknownAgentPolicy).toBe('hitl');
    });
  });

  describe('evaluatePreferences', () => {
    const fullPrefs = { ...DEFAULT_PREFERENCES, allowedActions: ['read', 'write'] };

    test('permits when tier allowed, no cap breach, no agent detection', () => {
      expect(evaluatePreferences({ prefs: fullPrefs, requiredTier: 'write' })).toEqual({ decision: 'permit' });
    });

    test('HITL when tier not in allowedActions', () => {
      const result = evaluatePreferences({ prefs: { ...fullPrefs, allowedActions: ['read'] }, requiredTier: 'write' });
      expect(result.decision).toBe('hitl');
      expect(result.reason).toContain('write');
    });

    test('HITL when amount exceeds preference cap', () => {
      const result = evaluatePreferences({ prefs: { ...fullPrefs, maxAmount: 500 }, requiredTier: 'write', amount: 750 });
      expect(result.decision).toBe('hitl');
      expect(result.reason).toContain('500');
    });

    test('permits amount at or under the cap', () => {
      expect(evaluatePreferences({ prefs: { ...fullPrefs, maxAmount: 500 }, requiredTier: 'write', amount: 500 })).toEqual({ decision: 'permit' });
    });

    test('denies detected agent when unknownAgentPolicy=deny', () => {
      const result = evaluatePreferences({ prefs: { ...fullPrefs, unknownAgentPolicy: 'deny' }, requiredTier: 'read', agentDetected: true });
      expect(result.decision).toBe('deny');
    });

    test('HITL for detected agent when unknownAgentPolicy=hitl', () => {
      const result = evaluatePreferences({ prefs: fullPrefs, requiredTier: 'read', agentDetected: true });
      expect(result.decision).toBe('hitl');
    });

    test('permits detected agent when unknownAgentPolicy=allow', () => {
      const result = evaluatePreferences({
        prefs: { ...fullPrefs, unknownAgentPolicy: 'allow' }, requiredTier: 'write', agentDetected: true,
      });
      expect(result.decision).toBe('permit');
    });

    test('detection signal ignored when detectAgent preference is off', () => {
      const result = evaluatePreferences({
        prefs: { ...fullPrefs, unknownAgentPolicy: 'deny', detectAgent: false }, requiredTier: 'read', agentDetected: true,
      });
      expect(result.decision).toBe('permit');
    });
  });
});
