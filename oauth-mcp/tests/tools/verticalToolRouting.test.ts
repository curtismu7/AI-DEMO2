/**
 * The vertical action-tool relay must forward the tool's OWN vertical to the BFF
 * so /api/path/vertical-tool runs that vertical's agent regardless of the
 * caller's selected vertical (the Privilege MCP client page is vertical-agnostic).
 */
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';

describe('BankingAPIClient.callVerticalTool — vertical hint', () => {
  function client(): { c: BankingAPIClient; calls: any[] } {
    const c = new BankingAPIClient({ baseUrl: 'http://bff.test' } as any);
    const calls: any[] = [];
    // Intercept the one network primitive; assert the request body.
    (c as any).makeAuthenticatedRequest = async (method: string, path: string, _token: string, body: unknown) => {
      calls.push({ method, path, body });
      return { data: { ok: true, result: {}, render: 'text' } };
    };
    return { c, calls };
  }

  it('includes the tool vertical in the request body when provided', async () => {
    const { c, calls } = client();
    await c.callVerticalTool('tok', 'list_orders', { q: 'x' }, 'retail');
    expect(calls[0].path).toBe('/api/path/vertical-tool');
    expect(calls[0].body).toEqual({ name: 'list_orders', args: { q: 'x' }, vertical: 'retail' });
  });

  it('omits the vertical key when not provided (back-compat)', async () => {
    const { c, calls } = client();
    await c.callVerticalTool('tok', 'view_benefits', {});
    expect(calls[0].body).toEqual({ name: 'view_benefits', args: {} });
    expect('vertical' in calls[0].body).toBe(false);
  });
});
