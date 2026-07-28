'use strict';

/**
 * /api/agent/run falls back to the local tool catalog when gateway tool
 * discovery fails, and the run continues. The failure's token events must be
 * marked `recovered` so the Token Chain / Simple Stepper halt heuristic does
 * not treat them as the point the chain stopped — which ghosted every later
 * (executed) step as "did not run".
 */

jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));

const { markRecovered } = require('../routes/agentRun').__test;

describe('agentRun — markRecovered', () => {
  test('flags every event so the halt heuristic skips it', () => {
    const events = [
      { id: 'tools-list-failed', label: 'MCP tools/list — Agent Gateway', status: 'failed' },
    ];
    expect(markRecovered(events)).toEqual([
      {
        id: 'tools-list-failed',
        label: 'MCP tools/list — Agent Gateway',
        status: 'failed',
        recovered: true,
      },
    ]);
  });

  test('keeps the failed status — the step is still red, just not the halt', () => {
    const [ev] = markRecovered([{ status: 'failed' }]);
    expect(ev.status).toBe('failed');
    expect(ev.recovered).toBe(true);
  });

  test('does not mutate the input events', () => {
    const input = [{ id: 'a', status: 'failed' }];
    markRecovered(input);
    expect(input[0].recovered).toBeUndefined();
  });

  test('tolerates undefined / empty event lists', () => {
    expect(markRecovered(undefined)).toEqual([]);
    expect(markRecovered([])).toEqual([]);
  });
});
