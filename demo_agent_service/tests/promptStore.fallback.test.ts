'use strict';

/**
 * promptStore.fallback.test.ts — Phase 4 self-mend ladder + status tracking.
 *
 * Module-level state (`_cache`, worst-seen source) requires a fresh module per
 * test — jest.isolateModules + jest.mock('fs').
 *
 * Note: under ts-jest, __dirname inside promptStore.ts is already src/, so
 * PROMPTS_DIR (join(__dirname, 'prompts')) and SRC_FALLBACK_DIR
 * (resolve(join(__dirname, '..', 'src', 'prompts'))) resolve to the SAME
 * directory in this test environment. A path-text predicate on existsSync
 * can't distinguish "primary" vs "src fallback" calls here, so the
 * src_fallback case below uses a call-count mock instead: false for the
 * first two existsSync calls (primary useCase.json + primary default.json
 * miss), true from the third call onward (first src-fallback probe). This is
 * deterministic regardless of what the resolved path strings actually are.
 */
jest.mock('fs');

import { existsSync, readFileSync } from 'fs';

const mockExists = existsSync as jest.MockedFunction<typeof existsSync>;
const mockRead = readFileSync as jest.MockedFunction<typeof readFileSync>;

// Load a fresh promptStore instance (fresh cache + status) per test.
function freshStore() {
  let store: typeof import('../src/promptStore');
  jest.isolateModules(() => {
    store = require('../src/promptStore');
  });
  return store!;
}

describe('promptStore fallback ladder', () => {
  beforeEach(() => {
    mockExists.mockReset();
    mockRead.mockReset();
  });

  it('primary: reads from dist prompts dir and reports source primary', () => {
    mockExists.mockImplementation((p) => String(p).endsWith('default.json'));
    mockRead.mockReturnValue(JSON.stringify({ system: 'curated' }) as never);
    const store = freshStore();
    expect(store.getPrompt('default').system).toBe('curated');
    expect(store.getPromptStoreStatus().source).toBe('primary');
  });

  it('src_fallback: dist prompts missing, self-mends from src/prompts and reports it', () => {
    // First two existsSync calls (primary useCase.json, primary default.json)
    // miss; the third call (first src-fallback probe) hits. Deterministic
    // under ts-jest where the primary and src-fallback dirs are the same path.
    let calls = 0;
    mockExists.mockImplementation(() => {
      calls += 1;
      return calls >= 3;
    });
    mockRead.mockReturnValue(JSON.stringify({ system: 'curated-from-src' }) as never);
    const store = freshStore();
    expect(store.getPrompt('default').system).toBe('curated-from-src');
    expect(store.getPromptStoreStatus().source).toBe('src_fallback');
  });

  it('inline_fallback: nothing anywhere — minimal prompt, status inline_fallback', () => {
    mockExists.mockReturnValue(false);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = freshStore();
    expect(store.getPrompt('default').system).toBe('You are a helpful banking assistant.');
    expect(store.getPromptStoreStatus().source).toBe('inline_fallback');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('status is worst-seen: a later primary hit does not clear a degraded status', () => {
    mockExists.mockReturnValue(false);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = freshStore();
    store.getPrompt('default'); // inline_fallback
    mockExists.mockImplementation((p) => String(p).endsWith('banking.json'));
    mockRead.mockReturnValue(JSON.stringify({ system: 'x' }) as never);
    store.getPrompt('banking'); // primary hit
    expect(store.getPromptStoreStatus().source).toBe('inline_fallback');
    errSpy.mockRestore();
  });
});
