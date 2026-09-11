import { beforeEach, describe, expect, test } from 'vitest';
import { agentFlowDiagram } from '../agentFlowDiagramService';

describe('agentFlowDiagram.showLoginFlow', () => {
  test('populates the steps, all marked done, without forcing the panel open', () => {
    agentFlowDiagram.close(); // baseline: panel starts closed, same as any page load

    agentFlowDiagram.showLoginFlow([
      { title: 'You click "Sign in"', detail: 'd1', actor: 'browser', toActor: 'bff' },
      { title: 'BFF mints PKCE', detail: 'd2', actor: 'bff', protocolDetail: [['code_verifier', 'server-side']] },
    ]);

    const snap = agentFlowDiagram.getState();

    expect(snap.visible).toBe(false); // Quick Config toggle opens it — login must not auto-open
    expect(snap.phase).toBe('done');
    expect(snap.steps).toHaveLength(2);
    expect(snap.steps[0]).toMatchObject({
      title: 'You click "Sign in"',
      status: 'done',
      actor: 'browser',
      toActor: 'bff',
    });
    expect(snap.steps[1].protocolDetail).toEqual([['code_verifier', 'server-side']]);
  });
});

// A typed prompt in an LLM mode runs through AG-UI (/api/agent/run), which never
// calls startMcpToolCall/completeMcpToolCall — the only input is the BFF pipeline's
// phase events over SSE (useAgentRun → applyServerEvent) plus the run's finish.
describe('agentFlowDiagram — typed (AG-UI) run fills the step rail', () => {
  const statusById = () =>
    Object.fromEntries(agentFlowDiagram.getState().steps.map((s) => [s.id, s.status]));

  beforeEach(() => {
    agentFlowDiagram.reset();
  });

  test('prompt, each pipeline hop and the reply appear live, with swimlane actors', () => {
    agentFlowDiagram.startLlmReasoning('show my balance');
    let snap = agentFlowDiagram.getState();
    expect(snap.steps.map((s) => s.id)).toEqual(['prompt', 'reply']);
    expect(snap.steps[0]).toMatchObject({
      detail: 'show my balance',
      status: 'done',
      actor: 'browser',
      toActor: 'bff',
    });

    // First event every pipeline run emits — carries the tool name on the AG-UI path.
    agentFlowDiagram.applyServerEvent({ phase: 'resolving_access_token', tool: 'get_account_balance' });
    snap = agentFlowDiagram.getState();
    expect(snap.phase).toBe('running');
    expect(snap.toolName).toBe('get_account_balance');
    expect(snap.steps.map((s) => s.id)).toEqual([
      'prompt', 'as', 'agent', 'bff', 'mcp-gateway', 'pingauthorize', 'mcp', 'tool', 'reply',
    ]);
    expect(snap.steps.every((s) => s.actor)).toBe(true);

    ['access_token_ready', 'authorize_permitted', 'mcp_remote_begin', 'mcp_remote_done'].forEach((phase) =>
      agentFlowDiagram.applyServerEvent({ phase, tool: 'get_account_balance' }));
    expect(statusById()).toMatchObject({
      bff: 'done',
      'mcp-gateway': 'done',
      pingauthorize: 'done',
      mcp: 'done',
      tool: 'done',
      reply: 'pending',
    });

    agentFlowDiagram.completeReply(true);
    snap = agentFlowDiagram.getState();
    expect(snap.steps.at(-1)).toMatchObject({ id: 'reply', status: 'done', actor: 'bff', toActor: 'browser' });
    expect(snap.phase).toBe('done');
  });

  test('an authorize denial marks PingOne Authorize as the failing hop', () => {
    agentFlowDiagram.startLlmReasoning('transfer 5000 to savings');
    agentFlowDiagram.applyServerEvent({ phase: 'resolving_access_token', tool: 'create_transfer' });
    agentFlowDiagram.applyServerEvent({ phase: 'authorize_denied', tool: 'create_transfer', status: 403 });
    expect(statusById().pingauthorize).toBe('error');
  });

  test('a chip call already in progress is not reset by its own pipeline event', () => {
    agentFlowDiagram.startMcpToolCall('get_my_accounts');
    agentFlowDiagram.applyServerEvent({ phase: 'access_token_ready', tool: 'get_my_accounts' });
    // A duplicate start event for the same running tool must not wipe progress.
    agentFlowDiagram.applyServerEvent({ phase: 'resolving_access_token', tool: 'get_my_accounts' });
    expect(statusById().bff).toBe('done');
  });

  test('a failed run marks the reply as an error', () => {
    agentFlowDiagram.startLlmReasoning('show my balance');
    agentFlowDiagram.completeReply(false);
    expect(statusById().reply).toBe('error');
    expect(agentFlowDiagram.getState().phase).toBe('error');
  });

  // The heuristics path settles the reply when its answer is shown — after a
  // failed tool call already marked it error. That later "answered" must not
  // turn a failed run green.
  test('settling never overwrites a reply that is already settled', () => {
    agentFlowDiagram.startLlmReasoning('show my balance');
    agentFlowDiagram.completeReply(false);
    agentFlowDiagram.completeReply(true);
    expect(statusById().reply).toBe('error');
    expect(agentFlowDiagram.getState().phase).toBe('error');
  });

  test('settling with no reply step leaves the panel untouched', () => {
    agentFlowDiagram.completeReply(true);
    expect(agentFlowDiagram.getState().steps).toEqual([]);
    expect(agentFlowDiagram.getState().phase).toBe('idle');
  });
});
