import React from 'react';
import { render, screen } from '@testing-library/react';
import DelegatedAccessPanel from '../DelegatedAccessPanel';

const GRANT = {
  id: 'deleg-1',
  delegator_email: 'emma@example.com',
  delegate_email: 'dana@example.com',
  scopes: ['view_accounts', 'view_balances'],
  status: 'active',
  granted_at: '2026-10-10T00:00:00.000Z',
  revoked_at: null,
};

afterEach(() => { delete global.fetch; });

it('shows who granted access, the scopes, and the date', async () => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, delegations: [GRANT] }) })
  );

  render(<DelegatedAccessPanel />);

  await screen.findByTestId('delegated-access-panel');
  await screen.findByText(/emma@example.com/);
  expect(screen.getByText(/view accounts/i)).toBeInTheDocument();
  expect(screen.getByText(/view balances/i)).toBeInTheDocument();
  expect(screen.getByText(/10\/10\/2026/)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/delegation/granted-to-me', { credentials: 'include' });
});

it('renders nothing when the viewer has no delegations', async () => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, delegations: [] }) })
  );

  const { container } = render(<DelegatedAccessPanel />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
});

it('renders nothing when the API errors (including 401 signed-out)', async () => {
  global.fetch = vi.fn(() => Promise.reject(new Error('network down')));

  const { container } = render(<DelegatedAccessPanel />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
});
