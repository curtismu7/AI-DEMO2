import { toastAdminSessionError, toastCustomerError } from '../dashboardToast';
import { SESSION_REAUTH_EVENT } from '../authUi';

/**
 * These 14 call sites used to fire a toast that told the user to sign in and
 * then gave them nothing to click before auto-dismissing. They must now raise
 * the shared sign-in interrupt instead.
 */
describe('dashboardToast raises the sign-in interrupt', () => {
  let handler;

  beforeEach(() => {
    handler = jest.fn();
    window.addEventListener(SESSION_REAUTH_EVENT, handler);
  });

  afterEach(() => {
    window.removeEventListener(SESSION_REAUTH_EVENT, handler);
  });

  it('dispatches an admin interrupt with the message', () => {
    toastAdminSessionError('Your session has expired. Sign in again to continue.');

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.role).toBe('admin');
    expect(detail.invalidateSession).toBe(true);
    expect(detail.message).toMatch(/sign in again/i);
  });

  it('dispatches a customer interrupt', () => {
    toastCustomerError('Session could not be restored after sign-in.');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.role).toBe('customer');
  });

  it('stays silent on an empty message', () => {
    toastAdminSessionError('');
    toastAdminSessionError(null);

    expect(handler).not.toHaveBeenCalled();
  });
});
