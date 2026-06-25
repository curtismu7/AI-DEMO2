'use strict';

/**
 * Unit tests for the shared MCP tool-result classifier (issue #402).
 * It must recognise BOTH code shapes the unified pipeline can return — the
 * mcp_-prefixed authorize-gate codes and the bare gateway/content forms — and
 * normalise to a single canonical outcome both agent paths consume.
 */

const { classifyMcpToolResult } = require('../../services/mcpToolOutcome');

describe('classifyMcpToolResult', () => {
  test('null / undefined / no-error → ok', () => {
    expect(classifyMcpToolResult(null).kind).toBe('ok');
    expect(classifyMcpToolResult(undefined).kind).toBe('ok');
    expect(classifyMcpToolResult({ accounts: [] }).kind).toBe('ok');
  });

  test('bare hitl_required → hitl with consent default', () => {
    const c = classifyMcpToolResult({ error: 'hitl_required' });
    expect(c.kind).toBe('hitl');
    expect(c.error).toBe('hitl_required');
    expect(c.hitl).toEqual({ type: 'consent' });
  });

  test('mcp_-prefixed gate code mcp_hitl_required → hitl, normalised to bare code', () => {
    const c = classifyMcpToolResult({ error: 'mcp_hitl_required', error_description: 'Approval needed.', challengeId: 'chal-9' });
    expect(c.kind).toBe('hitl');
    expect(c.error).toBe('hitl_required');
    expect(c.hitlChallengeId).toBe('chal-9'); // challengeId → hitlChallengeId
    expect(c.message).toBe('Approval needed.'); // error_description → message
    expect(c.hitl).toEqual({ type: 'consent' });
  });

  test('bare step_up_required → step_up', () => {
    const c = classifyMcpToolResult({ error: 'step_up_required' });
    expect(c.kind).toBe('step_up');
    expect(c.error).toBe('step_up_required');
    expect(c.hitl).toEqual({ type: 'step_up' });
  });

  test('mcp_step_up_required → step_up, carries acr_values when present', () => {
    const c = classifyMcpToolResult({ error: 'mcp_step_up_required', step_up_method: 'email', step_up_acr: 'Multi_Factor' });
    expect(c.kind).toBe('step_up');
    expect(c.error).toBe('step_up_required');
    expect(c.step_up_method).toBe('email');
    expect(c.step_up_acr).toBe('Multi_Factor');
  });

  test('explicit hitl object and hitlChallengeId are preferred over defaults', () => {
    const c = classifyMcpToolResult({ error: 'hitl_required', hitl: { type: 'device_picker' }, hitlChallengeId: 'hc-1', message: 'go' });
    expect(c.hitl).toEqual({ type: 'device_picker' });
    expect(c.hitlChallengeId).toBe('hc-1');
    expect(c.message).toBe('go');
  });

  test('hitl_threshold_usd passes through (banking)', () => {
    const c = classifyMcpToolResult({ error: 'hitl_required', hitl_threshold_usd: 500 });
    expect(c.hitl_threshold_usd).toBe(500);
  });

  test('deny → error with human-readable message (error_description preferred)', () => {
    const c = classifyMcpToolResult({ error: 'mcp_authorization_denied', error_description: 'Denied by policy.' });
    expect(c.kind).toBe('error');
    expect(c.error).toBe('mcp_authorization_denied');
    expect(c.message).toBe('Denied by policy.');
  });

  test('deny_reason and message fall-backs for the readable error message', () => {
    expect(classifyMcpToolResult({ error: 'x', deny_reason: 'reason' }).message).toBe('reason');
    expect(classifyMcpToolResult({ error: 'x', message: 'msg' }).message).toBe('msg');
    expect(classifyMcpToolResult({ error: 'bare_code' }).message).toBe('bare_code');
  });
});
