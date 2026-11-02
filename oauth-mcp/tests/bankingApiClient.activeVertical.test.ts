import { BankingAPIClient } from '../src/banking/BankingAPIClient';
import { runWithCorrelation, activeVerticalFrom, getActiveVertical } from '../src/utils/correlationContext';

/**
 * get_my_accounts calls the BFF's /api/accounts/my with only the user's token.
 * With no session on that call, the BFF took its process-wide vertical as the
 * caller's and switched the user's accounts to it: a session on banking whose
 * agent read balances came back with another vertical's accounts. The BFF
 * stamps the session's vertical as X-Active-Vertical on the MCP request; this
 * server must carry it onto its own BFF calls.
 */
function withCapturedRequest(client: BankingAPIClient) {
  const captured: any[] = [];
  (client as any).client.defaults.adapter = async (config: any) => {
    captured.push(config);
    return { data: { accounts: [] }, status: 200, statusText: 'OK', headers: {}, config };
  };
  return captured;
}

describe('BankingAPIClient active-vertical propagation', () => {
  it('forwards the request\'s vertical as X-Active-Vertical on BFF calls', async () => {
    const client = new BankingAPIClient({ baseUrl: 'http://bff.test' });
    const captured = withCapturedRequest(client);
    await runWithCorrelation('turn-1', async () => {
      await client.getMyAccounts('user-token');
    }, { activeVertical: 'banking' });
    expect(captured[0].headers['X-Active-Vertical']).toBe('banking');
  });

  it('sends no header when the request carried no vertical', async () => {
    const client = new BankingAPIClient({ baseUrl: 'http://bff.test' });
    const captured = withCapturedRequest(client);
    await runWithCorrelation('turn-1', async () => {
      await client.getMyAccounts('user-token');
    });
    await client.getMyAccounts('user-token');
    expect(captured.map((config) => config.headers['X-Active-Vertical'])).toEqual([undefined, undefined]);
  });
});

describe('activeVerticalFrom', () => {
  it('accepts a well-formed vertical id and rejects anything else', () => {
    expect(activeVerticalFrom('banking')).toBe('banking');
    expect(activeVerticalFrom(['sporting-goods'])).toBe('sporting-goods');
    expect(activeVerticalFrom('Banking')).toBeUndefined();
    expect(activeVerticalFrom('banking\r\nX-Evil: 1')).toBeUndefined();
    expect(activeVerticalFrom(undefined)).toBeUndefined();
  });

  it('is scoped to its request', async () => {
    await runWithCorrelation('a', async () => { expect(getActiveVertical()).toBe('retail'); }, { activeVertical: 'retail' });
    expect(getActiveVertical()).toBeUndefined();
  });
});
