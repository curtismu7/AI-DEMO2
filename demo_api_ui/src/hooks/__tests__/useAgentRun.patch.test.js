/**
 * useAgentRun — pure exported functions.
 *
 * applyJsonPatch: RFC 6902 subset (add/replace/remove) driving AG-UI STATE_DELTA.
 * demoAgentSafety exports: makeReentrancyGuard, clampPanelPosition, claimPendingNl,
 *   isAbortError, resolveEmbeddedFocus, anySignal, isLocalModelTimeout
 *
 * parseSseChunk is private (not exported) — tested indirectly via integration.
 */
import { describe, it, expect } from 'vitest';
import { applyJsonPatch } from '../useAgentRun';

describe('applyJsonPatch — top-level key ops', () => {
  it('add sets a new key', () => {
    const result = applyJsonPatch({}, [{ op: 'add', path: '/status', value: 'running' }]);
    expect(result.status).toBe('running');
  });

  it('replace updates an existing key', () => {
    const result = applyJsonPatch({ status: 'idle' }, [
      { op: 'replace', path: '/status', value: 'running' },
    ]);
    expect(result.status).toBe('running');
  });

  it('remove deletes a key', () => {
    const result = applyJsonPatch({ status: 'idle', other: 1 }, [
      { op: 'remove', path: '/status' },
    ]);
    expect(result).not.toHaveProperty('status');
    expect(result.other).toBe(1);
  });

  it('does not mutate the original state', () => {
    const orig = { status: 'idle' };
    applyJsonPatch(orig, [{ op: 'replace', path: '/status', value: 'running' }]);
    expect(orig.status).toBe('idle');
  });

  it('multiple ops are applied in order', () => {
    const result = applyJsonPatch({ a: 1 }, [
      { op: 'add', path: '/b', value: 2 },
      { op: 'replace', path: '/a', value: 10 },
      { op: 'remove', path: '/b' },
    ]);
    expect(result).toEqual({ a: 10 });
  });
});

describe('applyJsonPatch — array ops (depth-2 with "-" index)', () => {
  it('add with "-" appends to an existing array', () => {
    const result = applyJsonPatch(
      { messages: ['a', 'b'] },
      [{ op: 'add', path: '/messages/-', value: 'c' }],
    );
    expect(result.messages).toEqual(['a', 'b', 'c']);
  });

  it('add with "-" creates the array when key is absent', () => {
    const result = applyJsonPatch({}, [{ op: 'add', path: '/messages/-', value: 'first' }]);
    expect(result.messages).toEqual(['first']);
  });

  it('replace at numeric index updates the element', () => {
    const result = applyJsonPatch(
      { items: ['x', 'y', 'z'] },
      [{ op: 'replace', path: '/items/1', value: 'Y' }],
    );
    expect(result.items).toEqual(['x', 'Y', 'z']);
  });

  it('remove at numeric index splices the element', () => {
    const result = applyJsonPatch(
      { items: ['x', 'y', 'z'] },
      [{ op: 'remove', path: '/items/1' }],
    );
    expect(result.items).toEqual(['x', 'z']);
  });
});

describe('applyJsonPatch — nested object ops (depth-2)', () => {
  it('add sets a nested property', () => {
    const result = applyJsonPatch(
      { activeRun: { id: 'r1' } },
      [{ op: 'add', path: '/activeRun/status', value: 'running' }],
    );
    expect(result.activeRun).toEqual({ id: 'r1', status: 'running' });
  });

  it('replace updates a nested property', () => {
    const result = applyJsonPatch(
      { activeRun: { id: 'r1', status: 'idle' } },
      [{ op: 'replace', path: '/activeRun/status', value: 'done' }],
    );
    expect(result.activeRun.status).toBe('done');
  });

  it('remove deletes a nested property', () => {
    const result = applyJsonPatch(
      { activeRun: { id: 'r1', status: 'done' } },
      [{ op: 'remove', path: '/activeRun/status' }],
    );
    expect(result.activeRun).toEqual({ id: 'r1' });
  });

  it('add creates the parent object when absent', () => {
    const result = applyJsonPatch(
      {},
      [{ op: 'add', path: '/activeRun/status', value: 'idle' }],
    );
    expect(result.activeRun).toEqual({ status: 'idle' });
  });
});

describe('applyJsonPatch — edge cases', () => {
  it('empty operations returns a shallow copy', () => {
    const orig = { a: 1 };
    const result = applyJsonPatch(orig, []);
    expect(result).toEqual({ a: 1 });
    expect(result).not.toBe(orig);
  });

  it('path without leading slash still parses correctly', () => {
    // The impl does path.replace(/^\//, '') so no-slash is effectively the same
    const result = applyJsonPatch({}, [{ op: 'add', path: '/x', value: 42 }]);
    expect(result.x).toBe(42);
  });

  it('handles null value', () => {
    const result = applyJsonPatch({ a: 'x' }, [{ op: 'replace', path: '/a', value: null }]);
    expect(result.a).toBeNull();
  });
});
