import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PingFederateRequiredModal from '../PingFederateRequiredModal';
import bffAxios from '../../services/bffAxios';
import { navigateToCustomerOAuthForceLogin } from '../../utils/authUi';

vi.mock('../../services/bffAxios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../utils/authUi', () => ({ navigateToCustomerOAuthForceLogin: vi.fn() }));

const raise = () => act(() => { window.dispatchEvent(new CustomEvent('id-jag-provider-required', { detail: { returnTo: '/dashboard' } })); });

beforeEach(() => { vi.clearAllMocks(); bffAxios.post.mockResolvedValue({ data: { ok: true } }); });

test('stays closed until a PF-only run finds PingOne selected', () => {
  render(<PingFederateRequiredModal />);
  expect(screen.queryByText(/needs PingFederate/i)).toBeNull();
});

test('Sign in with PingFederate switches provider then signs in and returns to the page', async () => {
  render(<PingFederateRequiredModal />);
  raise();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with PingFederate' }));
  await waitFor(() => expect(navigateToCustomerOAuthForceLogin).toHaveBeenCalledWith('/dashboard'));
  expect(bffAxios.post).toHaveBeenCalledWith('/api/admin/config', { oauth_provider: 'pingfederate' });
});

test('Cancel closes without switching', async () => {
  render(<PingFederateRequiredModal />);
  raise();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByText(/needs PingFederate/i)).toBeNull());
  expect(bffAxios.post).not.toHaveBeenCalled();
});

test('a refused provider switch shows the reason and does not navigate', async () => {
  bffAxios.post.mockRejectedValue({ response: { data: { error: 'not_authorized' } } });
  render(<PingFederateRequiredModal />);
  raise();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with PingFederate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/administrator session/i);
  expect(navigateToCustomerOAuthForceLogin).not.toHaveBeenCalled();
});
