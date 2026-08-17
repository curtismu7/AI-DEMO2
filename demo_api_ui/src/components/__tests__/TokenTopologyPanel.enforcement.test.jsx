// Pure helpers behind the topology pop-out's enforcement callouts, object
// badges, edge labels and tool-call branch.
import { describe, it, expect } from 'vitest';
import {
  enforcementFor,
  edgeLabel,
  partitionSpineBranch,
  buildObservedTopology,
  isUnfired,
} from '../TokenTopologyPanel';
import {
  MCP_STEP_IDS,
  buildTraceSteps,
} from '../../services/tokenChainTrace/buildTraceSteps';

const node = (id, extra = {}) => ({
  id,
  lane: extra.lane || 'BFF',
  step: { id, status: 'done', ...extra.step },
});

describe('enforcementFor', () => {
  it('returns null for a hop that is not a control point', () => {
    expect(enforcementFor({ id: 'prompt', status: 'done' })).toBeNull();
    expect(enforcementFor(null)).toBeNull();
  });

  it('names the verb and guarded object for a control point', () => {
    expect(enforcementFor({ id: 'gateway', status: 'done' })).toMatchObject({
      verb: 'Block',
      what: 'Untrusted or mis-scoped tokens',
      object: 'token',
    });
  });

  it('resolves the spec through baseId for a repeated step', () => {
    expect(enforcementFor({ id: 'exchange#2', baseId: 'exchange', status: 'done' }))
      .toMatchObject({ object: 'token', verb: 'Control' });
  });

  it('is deny when the step errored', () => {
    expect(enforcementFor({ id: 'gateway', status: 'error' }).state).toBe('deny');
  });

  it('is deny when the decision says DENY even though the step completed', () => {
    const step = { id: 'authorize', status: 'done', detail: { decision: { outcome: 'DENY' } } };
    expect(enforcementFor(step).state).toBe('deny');
  });

  it('is permit on a PERMIT decision', () => {
    const step = { id: 'authorize', status: 'done', detail: { decision: { outcome: 'PERMIT' } } };
    expect(enforcementFor(step).state).toBe('permit');
  });

  it('is live while the hop is still running', () => {
    expect(enforcementFor({ id: 'mcp', status: 'active' }).state).toBe('live');
  });

  it('is idle for a completed hop that carried no decision', () => {
    expect(enforcementFor({ id: 'mcp', status: 'done' }).state).toBe('idle');
  });

  it('paints both MCP 401 challenge legs as a block that fired', () => {
    for (const id of ['tools-list-challenge', 'tools-call-challenge']) {
      const step = { id, status: 'done', detail: { decision: { outcome: 'DENY' } } };
      expect(enforcementFor(step)).toMatchObject({
        verb: 'Block',
        what: 'Callers with no credential',
        object: 'token',
        state: 'deny',
      });
    }
  });
});

describe('edgeLabel', () => {
  it('uppercases the downstream lane', () => {
    expect(edgeLabel({ lane: 'authz' })).toBe('AUTHZ');
  });

  it('returns null when there is no lane', () => {
    expect(edgeLabel({})).toBeNull();
    expect(edgeLabel(null)).toBeNull();
  });
});

