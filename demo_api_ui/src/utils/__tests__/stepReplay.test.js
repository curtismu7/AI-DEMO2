import { describe, expect, test } from 'vitest';
import { buildSequenceLayout, deriveActorLane, nextPlayIndex } from '../stepReplay';

describe('deriveActorLane', () => {
  test('lists actors in first-appearance order, deduped', () => {
    const steps = [
      { actor: 'browser', toActor: 'bff' },
      { actor: 'bff', toActor: 'pingone' },
      { actor: 'pingone', toActor: 'bff' },
    ];
    expect(deriveActorLane(steps)).toEqual(['browser', 'bff', 'pingone']);
  });

  test('returns an empty array when no step carries an actor (existing MCP-step shape)', () => {
    const steps = [{ id: 'as', title: 'PingOne', detail: '...', status: 'done' }];
    expect(deriveActorLane(steps)).toEqual([]);
  });
});

describe('nextPlayIndex', () => {
  test('advances by one while below the last index', () => {
    expect(nextPlayIndex(0, 5)).toEqual({ index: 1, done: false });
  });

  test('reports done at the last index instead of overrunning', () => {
    expect(nextPlayIndex(4, 5)).toEqual({ index: 4, done: true });
  });
});

describe('buildSequenceLayout', () => {
  const STEPS = [
    { actor: 'browser', toActor: 'bff' }, // cross-lane arrow
    { actor: 'bff' }, // internal — self-loop, no toActor
    { actor: 'bff', toActor: 'pingone' },
  ];

  test('maps each step to its lane indices, in lane order', () => {
    const { lane, rows } = buildSequenceLayout(STEPS, 0);
    expect(lane).toEqual(['browser', 'bff', 'pingone']);
    expect(rows).toEqual([
      { index: 0, fromIdx: 0, toIdx: 1, isSelf: false, highlighted: true, dimmed: false },
      { index: 1, fromIdx: 1, toIdx: 1, isSelf: true, highlighted: false, dimmed: true },
      { index: 2, fromIdx: 1, toIdx: 2, isSelf: false, highlighted: false, dimmed: true },
    ]);
  });

  test('a step with no actor at all produces a null-lane row (skippable by the renderer)', () => {
    const { rows } = buildSequenceLayout([{ id: 'as', title: 'x' }], 0);
    expect(rows).toEqual([{ index: 0, fromIdx: null, toIdx: null, isSelf: false, highlighted: true, dimmed: false }]);
  });

  test('dimmed is only true for steps AFTER the active index', () => {
    const { rows } = buildSequenceLayout(STEPS, 2);
    expect(rows.map((r) => r.dimmed)).toEqual([false, false, false]);
    expect(rows.map((r) => r.highlighted)).toEqual([false, false, true]);
  });
});
