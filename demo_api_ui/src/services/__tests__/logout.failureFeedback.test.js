// demo_api_ui/src/services/__tests__/logout.failureFeedback.test.js
// finding #64: performLogout()'s catch swallowed any fetch failure and
// navigated to '/' exactly as it would on success, giving no indication
// the BFF session cookie was never actually cleared.
import { performLogout } from '../logout.js';
import { notifyError } from '../../utils/appToast';

vi.mock('../../utils/nrLog', () => ({ nrLog: vi.fn() }));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn() }));

const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  delete window.location;
  window.location = { ...originalLocation, href: 'https://app.example/dashboard' };
});

afterEach(() => {
  window.location = originalLocation;
});

test('finding #64: notifies the user and does not navigate away when the logout fetch fails', async () => {
  const startingHref = window.location.href;
  global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

  performLogout();
  // Let the fetch rejection's .catch() microtask settle.
  await new Promise((r) => setTimeout(r, 0));

  expect(notifyError).toHaveBeenCalledWith('Logout failed — please try again.');
  // The bug this guards: navigating to '/' on failure looks identical to a
  // successful logout while the session cookie is still valid.
  expect(window.location.href).toBe(startingHref);
});

test('navigates to the returned logoutUrl on success (unchanged behavior)', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ logoutUrl: 'https://auth.pingone.com/signoff' }),
  });

  performLogout();
  await new Promise((r) => setTimeout(r, 0));

  expect(window.location.href).toBe('https://auth.pingone.com/signoff');
  expect(notifyError).not.toHaveBeenCalled();
});
