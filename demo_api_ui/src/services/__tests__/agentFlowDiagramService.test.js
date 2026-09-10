import { describe, expect, test } from 'vitest';
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
