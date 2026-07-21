// demo_api_ui/src/components/shared/__tests__/JsonFormView.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import JsonFormView from '../JsonFormView';

describe('JsonFormView', () => {
  it('renders a nested object as grouped label/value rows', () => {
    render(<JsonFormView value={{ account: { openedOn: '2024-01-01', notes: 'first account' } }} />);
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Opened On')).toBeInTheDocument();
    expect(screen.getByText('2024-01-01')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('first account')).toBeInTheDocument();
    expect(screen.queryByText('Key Values')).toBeNull();
  });

  it('renders an array of primitives as Item rows', () => {
    render(<JsonFormView value={{ scopes: ['read', 'write'] }} />);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
  });

  it('renders an array of objects as indexed sub-groups', () => {
    render(<JsonFormView value={{ accounts: [{ openedOn: '2024' }, { openedOn: '2025' }] }} />);
    expect(screen.getAllByText(/Item \d/)).toHaveLength(2);
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
  });

  it('renders a null leaf as a muted dash, not omitted', () => {
    render(<JsonFormView value={{ favoriteColor: null }} />);
    expect(screen.getByText('Favorite Color')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('truncates long string values with a Show more toggle', () => {
    const long = 'x'.repeat(200);
    render(<JsonFormView value={{ token: long }} />);
    expect(screen.getByText(`${'x'.repeat(120)}…`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it('collects name-matched keys into a Key Values summary, without removing them from All Fields', () => {
    render(<JsonFormView value={{ account: { accountId: 'acc_1', favoriteColor: 'blue' } }} />);
    expect(screen.getByText('Key Values')).toBeInTheDocument();
    expect(screen.getByText('All Fields')).toBeInTheDocument();
    expect(screen.getByText('Account › Account Id')).toBeInTheDocument();
    expect(screen.getAllByText('acc_1')).toHaveLength(2);
    expect(screen.getByText('blue')).toBeInTheDocument();
  });

  it('shows the empty message when value is null, undefined, or an empty object', () => {
    const { rerender } = render(<JsonFormView value={null} />);
    expect(screen.getByText('No data.')).toBeInTheDocument();
    rerender(<JsonFormView value={{}} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
