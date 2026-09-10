import { describe, expect, test } from 'vitest';
import { deriveActorLane, nextPlayIndex } from '../stepReplay';

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
