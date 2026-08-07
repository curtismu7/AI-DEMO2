'use strict';

const mockStartSegment = jest.fn((name, record, fn) => fn());

jest.mock('newrelic', () => ({
  startSegment: mockStartSegment,
}), { virtual: true });

const newrelic = require('newrelic');
const nrSegments = require('../services/nrSegments');

beforeEach(() => {
  mockStartSegment.mockClear();
  mockStartSegment.mockImplementation((name, record, fn) => fn());
});

describe('nrSegments.startSegment', () => {
  test('calls newrelic.startSegment with given name', async () => {
    const result = await nrSegments.startSegment('Test/Span', () => 42);
    expect(newrelic.startSegment).toHaveBeenCalledWith('Test/Span', true, expect.any(Function));
    expect(result).toBe(42);
  });

  test('still calls fn and returns result when newrelic throws', async () => {
    newrelic.startSegment.mockImplementationOnce(() => { throw new Error('agent gone'); });
    const result = await nrSegments.startSegment('Test/Span', () => 99);
    expect(result).toBe(99);
  });
});

describe('nrSegments named helpers', () => {
  const HELPERS = [
    ['pingOneAuthenticate',  'PingOne/Authenticate'],
    ['tokenExchangeSubject', 'TokenExchange/SubjectToken'],
    ['tokenExchangeActor',   'TokenExchange/ActorToken'],
    ['mcpToolCall',          'MCP/ToolCall'],
    ['p1azAuthorize',        'P1AZ/Authorize'],
    ['hitlRequest',          'HITL/RequestApproval'],
    ['hitlAwait',            'HITL/AwaitDecision'],
    ['attackSimVerdict',     'AttackSim/Verdict'],
  ];

  test.each(HELPERS)('%s uses segment name "%s"', async (helper, segName) => {
    await nrSegments[helper](() => 'ok');
    expect(newrelic.startSegment).toHaveBeenCalledWith(segName, true, expect.any(Function));
  });
});
