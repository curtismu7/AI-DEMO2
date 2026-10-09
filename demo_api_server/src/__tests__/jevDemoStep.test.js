'use strict';

// UC-LEARN15 — the Jev decision-model lesson as a demo step. The lesson page
// (/jev-learning) has been reachable from the side nav since the original Jev
// work; these tests pin its presence as a NUMBERED demo step: catalog entry
// with a link trigger, and a presenter guide (same shape as UC2.7's page step).

const { resolveUseCase, listUseCases } = require('../../config/useCases');

describe('UC-LEARN15 Jev demo step', () => {
  const uc = resolveUseCase('UC-LEARN15', 'banking');

  test('exists in the catalog as a learn-track page step', () => {
    expect(uc).toBeTruthy();
    expect(uc.track).toBe('learn');
    expect(uc.trigger).toMatchObject({ type: 'link', path: '/jev-learning' });
    expect(uc.maturity).toBe('works');
    expect(uc.advanced).toBe(false);
  });

  test('carries no feature flag (signed-out, configuration-only live path)', () => {
    expect(uc.maturity).not.toMatch(/^flag:/);
    expect(uc.evidence.tokenChain).toEqual([]);
  });

  test('the /jev-learning route it opens is the real page path', () => {
    // Guard against a typo'd path: the UI route is registered in App.js and
    // the nav points at the same string.
    expect(uc.trigger.path).toBe('/jev-learning');
  });

  test('unique across the catalog', () => {
    const ids = listUseCases('banking').map((u) => u.id);
    expect(ids.filter((id) => id === 'UC-LEARN15')).toHaveLength(1);
  });
});
