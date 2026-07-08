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
  test('contains all 38 use cases including UC1..UC22 and UC23..UC28', () => {
    expect(USE_CASES).toHaveLength(38);
    const ids = USE_CASES.map((u) => u.id);
    expect(new Set(ids).size).toBe(38);
    for (let n = 1; n <= 22; n++) expect(ids).toContain(`UC${n}`);
    for (let n = 23; n <= 28; n++) expect(ids).toContain(`UC${n}`);
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
    // unspecified fields fall through to the base
    expect(hc.track).toBe(base.track);
    // banking / no vertical returns base values
    expect(resolveUseCase('UC7', 'banking').trigger.text).toBe(base.trigger.text);
    expect(resolveUseCase('UC7').trigger.text).toBe(base.trigger.text);
    expect(resolveUseCase('NOPE', 'healthcare')).toBeUndefined();
  });

  test('listUseCases returns all 38 resolved for a vertical', () => {
    expect(listUseCases('healthcare')).toHaveLength(38);
    expect(listUseCases()).toHaveLength(38);
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
