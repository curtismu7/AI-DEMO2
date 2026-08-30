/**
 * Two bugs seen together on /pingone-authorize while signed out:
 *
 *   1. the interrupt said "Your session has expired" to a visitor who never had
 *      a session — the copy was hardcoded at the dispatch site while
 *      AUTH_REQUIRED_CODES covers both "lapsed" and "never signed in";
 *   2. the page's own inline SignInPrompt card AND the global SignInModal
 *      interrupt rendered at the same time. They are documented siblings and
 *      are meant to be mutually exclusive.
 *
 * Both guards are written to go RED if the fix is reverted — see the comments
 * on each, since a "does not throw" assertion here would pass either way.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  interruptMessageForAuthFailure,
  notifySessionExpiredIfNeeded,
  _resetSessionExpiryNotifyForTests,
  SESSION_EXPIRED_INTERRUPT_MESSAGE,
  SIGN_IN_REQUIRED_INTERRUPT_MESSAGE,
  SESSION_REAUTH_EVENT,
} from '../utils/authUi';

describe('the interrupt says which of the two auth failures happened', () => {
  // Reverting to a hardcoded SESSION_EXPIRED_INTERRUPT_MESSAGE fails the first
  // two rows: they assert the never-signed-in wording specifically.
  it.each([
    ['login_required', SIGN_IN_REQUIRED_INTERRUPT_MESSAGE],
    ['authentication_required', SIGN_IN_REQUIRED_INTERRUPT_MESSAGE],
    ['session_expired', SESSION_EXPIRED_INTERRUPT_MESSAGE],
    ['expired_token', SESSION_EXPIRED_INTERRUPT_MESSAGE],
    ['token_inactive', SESSION_EXPIRED_INTERRUPT_MESSAGE],
  ])('%s -> the right sentence', (code, expected) => {
    expect(interruptMessageForAuthFailure({ error: code })).toBe(expected);
  });

  it('reads `code` as well as `error` — endpoints use both', () => {
    expect(interruptMessageForAuthFailure({ code: 'login_required' }))
      .toBe(SIGN_IN_REQUIRED_INTERRUPT_MESSAGE);
  });

  it('falls back to the expiry wording when the body says nothing useful', () => {
    // The long-standing behaviour, kept deliberately: an unknown or absent code
    // must not start claiming the user was never signed in.
    for (const body of [undefined, null, {}, { error: 'something_else' }]) {
      expect(interruptMessageForAuthFailure(body)).toBe(SESSION_EXPIRED_INTERRUPT_MESSAGE);
    }
  });

  it('never says "expired" to a visitor who was never signed in', () => {
    // The user-visible bug, stated as its own assertion.
    expect(interruptMessageForAuthFailure({ error: 'authentication_required' }))
      .not.toMatch(/expired/i);
  });
});

describe('the dispatched event carries the chosen sentence', () => {
  beforeEach(() => {
    _resetSessionExpiryNotifyForTests();
    window.history.pushState({}, '', '/pingone-authorize');
  });

  it('emits the never-signed-in wording for a login_required 401', () => {
    const seen = vi.fn();
    window.addEventListener(SESSION_REAUTH_EVENT, seen);
    notifySessionExpiredIfNeeded({ status: 401, body: { error: 'login_required' } });
    window.removeEventListener(SESSION_REAUTH_EVENT, seen);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].detail.message).toBe(SIGN_IN_REQUIRED_INTERRUPT_MESSAGE);
  });

  it('still emits the expiry wording for a genuine expiry', () => {
    const seen = vi.fn();
    window.addEventListener(SESSION_REAUTH_EVENT, seen);
    notifySessionExpiredIfNeeded({ status: 401, body: { error: 'session_expired' } });
    window.removeEventListener(SESSION_REAUTH_EVENT, seen);

    expect(seen.mock.calls[0][0].detail.message).toBe(SESSION_EXPIRED_INTERRUPT_MESSAGE);
  });
});

describe('bffAxios honours _noAuthBanner, so a page can answer its own 401', () => {
  // Why this is the seam: the inline prompt is rendered FROM the 401
  // (setNeedsLogin(true) in the catch), so it does not exist yet when the
  // interceptor runs. Anything keyed on the prompt being mounted is asked too
  // early. The request itself is the only race-free place to say "mine".
  const load = async () => {
    vi.resetModules();
    const notify = vi.fn();
    vi.doMock('../utils/authUi', () => ({
      notifySessionExpiredIfNeeded: notify,
    }));
    vi.doMock('../utils/resolveApiBaseUrl', () => ({ resolveApiBaseUrl: () => '' }));
    const mod = await import('../services/bffAxios');
    return { notify, bffAxios: mod.default };
  };

  /** Drive the response interceptor directly with a 401 shaped like axios's. */
  const reject = async (bffAxios, config) => {
    const handler = bffAxios.interceptors.response.handlers.find((h) => h && h.rejected);
    const err = { response: { status: 401, data: { error: 'login_required' } }, config };
    await expect(handler.rejected(err)).rejects.toBe(err);
  };

  it('fires the interrupt for an ordinary 401', async () => {
    const { notify, bffAxios } = await load();
    await reject(bffAxios, { url: '/api/whatever' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the caller opted out', async () => {
    // Deleting the `!error.config?._noAuthBanner` guard makes THIS fail.
    const { notify, bffAxios } = await load();
    await reject(bffAxios, { url: '/api/authorize/pingone-policies', _noAuthBanner: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it('still fires when the flag is absent or false — opt-out is explicit only', async () => {
    const { notify, bffAxios } = await load();
    await reject(bffAxios, { url: '/api/x', _noAuthBanner: false });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
