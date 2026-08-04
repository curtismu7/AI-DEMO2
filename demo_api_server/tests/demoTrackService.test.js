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

  test('wildcard slots only fill on the active step', () => {
    svc.setActiveStep('fine-grained-authz');
    svc.observeToolCall({ toolName: 'some_unknown_tool', success: true, timestamp: '2026-08-03T10:01:00Z' });
    const { run } = svc.getState();
    expect(run.slots['pingone-mcp-admin:green']).toBeUndefined();
    svc.setActiveStep('pingone-mcp-admin');
    svc.observeToolCall({ toolName: 'some_unknown_tool', success: true, timestamp: '2026-08-03T10:02:00Z' });
    expect(svc.getState().run.slots['pingone-mcp-admin:green'].verdict).toBe('PERMIT');
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
