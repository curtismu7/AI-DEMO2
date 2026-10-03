import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./appToast', () => ({ notifyError: vi.fn() }));

import { notifyError } from './appToast';
import { showEndUserOAuthErrorToast } from './endUserOAuthErrorToast';

describe('showEndUserOAuthErrorToast', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says PingFederate is not running, not "PingOne returned", when PF is unreachable', () => {
    const q = new URLSearchParams({
      error: 'oauth_provider',
      idp_error: 'pingfederate_unreachable',
      error_description: 'PingFederate is not running or not reachable. Start it, then sign in again.',
    });
    expect(showEndUserOAuthErrorToast(q)).toBe(true);
    const msg = notifyError.mock.calls[0][0];
    expect(msg).toMatch(/PingFederate is not running/);
    expect(msg).not.toMatch(/PingOne returned|pingfederate_unreachable/);
  });

  it('uses the larger attention toast for PF-unreachable only', () => {
    showEndUserOAuthErrorToast(new URLSearchParams({ error: 'oauth_provider', idp_error: 'pingfederate_unreachable' }));
    expect(notifyError.mock.calls[0][1]).toMatchObject({ className: 'toast--attention' });
    showEndUserOAuthErrorToast(new URLSearchParams({ error: 'oauth_provider', idp_error: 'server_error' }));
    expect(notifyError.mock.calls[1][1].className).toBeUndefined();
  });

  it('still reports other IdP errors as returned by PingOne', () => {
    const q = new URLSearchParams({ error: 'oauth_provider', idp_error: 'server_error' });
    showEndUserOAuthErrorToast(q);
    expect(notifyError.mock.calls[0][0]).toMatch(/PingOne returned: server_error/);
  });
});
