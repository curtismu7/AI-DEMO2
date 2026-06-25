'use strict';

/**
 * promptStore.test.ts — regression tests for the prompt loader.
 *
 * Covers:
 *   - CR-01 path-traversal allowlist (non-allowlisted useCase falls back to default)
 *   - Fix #3: when src/prompts is present (it is, via build copy), the curated
 *     `default.json` is loaded — NOT the weak inline fallback. This is the
 *     regression that proves the dist copy / dev path resolves the curated
 *     prompt with its "never reveal raw token values" guardrail.
 *
 * Note: in ts-jest the suite runs from src/ (__dirname → src/prompts), so this
 * exercises the same resolution path `npm run dev` uses. The build:assets copy
 * step makes the same true for dist/ in production.
 */

import { getPrompt } from '../src/promptStore';

describe('promptStore', () => {
  it('loads the curated default.json (not the weak inline fallback)', () => {
    const def = getPrompt('default');
    expect(def.system).toBeTruthy();
    // The curated default.json is materially richer than the 5-word inline
    // fallback ('You are a helpful banking assistant.'). Asserting length > 60
    // catches the regression where src/prompts is not resolvable and the loader
    // silently degrades to the inline string.
    expect(def.system.length).toBeGreaterThan(60);
    expect(def.system).not.toBe('You are a helpful banking assistant.');
  });

  it('rejects a path-traversal useCase and falls back to default (CR-01)', () => {
    const malicious = getPrompt('../../../../etc/passwd');
    const baseline = getPrompt('default');
    expect(malicious.system).toBe(baseline.system);
  });

  it('rejects a non-allowlisted useCase shape and falls back to default', () => {
    const weird = getPrompt('Not A Valid Use Case!!');
    const baseline = getPrompt('default');
    expect(weird.system).toBe(baseline.system);
  });

  it('returns the curated prompt for an unknown but well-formed useCase (default fallback)', () => {
    const unknown = getPrompt('nonexistent_usecase');
    const baseline = getPrompt('default');
    expect(unknown.system).toBe(baseline.system);
    expect(unknown.system.length).toBeGreaterThan(60);
  });
});
