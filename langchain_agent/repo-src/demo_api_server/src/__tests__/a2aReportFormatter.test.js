/**
 * @file a2aReportFormatter.test.js
 * Slice 5b: reports surface the A2A nested act chain as a readable delegation
 * chain, and mark depth-2 chains as an A2A specialist delegation.
 */

const { formatMarkdown, formatHtml } = require('../../services/reportFormatter');

function runWith(actClaim) {
  return {
    runId: 'r1',
    startedAt: Date.now(),
    vertical: 'banking',
    prompt: 'show my positions',
    success: true,
    tokenCount: 1,
    tokenEvents: [
      {
        id: 'a2a-exchange2',
        label: 'A2A Exchange #2 — nested act',
        status: 'exchanged',
        timestamp: Date.now(),
        actChainDepth: 2,
        claims: { sub: 'user-123', act: actClaim },
      },
    ],
    mcpToolCallsChain: [],
  };
}

describe('reportFormatter — A2A delegation chain surfacing', () => {
  it('renders a depth-2 nested act as a readable A2A delegation chain (markdown)', () => {
    const md = formatMarkdown(runWith({ sub: 'specialist-agent', act: { sub: 'generalist-agent' } }));
    expect(md).toMatch(/\*\*Delegation chain:\*\* user-123 → generalist-agent → specialist-agent/);
    expect(md).toMatch(/A2A specialist delegation \(act depth 2\)/);
  });

  it('renders a depth-1 act without the A2A tag (markdown)', () => {
    const md = formatMarkdown(runWith({ sub: 'generalist-agent' }));
    expect(md).toMatch(/\*\*Delegation chain:\*\* user-123 → generalist-agent/);
    expect(md).not.toMatch(/A2A specialist delegation/);
  });

  it('renders the delegation chain + A2A tag in HTML', () => {
    const html = formatHtml(runWith({ sub: 'specialist-agent', act: { sub: 'generalist-agent' } }));
    expect(html).toMatch(/Delegation chain/);
    expect(html).toMatch(/user-123 → generalist-agent → specialist-agent/);
    expect(html).toMatch(/A2A · depth 2/);
  });

  it('omits the delegation line when there is no act claim', () => {
    const md = formatMarkdown(runWith(undefined));
    expect(md).not.toMatch(/Delegation chain/);
  });
});