describe('partitionSpineBranch', () => {
  it('moves every MCP step onto the branch and keeps the rest on the spine', () => {
    const nodes = [
      node('prompt'), node('authorize'),
      ...MCP_STEP_IDS.map((id) => node(id)),
      node('reply'),
    ];
    const { spine, branch } = partitionSpineBranch(nodes);
    expect(branch.map((n) => n.id)).toEqual(MCP_STEP_IDS);
    expect(spine.map((n) => n.id)).toEqual(['prompt', 'authorize', 'reply']);
  });

  it('anchors the branch to the spine node immediately before the first MCP step', () => {
    const nodes = [node('prompt'), node('authorize'), node('gateway'), node('mcp')];
    expect(partitionSpineBranch(nodes).anchorId).toBe('authorize');
  });

  it('resolves branch membership through baseId', () => {
    const nodes = [node('prompt'), node('mcp#2', { step: { baseId: 'mcp' } })];
    const { branch, spine } = partitionSpineBranch(nodes);
    expect(branch.map((n) => n.id)).toEqual(['mcp#2']);
    expect(spine.map((n) => n.id)).toEqual(['prompt']);
  });

  it('returns an empty branch and no anchor when no MCP step ran', () => {
    const { spine, branch, anchorId } = partitionSpineBranch([node('prompt'), node('reply')]);
    expect(branch).toEqual([]);
    expect(spine).toHaveLength(2);
    expect(anchorId).toBeNull();
  });

  it('tolerates a non-array input', () => {
    expect(partitionSpineBranch(undefined)).toEqual({ spine: [], branch: [], anchorId: null });
  });
});

describe('buildObservedTopology — unfired hops', () => {
  const steps = [
    { id: 'prompt', title: 'Chatbot — prompt sent', lane: 'CHAT', status: 'done' },
    { id: 'stepup', title: 'Step-up required', lane: 'AUTHZ', status: 'notinpath' },
    { id: 'gateway', title: 'Agent Gateway', lane: 'GATEWAY', status: 'pending' },
    { id: 'mcp', title: 'MCP server', lane: 'MCP', status: 'done' },
  ];

  it('keeps pending and notinpath hops instead of dropping them', () => {
    expect(buildObservedTopology(steps).map((n) => n.id))
      .toEqual(['prompt', 'stepup', 'gateway', 'mcp']);
  });

  it('flags exactly the hops that never fired', () => {
    expect(steps.filter(isUnfired).map((s) => s.id)).toEqual(['stepup', 'gateway']);
    expect(isUnfired({ status: 'done' })).toBe(false);
    expect(isUnfired({ status: 'error' })).toBe(false);
    expect(isUnfired({ status: 'active' })).toBe(false);
  });

  it('still reports an unfired control point so its callout can render', () => {
    expect(enforcementFor({ id: 'stepup', status: 'notinpath' })).toMatchObject({
      verb: 'Check',
      state: 'idle',
    });
  });
});

describe('tools/list discovery step', () => {
  // recordTokenEvent() stamps `type`, not `id` — the reason these events were
  // previously carried to the browser and never rendered.
  const traceWith = (tokenEvents, extra = {}) => buildTraceSteps({
    prompt: { message: 'hi' }, tokenEvents, phases: [], ...extra,
  });
  const toolsStep = (trace) => trace.find((s) => s.id === 'tools-list');

  it('is present in the chain', () => {
    expect(toolsStep(traceWith([]))).toBeDefined();
  });

  it('is done and reports the policy filtering counts on success', () => {
    const step = toolsStep(traceWith([
      { type: 'tools_list_success', permittedCount: 6, deniedCount: 2, vertical: 'banking' },
    ]));
    expect(step.status).toBe('done');
    expect(step.detail.kv).toEqual(expect.arrayContaining([
      ['tools permitted', '6'],
      ['filtered by policy', '2'],
    ]));
  });

  it('is error when discovery failed', () => {
    expect(toolsStep(traceWith([{ type: 'tools_list_failed', message: 'boom' }])).status)
      .toBe('error');
  });

  it('is done but names the local catalog when the gateway was unreachable', () => {
    const step = toolsStep(traceWith([
      { type: 'tools_list_fallback', reason: 'gateway_unreachable' },
    ]));
    expect(step.status).toBe('done');
    expect(JSON.stringify(step.detail.kv)).toContain('gateway_unreachable');
  });

  it('is notinpath once the run finished with no discovery evidence', () => {
    expect(toolsStep(traceWith([], { outcome: 'ok' })).status).toBe('notinpath');
  });

  it('is pending while the run is still going and nothing arrived yet', () => {
    expect(toolsStep(traceWith([])).status).toBe('pending');
  });
});
