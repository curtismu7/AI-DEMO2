import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VerticalOpsConsole from '../VerticalOpsConsole';

vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
import bffAxios from '../../../services/bffAxios';

it('renders the vertical hero and applies the accent theme var', () => {
  const { container } = render(<VerticalOpsConsole vertical="healthcare" user={{ role: 'user' }} />);
  expect(screen.getByText('Healthcare Ops')).toBeInTheDocument();
  const rootEl = container.querySelector('.vops');
  expect(rootEl.style.getPropertyValue('--accent')).toBe('#0d9488');
});

it('looks up a customer and renders category cards from the response', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: { user: { id: 'u1', name: 'Maya Chen' }, data: { appointments: [{ id: 'a1', reason: 'Follow-up', status: 'Scheduled' }] } } });
  render(<VerticalOpsConsole vertical="healthcare" user={{ role: 'user' }} />);
  fireEvent.change(screen.getByPlaceholderText(/Look up a patient/i), { target: { value: 'maya' } });
  fireEvent.submit(screen.getByTestId('vops-lookup-form'));
  await waitFor(() => expect(screen.getByText('Maya Chen')).toBeInTheDocument());
  expect(bffAxios.get).toHaveBeenCalledWith('/api/admin/healthcare/lookup', { params: { q: 'maya' } });
  expect(within(screen.getByTestId('vops-grid')).getByText('Appointments')).toBeInTheDocument();
  expect(screen.getByText('Follow-up')).toBeInTheDocument();
});
