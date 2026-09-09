// The Authorize node's verdict.
//
// `||` binds tighter than `?:`, so
//     dec?.outcome || azStep.status === 'error' ? 'DENY' : 'PERMIT'
// parsed as (outcome || isError) ? 'DENY' : 'PERMIT' — ANY recorded decision,
// PERMIT included, rendered as a red DENY, and only a run with no decision at
// all showed PERMIT. Exactly backwards, on the Token Chain panel's Diagram tab.
import { describe, it, expect } from 'vitest';
import { buildDiagramSource } from '../TokenExchangeDiagram';

const traceWith = (over = {}) => ({ startedAt: 1, tokenEvents: [{ id: 'user-token', claims: {} }], ...over });
const azSteps = (outcome, status = 'done') => [
  { id: 'signin', status: 'done' },
  { id: 'authorize', status, detail: { decision: { outcome, label: `${outcome} — pingone` } } },
];

describe('buildDiagramSource — Authorize verdict', () => {
  it('renders a PERMIT as PERMIT (the precedence regression)', () => {
    const src = buildDiagramSource(traceWith({ outcome: 'ok' }), azSteps('PERMIT'));
    expect(src).toContain('PERMIT');
    expect(src).not.toContain('DENY');
  });

  it('still renders a real DENY as DENY', () => {
    const src = buildDiagramSource(traceWith({ outcome: 'error' }), azSteps('DENY', 'error'));
    expect(src).toContain('DENY');
  });

  it('renders an approval gate as HELD, not DENY', () => {
    const trace = traceWith({
      outcome: 'error',
      authorize: { decision: 'INDETERMINATE', outcome: 'STEP_UP' },
      mcpResult: { tool: 'extend_rental', status: 'error', error: 'mcp_step_up_required' },
    });
    const src = buildDiagramSource(trace, azSteps('INDETERMINATE', 'active'));
    expect(src).toContain('HELD');
    expect(src).not.toContain('DENY');
  });

  it('does not call an unreachable PDP a policy DENY', () => {
    // authorize_unavailable collapses to status 'error' with the decision left
    // NOT_RECORDED. That is an availability failure, not a refusal.
    const src = buildDiagramSource(traceWith({ outcome: 'error' }), azSteps('NOT_RECORDED', 'error'));
    expect(src).not.toContain('DENY');
    expect(src).toContain('NOT_RECORDED');
  });

  it('never fabricates a verdict when no decision was recorded', () => {
    const src = buildDiagramSource(traceWith({ outcome: 'ok' }), azSteps('NOT_RECORDED'));
    expect(src).toContain('NOT_RECORDED');
    expect(src).not.toContain('PERMIT');
    expect(src).not.toContain('DENY');
  });
});
