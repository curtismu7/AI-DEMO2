// demo_api_ui/src/components/__tests__/AIAgent.a2aExplain.test.js
import { describe, it, expect } from 'vitest';
import { shouldAutoOpenA2a } from '../a2aAutoOpen';

const okResponse = {
  reply: 'Delegation complete — Investment Advisor retrieved get portfolio summary…',
  tokenEvents: [{ id: 'a2a-exchange2' }],
};
const failResponse = {
  reply: '❌ Delegated to Investment Advisor, but get_portfolio_summary failed: mcp_error.',
  tokenEvents: [{ id: 'a2a-exchange2' }, { id: 'a2a-exchange-failed' }],
};

describe('shouldAutoOpenA2a', () => {
  it('opens on a successful A2A delegation (reply + a2a-exchange2, no failure)', () => {
    expect(shouldAutoOpenA2a(okResponse)).toBe(true);
  });
  it('does not open on a failed delegation', () => {
    expect(shouldAutoOpenA2a(failResponse)).toBe(false);
  });
  it('does not open for a non-A2A response (no a2a-exchange2 event)', () => {
    expect(shouldAutoOpenA2a({ reply: 'Here are your accounts', tokenEvents: [{ id: 'mcp-tool-invoked' }] })).toBe(false);
  });
  it('does not open when the reply is not a completion', () => {
    expect(shouldAutoOpenA2a({ reply: 'Working on it', tokenEvents: [{ id: 'a2a-exchange2' }] })).toBe(false);
  });
  it('does not throw on a null/empty response', () => {
    expect(shouldAutoOpenA2a(null)).toBe(false);
    expect(shouldAutoOpenA2a({})).toBe(false);
  });
});
