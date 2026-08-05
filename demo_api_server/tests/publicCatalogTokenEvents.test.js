// demo_api_server/tests/publicCatalogTokenEvents.test.js
const { buildPublicCatalogTokenEvents } = require('../services/publicCatalogTokenEvents');

describe('publicCatalogTokenEvents', () => {
  it('returns skipped exchange, skipped authorize, and tool-dispatched for Act 1', () => {
    const events = buildPublicCatalogTokenEvents('get_branch_hours');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.id)).toEqual([
      'token-exchange',
      'authorize-decision',
      'tool-dispatched',
    ]);
    expect(events[0].status).toBe('skipped');
    expect(events[1].status).toBe('skipped');
    expect(events[1].authorizeDecision).toBe('SKIPPED');
    expect(events[1].authorizeEngine).toBe('not-called');
    expect(events[1].publicCatalog).toBe(true);
    expect(events[2].tool).toBe('get_branch_hours');
  });
});
