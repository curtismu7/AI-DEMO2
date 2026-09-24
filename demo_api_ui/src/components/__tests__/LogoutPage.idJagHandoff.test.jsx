import { render, waitFor } from '@testing-library/react';
import LogoutPage from '../LogoutPage';
import bffAxios from '../../services/bffAxios';
import { ID_JAG_PENDING_INTENT_KEY } from '../../utils/idJagRunMode';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../services/bffAxios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const originalLocation = window.location;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  delete window.location;
  window.location = { pathname: '/logout', href: 'https://local.ping-devops.com:4000/logout' };
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
  bffAxios.post.mockResolvedValue({ data: { ok: true } });
});
afterEach(() => { window.location = originalLocation; });

test('verified logout continuation clears old session and opens PF login once', async () => {
  bffAxios.get.mockResolvedValue({ data: { pending: true, mode: 'live-id-jag', returnTo: '/pingfederate-id-jag/demo' } });
  render(<LogoutPage />);
  await waitFor(() => expect(window.location.href).toContain('/api/auth/oauth/user/login?'));
  expect(window.location.href).toContain('mode=live-id-jag');
  expect(window.location.href).toContain('return_to=%2Fpingfederate-id-jag%2Fdemo');
  expect(bffAxios.post).toHaveBeenCalledWith('/api/auth/clear-session');
  expect(navigate).not.toHaveBeenCalled();
});

test('normal logout retains the existing return destination', async () => {
  sessionStorage.setItem('logoutReturnTo', '/dashboard');
  bffAxios.get.mockResolvedValue({ data: { pending: false } });
  render(<LogoutPage />);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
  expect(bffAxios.post).toHaveBeenCalledWith('/api/auth/clear-session');
});

test('a pending-status transport failure still follows the saved live PF handoff', async () => {
  sessionStorage.setItem(ID_JAG_PENDING_INTENT_KEY, JSON.stringify({
    useCaseId: 'enterprise-managed-mcp-authorization',
    mode: 'live-id-jag',
    message: 'show my balance',
    returnTo: '/dashboard',
  }));
  bffAxios.get.mockRejectedValue(new Error('temporary status outage'));
  render(<LogoutPage />);
  await waitFor(() => expect(window.location.href).toContain('/api/auth/oauth/user/login?'));
  expect(window.location.href).toContain('mode=live-id-jag');
  expect(window.location.href).toContain('return_to=%2Fdashboard');
  expect(bffAxios.post).toHaveBeenCalledWith('/api/auth/clear-session');
  expect(navigate).not.toHaveBeenCalled();
});
