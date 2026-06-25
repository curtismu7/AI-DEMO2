import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ActivityNarrativeProvider, useActivityNarrative } from '../ActivityNarrativeContext';

const wrapper = ({ children }) => <ActivityNarrativeProvider>{children}</ActivityNarrativeProvider>;

describe('ActivityNarrativeContext', () => {
  it('startRequest seeds identity + delegation and collapses prior requests', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    act(() => result.current.startRequest('pay rent'));
    act(() => result.current.startRequest('check balance'));

    expect(result.current.requests).toHaveLength(2);
    expect(result.current.requests[0].collapsed).toBe(true);
    expect(result.current.requests[1].collapsed).toBe(false);
    expect(result.current.requests[1].prompt).toBe('check balance');
    expect(result.current.requests[1].steps.map((s) => s.key)).toEqual(['identity', 'delegation']);
  });

  it('upsertStep adds then replaces a step by key on the current request', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    act(() => result.current.startRequest('check balance'));
    act(() => result.current.upsertStep({ key: 'tool:t1', text: 'Reading your balance…', status: 'running', tone: 'neutral' }));
    expect(result.current.requests[0].steps.at(-1).status).toBe('running');

    act(() => result.current.upsertStep({ key: 'tool:t1', text: 'Read your balance', status: 'done', tone: 'neutral' }));
    const toolSteps = result.current.requests[0].steps.filter((s) => s.key === 'tool:t1');
    expect(toolSteps).toHaveLength(1);
    expect(toolSteps[0].status).toBe('done');
  });

  it('finishRequest flips lingering running steps to done and sets status', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    act(() => result.current.startRequest('check balance'));
    act(() => result.current.upsertStep({ key: 'tool:t1', text: 'Reading…', status: 'running', tone: 'neutral' }));
    act(() => result.current.finishRequest('done'));
    expect(result.current.requests[0].status).toBe('done');
    expect(result.current.requests[0].steps.every((s) => s.status !== 'running')).toBe(true);
  });

  it('keeps method identities stable across a state change (guards the render loop)', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    const before = {
      startRequest: result.current.startRequest,
      upsertStep: result.current.upsertStep,
      finishRequest: result.current.finishRequest,
      reset: result.current.reset,
    };

    act(() => result.current.startRequest('x'));

    expect(result.current.startRequest).toBe(before.startRequest);
    expect(result.current.upsertStep).toBe(before.upsertStep);
    expect(result.current.finishRequest).toBe(before.finishRequest);
    expect(result.current.reset).toBe(before.reset);
  });

  it('reset clears all requests', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    act(() => result.current.startRequest('x'));
    act(() => result.current.reset());
    expect(result.current.requests).toEqual([]);
  });
});
