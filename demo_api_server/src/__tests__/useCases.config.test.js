'use strict';

const {
  USE_CASES, VERTICALS, getUseCase, resolveUseCase, listUseCases,
} = require('../../config/useCases');

const TRACKS = ['foundations', 'controls', 'attacks', 'hitl', 'tools', 'learn', 'demo'];
const MATURITY = /^(works|needs-console-import|needs-build|flag:[a-z0-9_]+)$/;
// 'tools' and 'learn' are utility/link-type cards (no scenario run), so they
// carry no OWASP threat mapping or product-role narrative.
const UTILITY_TRACKS = ['tools', 'learn'];

describe('useCases catalog SoT', () => {
  test('contains all 34 use cases including UC1..UC22 and UC23..UC24', () => {
    expect(USE_CASES).toHaveLength(34);
    const ids = USE_CASES.map((u) => u.id);
    expect(new Set(ids).size).toBe(34);
    for (let n = 1; n <= 22; n++) expect(ids).toContain(`UC${n}`);
    expect(ids).toContain('UC23');
    expect(ids).toContain('UC24');
    expect(ids).not.toContain('UC25');
  });

  test('every entry is schema-valid', () => {
    for (const u of USE_CASES) {
      expect(typeof u.useCaseId).toBe('string');
      expect(u.useCaseId.length).toBeGreaterThan(0);
      expect(TRACKS).toContain(u.track);
      expect(typeof u.title).toBe('string');
      expect(typeof u.buyerStory).toBe('string');
      expect(typeof u.pingOneSolution).toBe('string');
      expect(['chip', 'attack', 'link']).toContain(u.trigger.type);
      if (u.trigger.type === 'chip') expect(typeof u.trigger.text).toBe('string');
      else if (u.trigger.type === 'attack') expect(typeof u.trigger.sim).toBe('string');
      else expect(typeof u.trigger.path).toBe('string');
      expect(typeof u.expectedOutcome).toBe('string');
      expect(Array.isArray(u.evidence.tokenChain)).toBe(true);
      expect(Array.isArray(u.evidence.activity)).toBe(true);
      expect(Array.isArray(u.codeRefs)).toBe(true);
      expect(u.maturity).toMatch(MATURITY);
      expect(Array.isArray(u.owasp.threats)).toBe(true);
      if (!UTILITY_TRACKS.includes(u.track)) expect(u.owasp.threats.length).toBeGreaterThan(0);
      expect(Array.isArray(u.owasp.sections)).toBe(true);
      expect(typeof u.whatToSay).toBe('string');
      expect(typeof u.advanced).toBe('boolean');
      // A9 Explain modal fields
      expect(typeof u.whatLong).toBe('string');
      expect(u.whatLong.length).toBeGreaterThan(20);
      expect(typeof u.businessValue).toBe('string');
      expect(u.businessValue.length).toBeGreaterThan(20);
      expect(u.productRoles).toBeDefined();
      expect(typeof u.productRoles).toBe('object');
      if (!UTILITY_TRACKS.includes(u.track)) expect(Object.keys(u.productRoles).length).toBeGreaterThan(0);
      expect(u.primaryTool === null || typeof u.primaryTool === 'string').toBe(true);
    }
  });

  test('no banking:-prefixed scopes leak into evidence/codeRefs', () => {
    const blob = JSON.stringify(USE_CASES);
    expect(blob).not.toMatch(/banking:(read|write|admin)/);
  });

  test('VERTICALS lists the 8 supported verticals', () => {
    expect(VERTICALS).toEqual([
      'banking', 'healthcare', 'retail', 'government',
      'university', 'workforce', 'sporting-goods', 'manufacturing',
    ]);
  });

  test('getUseCase returns the base entry by id', () => {
    expect(getUseCase('UC7').useCaseId).toBe('step-up-required');
    expect(getUseCase('NOPE')).toBeUndefined();
  });

  test('resolveUseCase merges perVertical overrides over the base', () => {
    // UC7 carries a healthcare override for its trigger text + whatToSay.
    const base = getUseCase('UC7');
    const hc = resolveUseCase('UC7', 'healthcare');
    expect(hc.trigger.text).toBe(base.perVertical.healthcare.trigger.text);
    expect(hc.trigger.text).toBe('pay my $600 bill');
    expect(hc.whatToSay).toMatch(/step-up/i);
    // unspecified fields fall through to the base
    expect(hc.track).toBe(base.track);
    // banking / no vertical returns base values
    expect(resolveUseCase('UC7', 'banking').trigger.text).toBe(base.trigger.text);
    expect(resolveUseCase('UC7').trigger.text).toBe(base.trigger.text);
    expect(resolveUseCase('NOPE', 'healthcare')).toBeUndefined();
  });

  test('chip triggers resolve to vertical-specific phrases for every VERTICALS entry', () => {
    const expected = {
      banking: {
        UC1: 'show my balance',
        UC6: 'transfer $2500 to savings',
        UC7: 'transfer $600 to savings',
        UC8: 'transfer $300 to savings',
        UC24: 'What branches are near me?',
      },
      healthcare: {
        UC1: 'check my coverage',
        UC6: 'pay my $2500 bill',
        UC7: 'pay my $600 bill',
        UC8: 'pay my $300 bill',
        UC24: 'What clinics are near me?',
      },
      retail: {
        UC1: 'list my orders',
        UC6: 'checkout headphones for $2500',
        UC7: 'checkout headphones for $600',
        UC8: 'checkout headphones for $300',
        UC24: 'What stores are near me?',
      },
      government: {
        UC1: 'show my permits',
        UC6: 'pay the $2500 fee',
        UC7: 'pay the $600 fee',
        UC8: 'pay the $300 fee',
        UC24: 'What city offices are near me?',
      },
      university: {
        UC1: 'show my enrolled courses',
        UC6: 'pay $2500 tuition',
        UC7: 'pay $600 tuition',
        UC8: 'pay $300 tuition',
        UC24: 'What campus locations are near me?',
      },
      workforce: {
        UC1: 'my benefits',
        UC6: 'submit a $2500 expense',
        UC7: 'submit a $600 expense',
        UC8: 'submit a $300 expense',
        UC24: 'What office locations are near me?',
      },
      'sporting-goods': {
        UC1: 'my gear',
        UC6: 'extend my rental $2500',
        UC7: 'extend my rental $600',
        UC8: 'extend my rental $300',
        UC24: 'What stores are near me?',
      },
      manufacturing: {
        UC1: 'show my work orders',
        UC6: 'approve a $2500 purchase order',
        UC7: 'approve a $600 purchase order',
        UC8: 'approve a $300 purchase order',
        UC24: 'What plant locations are near me?',
      },
    };
    for (const vertical of VERTICALS) {
      for (const [id, text] of Object.entries(expected[vertical])) {
        expect(resolveUseCase(id, vertical).trigger.text).toBe(text);
      }
    }
  });

  test('listUseCases returns all 34 resolved for a vertical', () => {
    expect(listUseCases('healthcare')).toHaveLength(34);
    expect(listUseCases()).toHaveLength(34);
  });

  test('only UC14 and UC15 are advanced', () => {
    const advancedIds = USE_CASES.filter((u) => u.advanced).map((u) => u.id);
    expect(advancedIds).toEqual(['UC14', 'UC15']);
  });

  test('resolveUseCase result does not leak perVertical', () => {
    expect(resolveUseCase('UC7', 'healthcare').perVertical).toBeUndefined();
  });

  test('resolveUseCase banking/default path does not leak perVertical', () => {
    expect(resolveUseCase('UC7', 'banking').perVertical).toBeUndefined();
    expect(resolveUseCase('UC7').perVertical).toBeUndefined();
  });

  test('productRoles keys are valid product ids', () => {
    const VALID = new Set(['idp', 'mfa', 'gw', 'authz', 'llm']);
    for (const u of USE_CASES) {
      for (const key of Object.keys(u.productRoles)) {
        expect(VALID.has(key)).toBe(true);
      }
    }
  });

  test('UCs with a match.tool have a non-null primaryTool', () => {
    const withMatch = USE_CASES.filter((u) => u.match);
    for (const u of withMatch) {
      expect(typeof u.primaryTool).toBe('string');
    }
  });
});
