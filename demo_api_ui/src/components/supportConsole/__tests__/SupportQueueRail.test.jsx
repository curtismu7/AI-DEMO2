import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import bffAxios from '../../../services/bffAxios';
import SupportQueueRail from '../SupportQueueRail';

const ROW = {
  customerId: 'u1', customerName: 'Demo User', customerQuery: 'demo',
  category: 'maintenanceTickets', categoryLabel: 'Maintenance',
  id: 'MT-3001', title: 'Spindle bearing noise', status: 'Open',
};

beforeEach(() => { bffAxios.get.mockReset(); });

it('lists open work for the vertical', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: { vertical: 'manufacturing', data: { rows: [ROW] } } });
  render(<SupportQueueRail vertical="manufacturing" onSelect={() => {}} />);

  await waitFor(() => expect(screen.getByText('Spindle bearing noise')).toBeInTheDocument());
  expect(bffAxios.get).toHaveBeenCalledWith('/api/admin/manufacturing/queue');
  expect(screen.getByText(/Demo User/)).toBeInTheDocument();
});

it('hands the selected row back to the console', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: { data: { rows: [ROW] } } });
  const onSelect = vi.fn();
  render(<SupportQueueRail vertical="manufacturing" onSelect={onSelect} />);

  await waitFor(() => expect(screen.getByText('Spindle bearing noise')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Spindle bearing noise'));
  expect(onSelect).toHaveBeenCalledWith(ROW);
});

it('says so when nothing is open rather than rendering an empty box', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: { data: { rows: [] } } });
  render(<SupportQueueRail vertical="banking" onSelect={() => {}} />);
  await waitFor(() => expect(screen.getByText(/Nothing open for this vertical/i)).toBeInTheDocument());
});

it('reports a failed load without claiming the queue is empty', async () => {
  bffAxios.get.mockRejectedValueOnce(new Error('boom'));
  render(<SupportQueueRail vertical="retail" onSelect={() => {}} />);
  await waitFor(() => expect(screen.getByText(/Could not load the queue/i)).toBeInTheDocument());
  expect(screen.queryByText(/Nothing open/i)).toBeNull();
});
