import { governanceFrom } from '../dotGovernance';

test('reads the Authorize verdict and the tools from an invoke response', () => {
  expect(governanceFrom({ mcpAuthorizeEvaluation: { decision: 'permit' }, toolsCalled: ['get_miles_balance', { name: 'book_flight' }] }))
    .toEqual({ decision: 'PERMIT', tools: ['get_miles_balance', 'book_flight'] });
  expect(governanceFrom({ mcpAuthorizeEvaluation: { decision: 'DENY' } })).toEqual({ decision: 'DENY', tools: [] });
});

test('says nothing when there is no verdict', () => {
  expect(governanceFrom({ reply: 'hi', toolsCalled: ['x'] })).toBeUndefined();
  expect(governanceFrom({ mcpAuthorizeEvaluation: { decision: 'MAYBE' } })).toBeUndefined();
  expect(governanceFrom(null)).toBeUndefined();
});

// The shape the live server returned for "check my miles" (2026-10-15): the server skips its own check because the
// gateway is authoritative, and the verdict is in the gateway's token events.
test('reads the gateway verdict when the server skipped its own check', () => {
  const live = {
    toolsCalled: ['get_loyalty_status'],
    mcpAuthorizeEvaluation: { ran: false, skipped: true, skipReason: 'gateway_authoritative' },
    tokenEvents: [{ id: 'user-token', status: 'active' }, { id: 'gw-authorize', status: 'permit' }, { id: 'gw-authorize', status: 'permit' }],
  };
  expect(governanceFrom(live)).toEqual({ decision: 'PERMIT', tools: ['get_loyalty_status'] });
});

test('the worst gateway decision in a run is the run\'s verdict', () => {
  const ev = (status) => ({ id: 'gw-authorize', status });
  expect(governanceFrom({ tokenEvents: [ev('permit'), ev('deny')] }).decision).toBe('DENY');
  expect(governanceFrom({ tokenEvents: [ev('permit'), ev('indeterminate')] }).decision).toBe('INDETERMINATE');
  // the server's own decision is only the fallback
  expect(governanceFrom({ mcpAuthorizeEvaluation: { decision: 'DENY' }, tokenEvents: [ev('permit')] }).decision).toBe('PERMIT');
});

