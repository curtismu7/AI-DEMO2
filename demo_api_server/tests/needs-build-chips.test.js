'use strict';

/**
 * needs-build-chips.test.js — UC17/UC19/UC20/UC21 launcher chip behaviors.
 */

jest.mock('../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

const {
  resolveActiveUseCaseId,
  shouldSimulateRetiredAgentExchange,
  buildJitExchangeOptions,
  resolveDemoUserGroupsForUseCase,
  JIT_TOKEN_LIFETIME_SEC,
  UC21_DEMO_PREMIUM_GROUP,
} = require('../services/useCaseDemoBehaviors');

const { evaluateMcpFirstTool } = require('../services/simulatedAuthorizeService');
const { logEvent, getEvents } = require('../services/appEventService');

describe('needs-build chip behaviors', () => {
  describe('resolveActiveUseCaseId', () => {
    it('prefers body useCaseId when valid', () => {
      const req = {
        body: { useCaseId: 'audit-trail' },
        session: { agentRunUseCaseId: 'step-up-required' },
      };
      expect(resolveActiveUseCaseId(req)).toBe('audit-trail');
    });

    it('falls back to session agentRunUseCaseId', () => {
      const req = {
        body: {},
        session: { agentRunUseCaseId: 'jit-ephemeral-credentials' },
      };
      expect(resolveActiveUseCaseId(req)).toBe('jit-ephemeral-credentials');
    });

    it('rejects unknown slugs', () => {
      const req = { body: { useCaseId: 'not-a-real-slug' }, session: {} };
      expect(resolveActiveUseCaseId(req)).toBeNull();
    });
  });

  describe('UC19 agent-identity-lifecycle', () => {
    it('flags retired-agent exchange simulation', () => {
      expect(shouldSimulateRetiredAgentExchange('agent-identity-lifecycle')).toBe(true);
      expect(shouldSimulateRetiredAgentExchange('audit-trail')).toBe(false);
    });
  });

  describe('UC17 jit-ephemeral-credentials', () => {
    it('requests a short token_lifetime for JIT exchange', () => {
      expect(buildJitExchangeOptions('jit-ephemeral-credentials')).toEqual({
        tokenLifetime: JIT_TOKEN_LIFETIME_SEC,
      });
      expect(buildJitExchangeOptions('audit-trail')).toEqual({});
    });
  });

  describe('UC21 entitlement-tiered-capability', () => {
    const BASE = {
      userId: 'u-uc21',
      toolName: 'create_transfer',
      tokenAudience: 'https://mcp.example',
      actClientId: 'bff',
      acr: '',
      verticalId: 'banking',
      amount: 600,
      transactionType: 'transfer',
      useCaseId: 'entitlement-tiered-capability',
    };

    it('injects premium tier group for the demo chip', () => {
      const groups = resolveDemoUserGroupsForUseCase(
        'entitlement-tiered-capability',
        ['Standard'],
      );
      expect(groups).toContain(UC21_DEMO_PREMIUM_GROUP);
    });

    it('PERMITs $600 transfer for PrivateBanking tier (skips step-up)', async () => {
      const r = await evaluateMcpFirstTool({
        ...BASE,
        userGroups: [UC21_DEMO_PREMIUM_GROUP],
      });
      expect(r.decision).toBe('PERMIT');
      expect(r.stepUpRequired).toBe(false);
      expect(r.raw.reason).toMatch(/UC21 entitlement-tier capability/);
    });
  });

  describe('UC20 audit-trail', () => {
    it('logEvent surfaces useCaseId on activity events', () => {
      const ev = logEvent('agent', 'info', 'test audit stamp', {
        tag: 'test/audit-trail',
        useCaseId: 'audit-trail',
      });
      expect(ev.useCaseId).toBe('audit-trail');

      // Assert the event was RECORDED, not that the list grew: getEvents()
      // defaults to the first 100 of an oldest-first ring buffer, so in a full
      // suite run (where earlier tests have already logged 100+) the count is
      // pinned and a new event isn't in the default window at all. Ask for the
      // whole ring and find it by id.
      const recorded = getEvents({ limit: 500 }).find((e) => e.id === ev.id);
      expect(recorded).toBeDefined();
      expect(recorded.useCaseId).toBe('audit-trail');
    });
  });
});
