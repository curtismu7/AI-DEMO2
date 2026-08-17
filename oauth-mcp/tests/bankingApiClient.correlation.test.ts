import { BankingAPIClient } from '../src/banking/BankingAPIClient';
import { runWithCorrelation } from '../src/utils/correlationContext';

/**
 * The MCP server calls back into the BFF (`/api/path/vertical-tool`, `/my`,
 * `/balance`, …) to run the active vertical's tool. Those callbacks carried no
 * correlation header, so the BFF's correlationIdMiddleware minted a fresh id
 * and transactionTurnMiddleware filed the callback's ui.request/response hops
 * under a transaction of their own — an orphan record next to the real chain,
 * which is why /transaction-trace showed two clusters instead of one.
 *
 * The header must be stamped per request (from ALS at call time), not baked
 * into the axios defaults at construction: one client instance serves many
 * tool calls, and a construction-time value would pin every later callback to
 * the first turn's id.
 */
function withCapturedRequest(client: BankingAPIClient) {
  const captured: any[] = [];
  // The axios instance is private; the adapter is the only seam that sees the
  // config AFTER the request interceptors have run.
  (client as any).client.defaults.adapter = async (config: any) => {
    captured.push(config);
    return { data: { ok: true, result: {} }, status: 200, statusText: 'OK', headers: {}, config };
  };
  return captured;
}

describe('BankingAPIClient correlation propagation', () => {
  it('forwards the ambient correlation id as X-Correlation-ID on BFF callbacks', async () => {
    const client = new BankingAPIClient({ baseUrl: 'http://bff.test' });
    const captured = withCapturedRequest(client);

    await runWithCorrelation('turn-abc', async () => {
      await client.callVerticalTool('user-token', 'list_orders', {}, 'retail');
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].headers['X-Correlation-ID']).toBe('turn-abc');
  });

  it('reads the id per request, so a second turn is not pinned to the first', async () => {
    const client = new BankingAPIClient({ baseUrl: 'http://bff.test' });
    const captured = withCapturedRequest(client);

    await runWithCorrelation('turn-1', async () => {
      await client.callVerticalTool('user-token', 'list_orders');
    });
    await runWithCorrelation('turn-2', async () => {
      await client.callVerticalTool('user-token', 'list_orders');
    });

    expect(captured.map((c) => c.headers['X-Correlation-ID'])).toEqual(['turn-1', 'turn-2']);
  });

  it('omits the header entirely when there is no correlation scope', async () => {
    const client = new BankingAPIClient({ baseUrl: 'http://bff.test' });
    const captured = withCapturedRequest(client);

    await client.callVerticalTool('user-token', 'list_orders');

    expect(captured[0].headers['X-Correlation-ID']).toBeUndefined();
  });
});
