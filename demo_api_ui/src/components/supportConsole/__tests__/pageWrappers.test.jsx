import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() }
}));
vi.mock('../../../utils/appToast', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn()
}));

import BankingAdminOps from '../../BankingAdminOps';
import WorkforceAdminOps from '../../WorkforceAdminOps';

it('BankingAdminOps renders the Banking console', () => {
  render(<BankingAdminOps user={{ role: 'user' }} onLogout={() => {}} />);
  expect(screen.getByText('Banking Ops')).toBeInTheDocument();
});

it('WorkforceAdminOps renders the Workforce console', () => {
  render(<WorkforceAdminOps user={{ role: 'user' }} onLogout={() => {}} />);
  expect(screen.getByText('Workforce Ops')).toBeInTheDocument();
});
