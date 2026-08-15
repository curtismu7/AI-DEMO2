'use strict';
const svc = require('../services/demoTrackService');

describe('demoTrackService', () => {
  beforeEach(() => svc._resetForTests());

  test('lazily creates a run and fills the active step green slot on tool success', () => {
    svc.observeToolCall({ toolName: 'get_account_balance', success: true, timestamp: '2026-08-03T10:00:00Z' });
    const { run } = svc.getState();
    expect(run.slots['delegated-access:green']).toMatchObject({ verdict: 'PERMIT', via: 'get_account_balance' });
  });

  test('sim observation fills the matching red slot and the gauntlet map', () => {
    svc.observeAttackSim({ sim: 'replayed-token', status: 401, errorCode: 'invalid_token', decisionId: null });
    svc.observeAttackSim({ sim: 'impersonation-no-act', status: 403, errorCode: 'obo_required', decisionId: 'd-1' });
    const { run } = svc.getState();
    expect(run.slots['delegated-access:red'].verdict).toBe('BLOCKED');
    expect(run.gauntlet['impersonation-no-act']).toMatchObject({ blocked: true, decisionId: 'd-1' });
  });

  test('observeDecision fills a red tool slot with decisionId; active step tried first', () => {
    svc.setActiveStep('fine-grained-authz');
    svc.observeDecision({ tool: 'transfer_funds', decision: 'DENY', decisionId: 'd-4f21c9' });
    const { run } = svc.getState();
    expect(run.slots['fine-grained-authz:red']).toMatchObject({ verdict: 'DENY', decisionId: 'd-4f21c9' });
  });

  test('stamps carry a plain-language reason mapped from the error code', () => {
    svc.setActiveStep('delegated-access');
    // replayed-token is step 1's red sim (not a gauntlet tile) — fills the red slot
    svc.observeAttackSim({ sim: 'replayed-token', status: 401, errorCode: 'invalid_aud', decisionId: null });
    const { run } = svc.getState();
    expect(run.slots['delegated-access:red'].errorCode).toBe('invalid_aud');
    expect(run.slots['delegated-access:red'].reason).toMatch(/aud/i);
    // a gauntlet sim records the mapped reason on its tile
    svc.observeAttackSim({ sim: 'insufficient-scope', status: 403, errorCode: 'insufficient_scope', decisionId: null });
    expect(svc.getState().run.gauntlet['insufficient-scope'].reason).toMatch(/scope/i);
  });

  test('a green PERMIT stamp explains what was permitted', () => {
    svc.setActiveStep('delegated-access');
    svc.observeToolCall({ toolName: 'get_account_balance', success: true, timestamp: '2026-08-04T10:00:00Z', decisionId: 'd-ok' });
    expect(svc.getState().run.slots['delegated-access:green'].reason).toMatch(/permitted/i);
  });

  test('observeToolCall stamps the authorize decisionId on PERMIT slots', () => {
    svc.setActiveStep('fine-grained-authz');
    svc.observeToolCall({ toolName: 'transfer_funds', success: true, timestamp: '2026-08-03T10:00:00Z', decisionId: 'd-permit-1' });
    const { run } = svc.getState();
    expect(run.slots['fine-grained-authz:green']).toMatchObject({ verdict: 'PERMIT', decisionId: 'd-permit-1' });
  });

  test('wildcard slots need an armed slot — the active step alone is not enough', () => {
    svc.setActiveStep('pingone-mcp-admin');
    svc.observeToolCall({ toolName: 'some_unknown_tool', success: true, timestamp: '2026-08-03T10:01:00Z' });
    expect(svc.getState().run.slots['pingone-mcp-admin:green']).toBeUndefined();
    svc.armSlot({ stepId: 'pingone-mcp-admin', color: 'green' });
    svc.observeToolCall({ toolName: 'some_unknown_tool', success: true, timestamp: '2026-08-03T10:02:00Z' });
    expect(svc.getState().run.slots['pingone-mcp-admin:green'].verdict).toBe('PERMIT');
  });

  test('an arm is consumed by the fill it caused — the next call cannot walk down the track', () => {
    svc.armSlot({ stepId: 'delegated-access', color: 'green' });
    svc.observeToolCall({ toolName: 'list_orders', success: true, timestamp: '2026-08-03T10:01:00Z' });
    expect(svc.getState().run.slots['delegated-access:green'].via).toBe('list_orders');
    // step 1 green filled and the pointer advanced, but nothing is armed now
    svc.observeToolCall({ toolName: 'list_orders', success: true, timestamp: '2026-08-03T10:02:00Z' });
    expect(svc.getState().run.slots['a2a-delegation:green']).toBeUndefined();
  });

  test('an arm is scoped to one color — arming green does not let a failure fill red', () => {
    svc.armSlot({ stepId: 'fine-grained-authz', color: 'green' });
    svc.observeToolCall({ toolName: 'get_account_balance', success: false, timestamp: '2026-08-03T10:01:00Z', errorCode: 'mcp_authorize_denied' });
    expect(svc.getState().run.slots['fine-grained-authz:red']).toBeUndefined();
  });

  test('an expired arm does not fire the wildcard', () => {
    svc.armSlot({ stepId: 'lifecycle-killswitch', color: 'green', ttlMs: -1 });
    svc.observeToolCall({ toolName: 'some_unknown_tool', success: true, timestamp: '2026-08-03T10:01:00Z' });
    expect(svc.getState().run.slots['lifecycle-killswitch:green']).toBeUndefined();
  });

  test('armSlot rejects an unknown step or color without arming anything', () => {
    svc.armSlot({ stepId: 'nope', color: 'green' });
    svc.armSlot({ stepId: 'delegated-access', color: 'purple' });
    svc.observeToolCall({ toolName: 'some_unknown_tool', success: true, timestamp: '2026-08-03T10:01:00Z' });
    expect(svc.getState().run.slots['delegated-access:green']).toBeUndefined();
  });

  test('auto-advances active step when both slots fill', () => {
    svc.setActiveStep('fine-grained-authz');
    svc.observeToolCall({ toolName: 'transfer_funds', success: true, timestamp: '2026-08-03T10:00:00Z' });
    svc.observeDecision({ tool: 'transfer_funds', decision: 'DENY', decisionId: 'd-1' });
    expect(svc.getState().run.activeStepId).toBe('step-up');
  });

  test('startRun archives the previous run to history', () => {
    svc.observeToolCall({ toolName: 'get_account_balance', success: true, timestamp: '2026-08-03T10:00:00Z' });
    const first = svc.getState().run.runId;
    svc.startRun();
    const { run } = svc.getState();
    expect(run.runId).not.toBe(first);
    expect(run.slots).toEqual({});
    expect(svc.getHistory()[0].runId).toBe(first);
  });
});
