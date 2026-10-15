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
