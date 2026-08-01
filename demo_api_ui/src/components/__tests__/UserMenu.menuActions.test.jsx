// demo_api_ui/src/components/__tests__/UserMenu.menuActions.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import bffAxios from '../../services/bffAxios';
import UserMenu from '../UserMenu';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../context/SessionTokenContext', () => ({
  useSessionToken: () => ({ hasActiveToken: true }),
}));

const USER = { id: '1', firstName: 'Ada', lastName: 'Byron', email: 'ada@example.com', role: 'customer' };

function open(props = {}) {
  render(
    <MemoryRouter>
      <UserMenu user={USER} onLogout={vi.fn()} {...props} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByLabelText('User menu'));
}

beforeEach(() => {
  mockNavigate.mockClear();
  bffAxios.post.mockReset();
  bffAxios.post.mockResolvedValue({ data: {} });
});

describe('UserMenu menu actions', () => {
  it('navigates to the profile page', () => {
    open();
    fireEvent.click(screen.getByText('Profile'));
    expect(mockNavigate).toHaveBeenCalledWith('/profile');
  });

  it('sends a customer to /security, not the admin-gated /settings', () => {
    open();
    fireEvent.click(screen.getByText('Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('/security');
  });

  it('sends an admin view to /settings', () => {
    open({ isAdminView: true, onSwitchView: vi.fn() });
    fireEvent.click(screen.getByText('Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  it('opens the notification preferences panel and returns to the menu', () => {
    open();
    fireEvent.click(screen.getByText('Notifications'));
    expect(screen.getByText('Choose what this bank may notify you about.')).toBeInTheDocument();
    expect(screen.queryByText('Profile')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Back to user menu'));
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('persists a toggled category and reverts it when the save fails', async () => {
    open();
    fireEvent.click(screen.getByText('Notifications'));

    const toggle = screen.getByRole('checkbox', { name: /Transfers and payments/ });
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalledWith(
      '/api/auth/oauth/user/notification-preferences',
      { notificationPrefs: { agentActivity: true, transfers: false, securityAlerts: true, lowBalance: true } },
    ));
    expect(toggle.checked).toBe(false);

    bffAxios.post.mockRejectedValueOnce(new Error('nope'));
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(false));
  });

  it('seeds the toggles from the saved user preference', () => {
    render(
      <MemoryRouter>
        <UserMenu user={{ ...USER, notificationPrefs: { lowBalance: false } }} onLogout={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText('User menu'));
    fireEvent.click(screen.getByText('Notifications'));

    expect(screen.getByRole('checkbox', { name: /Low balance/ }).checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: /Security alerts/ }).checked).toBe(true);
  });
});
