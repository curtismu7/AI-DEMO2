// demo_api_ui/src/components/__tests__/Users.agentRestrictions.test.jsx
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import bffAxios from '../../services/bffAxios';
import { resolveSessionUser } from '../../services/sessionResolver';
import { notifyError } from '../../utils/appToast';
import Users from '../Users';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../services/sessionResolver', () => ({
  resolveSessionUser: vi.fn(),
}));

vi.mock('../../utils/appToast', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

const ONE_USER = {
  id: 'user-1',
  username: 'demoUser',
  firstName: 'Demo',
  lastName: 'User',
  email: 'demo@example.com',
  role: 'user',
  isActive: true,
  agentRestrictions: 'write',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveSessionUser.mockResolvedValue({ id: 'admin-1' });
  bffAxios.get.mockResolvedValue({ data: { users: [ONE_USER] } });
});

test('finding #49: notifies the admin when updateAgentRestrictions PATCH fails', async () => {
  bffAxios.patch.mockRejectedValueOnce(new Error('network error'));

  render(
    <MemoryRouter>
      <Users user={{ id: 'admin-1', role: 'admin' }} onLogout={() => {}} />
    </MemoryRouter>
  );

  const select = await screen.findByDisplayValue('write (full)');

  fireEvent.change(select, { target: { value: 'read' } });

  await waitFor(() => expect(bffAxios.patch).toHaveBeenCalled());
  await waitFor(() => expect(notifyError).toHaveBeenCalledWith('Failed to update agent restrictions'));
});
