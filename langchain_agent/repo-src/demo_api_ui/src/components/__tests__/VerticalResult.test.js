import { render, screen } from '@testing-library/react';
import VerticalResult from '../VerticalResult';

test('card renders titled fields by path', () => {
  render(<VerticalResult descriptor={{ type: 'card', title: 'Appointment Confirmed', fields: [{ label: 'Provider', path: 'provider' }, { label: 'When', path: 'when', format: 'date' }] }} data={{ provider: 'Dr. Lee', when: '2026-07-01' }} />);
  expect(screen.getByText('Appointment Confirmed')).toBeInTheDocument();
  expect(screen.getByText('Provider')).toBeInTheDocument();
  expect(screen.getByText('Dr. Lee')).toBeInTheDocument();
});

test('money format renders a dollar amount', () => {
  render(<VerticalResult descriptor={{ type: 'fieldList', fields: [{ label: 'Out of pocket', path: 'oop', format: 'money' }] }} data={{ oop: 142.5 }} />);
  expect(screen.getByText('$142.50')).toBeInTheDocument();
});

test('table renders columns over an array-valued property', () => {
  render(<VerticalResult descriptor={{ type: 'table', columns: [{ label: 'Provider', path: 'provider' }, { label: 'Status', path: 'status' }] }} data={{ records: [{ provider: 'Dr. A', status: 'Active' }, { provider: 'Dr. B', status: 'Released' }] }} />);
  expect(screen.getByText('Dr. A')).toBeInTheDocument();
  expect(screen.getByText('Released')).toBeInTheDocument();
});

test('missing descriptor falls back to text', () => {
  render(<VerticalResult descriptor={null} data={{ note: 'hello' }} />);
  expect(screen.getByText(/hello/)).toBeInTheDocument();
});
