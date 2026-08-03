'use strict';

describe('demo track observation hooks', () => {
  // The global afterEach in src/__tests__/setup.js calls jest.resetModules().
  // recordToolCall's hook does a LAZY require('./demoTrackService') at call
  // time; after a reset that resolves to a fresh module instance unless this
  // test's own `svc` reference is reloaded from the same (post-reset) cache
  // generation. Re-require both together per test — see
  // project-llm-only-intent-grammar.md for the identical landmine (PR #570).
  let svc;
  let recordToolCall;

  beforeEach(() => {
    jest.resetModules();
    svc = require('../services/demoTrackService');
    ({ recordToolCall } = require('../services/mcpToolAuditStore'));
    svc._resetForTests();
  });

  test('mcpToolAuditStore.recordToolCall feeds observeToolCall', () => {
    recordToolCall({ userId: 'u1', toolName: 'get_account_balance', success: true, duration: 5 });
    expect(svc.getState().run.slots['delegated-access:green']).toMatchObject({ verdict: 'PERMIT' });
  });

  test('recordToolCall failure feeds a red DENY slot when that step is active', () => {
    svc.setActiveStep('mcp-gateway');
    recordToolCall({ userId: 'u1', toolName: 'get_weather', success: false, duration: 5 });
    expect(svc.getState().run.slots['mcp-gateway:red']).toMatchObject({ verdict: 'DENY' });
  });
});
