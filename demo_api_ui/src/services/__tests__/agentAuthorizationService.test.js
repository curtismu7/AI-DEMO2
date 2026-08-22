import { getAgentAuthStatus } from '../agentAuthorizationService';

describe('agentAuthorizationService.getAgentAuthStatus', () => {
  afterEach(() => { delete global.fetch; });

  it('resolves with the parsed status on a 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authorized: true, enforced: false }),
    });
    await expect(getAgentAuthStatus()).resolves.toEqual({ authorized: true, enforced: false });
  });

  it('throws instead of resolving a JSON error body when the server rejects the request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    });
    await expect(getAgentAuthStatus()).rejects.toThrow('401');
  });
});
