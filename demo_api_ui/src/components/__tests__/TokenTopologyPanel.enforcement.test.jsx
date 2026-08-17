// Pure helpers behind the topology pop-out's enforcement callouts, object
// badges, edge labels and tool-call branch.
import { describe, it, expect } from 'vitest';
import {
  enforcementFor,
  edgeLabel,
  partitionSpineBranch,
} from '../TokenTopologyPanel';
import { MCP_STEP_IDS } from '../../services/tokenChainTrace/buildTraceSteps';

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
