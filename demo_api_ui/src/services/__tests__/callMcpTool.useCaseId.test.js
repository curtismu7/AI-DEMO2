import { callMcpTool } from '../demoAgentService';

describe('callMcpTool useCaseId plumbing', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ result: {}, tokenEvents: [] }),
      }),
    );
  });

  test('includes useCaseId in the request body when provided', async () => {
    await callMcpTool('get_balance', {}, { useCaseId: 'delegated-access-with-proof' });
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.useCaseId).toBe('delegated-access-with-proof');
  });

  test('omits useCaseId when not provided (back-compat)', async () => {
    await callMcpTool('get_balance', {});
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.useCaseId).toBeUndefined();
  });
});
