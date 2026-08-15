import { render, screen, fireEvent } from '@testing-library/react';
import RecordDrawer from '../RecordDrawer';

const row = { id: 'a1', title: 'Premier Checking', sub: 'Balance $4,210.55', status: 'Active', tone: 'ok', actions: ['Seed charge', 'Delete'] };
const category = { id: 'accounts', label: 'Accounts', icon: 'AC' };
const customer = { name: 'Jordan Rivera' };

it('renders record detail, actions, and a timeline when open', () => {
  render(<RecordDrawer open vertical="banking" category={category} row={row} customer={customer} onClose={() => {}} onAction={() => {}} />);
  expect(screen.getByText('Premier Checking')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Seed charge' })).toBeInTheDocument();
  expect(screen.getByText(/viewed by operator/i)).toBeInTheDocument();
});

it('calls onAction with the label, row, and category id', () => {
  const onAction = jest.fn();
  render(<RecordDrawer open vertical="banking" category={category} row={row} customer={customer} onClose={() => {}} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: 'Seed charge' }));
  expect(onAction).toHaveBeenCalledWith('Seed charge', row, 'accounts');
});
