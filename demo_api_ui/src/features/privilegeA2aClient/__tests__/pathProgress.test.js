import { describe, expect, test } from 'vitest';
import { pathProgress, stepIndexFor } from '../pathProgress';

const e = (kind, fromKey = '') => ({ kind, fromKey });

describe('pathProgress', () => {
  test('a full model run walks the path: main model, handoff, worker model, MCP call, MCP result, answer back', () => {
    const run = [e('model', 'main'), e('delegate', 'main'), e('model', 'analyst'), e('mcp-call', 'analyst'), e('mcp-result', 'mcp'), e('result', 'analyst')];
    expect(stepIndexFor(run[0])).toBe(0);
    expect(stepIndexFor(run[2])).toBe(2);
    expect(pathProgress(run.slice(0, 2), true)).toEqual({ reached: 1, active: 1 });
    expect(pathProgress(run.slice(0, 3), true)).toEqual({ reached: 2, active: 2 });
    expect(pathProgress(run.slice(0, 4), true)).toEqual({ reached: 3, active: 3 });
    // the answer returning to the main agent keeps everything reached
    expect(pathProgress(run, true)).toEqual({ reached: 4, active: 0 });
    expect(pathProgress(run, false)).toEqual({ reached: 4, active: null });
  });

  test('a Heuristics run has no model events but still marks the segments it passes through', () => {
    const run = [e('delegate', 'main'), e('mcp-call', 'analyst'), e('result', 'analyst'), e('mcp-result', 'mcp')];
    expect(pathProgress(run, false)).toEqual({ reached: 4, active: null });
  });

  test('nothing, or events that say nothing about the path, leave it idle', () => {
    expect(pathProgress([], true)).toEqual({ reached: -1, active: null });
    expect(pathProgress([e('session'), e('error')], true)).toEqual({ reached: -1, active: null });
  });
});
