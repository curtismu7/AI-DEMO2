'use strict';

/**
 * loginFlowTraceService — in-memory recorder for the "you clicked Sign in →
 * you landed back signed in" login sequence, so the SPA can render it as a
 * completed step-by-step diagram once the browser returns from PingOne.
 */

const loginFlowTrace = require('../services/loginFlowTraceService');

test('addStep accumulates steps in order under one trace id, numbered from 1', () => {
  loginFlowTrace.start('trace-1');
  loginFlowTrace.addStep('trace-1', { title: 'first' });
  loginFlowTrace.addStep('trace-1', { title: 'second' });

  const steps = loginFlowTrace.finish('trace-1');

  expect(steps.map((s) => s.title)).toEqual(['first', 'second']);
  expect(steps.map((s) => s.step)).toEqual([1, 2]);
});

test('finish removes the trace — a second finish returns empty', () => {
  loginFlowTrace.start('trace-2');
  loginFlowTrace.addStep('trace-2', { title: 'only' });

  expect(loginFlowTrace.finish('trace-2')).toHaveLength(1);
  expect(loginFlowTrace.finish('trace-2')).toEqual([]);
});

test('addStep on an id that was never started is a no-op, not a throw', () => {
  expect(() => loginFlowTrace.addStep('never-started', { title: 'x' })).not.toThrow();
  expect(loginFlowTrace.finish('never-started')).toEqual([]);
});

test('addStep never throws on malformed input — tracing must not break login', () => {
  loginFlowTrace.start('trace-3');
  expect(() => loginFlowTrace.addStep('trace-3', null)).not.toThrow();
  expect(() => loginFlowTrace.addStep(null, { title: 'x' })).not.toThrow();
});

test('a trace older than the TTL is swept away on the next start()', () => {
  jest.useFakeTimers();
  try {
    loginFlowTrace.start('trace-4');
    loginFlowTrace.addStep('trace-4', { title: 'stale' });

    jest.advanceTimersByTime(6 * 60 * 1000); // past the 5-minute TTL
    loginFlowTrace.start('trace-5'); // triggers the sweep

    expect(loginFlowTrace.finish('trace-4')).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});
