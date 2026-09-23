'use strict';

const { CURRICULUM, getCurriculumStep, nextCurriculumStep } = require('../../config/verticals/oauth-teaching/curriculum');

describe('oauth-teaching curriculum', () => {
  test('orders the OAuth and OIDC path from foundations to delegation', () => {
    expect(CURRICULUM.map((step) => step.id)).toEqual([
      'oauth-foundations',
      'authorization-code-pkce',
      'tokens-and-oidc',
      'scopes-and-least-privilege',
      'token-exchange-delegation',
      'human-in-the-loop',
    ]);
  });

  test('every step names a teaching tool, education panel, and checkpoint', () => {
    for (const step of CURRICULUM) {
      expect(step.tool).toEqual(expect.any(String));
      expect(step.panel).toEqual(expect.any(String));
      expect(step.checkpoint).toEqual(expect.objectContaining({ question: expect.any(String), answer: expect.any(String) }));
    }
  });

  test('advances from a known step and stops at the end', () => {
    expect(getCurriculumStep('authorization-code-pkce').title).toMatch(/PKCE/i);
    expect(nextCurriculumStep('authorization-code-pkce').id).toBe('tokens-and-oidc');
    expect(nextCurriculumStep('human-in-the-loop')).toBeNull();
  });
});
