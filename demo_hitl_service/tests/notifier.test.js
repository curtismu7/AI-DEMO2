'use strict';

// Bug: HITL_NOTIFY_MODE=ciba with PINGONE_CIBA_ENDPOINT/HITL_CLIENT_ID unset warns
// "falling back to log" but never actually emits the log-mode notification —
// the challenge silently sits with no diagnostic trail. This covers the fix:
// the CIBA-misconfiguration branch must actually fall back to the same
// log-mode notification notifyUser() emits when HITL_NOTIFY_MODE=log.

jest.mock('../src/teachLogger', () => ({
  teachLog: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('notifier — ciba misconfiguration fallback', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('emits the log-mode notification (with approvalUrl) when ciba endpoint/client-id are missing', async () => {
    process.env.HITL_NOTIFY_MODE = 'ciba';
    delete process.env.PINGONE_CIBA_ENDPOINT;
    delete process.env.HITL_CLIENT_ID;
    process.env.HITL_DASHBOARD_URL = 'http://localhost:3000/dashboard/approve';

    // Require fresh after resetModules — the mocked teachLogger factory
    // re-runs too, so grab the instance notifier.js actually binds to.
    const { teachLog } = require('../src/teachLogger');
    const { notifyUser } = require('../src/notifier');
    const challenge = { id: 'c-1', tool: 'transferFunds' };

    await notifyUser(challenge, 'user@example.com');

    // Operator-facing misconfiguration warning still fires.
    expect(teachLog.warn).toHaveBeenCalledWith(
      'ciba not configured — falling back to log',
      expect.objectContaining({ challengeId: 'c-1', userEmail: 'user@example.com' }),
    );

    // It must ALSO actually emit the log-mode notification it claims to fall back to.
    expect(teachLog.info).toHaveBeenCalledWith(
      'approval needed',
      expect.objectContaining({
        challengeId: 'c-1',
        tool: 'transferFunds',
        userEmail: 'user@example.com',
        approvalUrl: 'http://localhost:3000/dashboard/approve?challengeId=c-1',
      }),
    );
  });

  it('does not throw, so the caller-side .catch() cannot mask the missing signal further', async () => {
    process.env.HITL_NOTIFY_MODE = 'ciba';
    delete process.env.PINGONE_CIBA_ENDPOINT;
    delete process.env.HITL_CLIENT_ID;

    const { notifyUser } = require('../src/notifier');
    await expect(notifyUser({ id: 'c-2', tool: 'transferFunds' }, 'user@example.com')).resolves.toBeUndefined();
  });
});
