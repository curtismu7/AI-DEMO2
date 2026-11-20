// demo_api_ui/src/components/shared/__tests__/JsonFormView.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import JsonFormView from '../JsonFormView';

describe('JsonFormView', () => {
  it('renders each top-level scalar inline in its section header', () => {
    render(<JsonFormView value={{ accountId: 'acc_1', balance: 100 }} />);
    expect(screen.getByText(/accountId:/)).toBeInTheDocument();
    expect(screen.getByText('acc_1')).toBeInTheDocument();
    expect(screen.getByText(/balance:/)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders objects and arrays as collapsed sections that expand to flat dot-path rows', () => {
    render(<JsonFormView value={{ account: { openedOn: '2024-01-01', notes: 'first account' } }} />);
    const toggle = screen.getByRole('button', { name: /account/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('2024-01-01')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('account.openedOn')).toBeInTheDocument();
    expect(screen.getByText('2024-01-01')).toBeInTheDocument();
    expect(screen.getByText('account.notes')).toBeInTheDocument();
    expect(screen.getByText('first account')).toBeInTheDocument();
  });

  it('flattens array items with index paths', () => {
    render(<JsonFormView value={{ scopes: ['read', 'write'] }} />);
    fireEvent.click(screen.getByRole('button', { name: /scopes/i }));
    expect(screen.getByText('scopes[0]')).toBeInTheDocument();
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('scopes[1]')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
  });

  it('shows empty containers as empty when expanded', () => {
    render(<JsonFormView value={{ tags: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: /tags/i }));
    expect(screen.getByText(/\[ \] empty list/)).toBeInTheDocument();
  });

  it('renders a null leaf as null, not omitted', () => {
    render(<JsonFormView value={{ favoriteColor: null }} />);
    expect(screen.getByText(/favoriteColor:/)).toBeInTheDocument();
    expect(screen.getByText('null')).toBeInTheDocument();
  });

  it('truncates long string values with a Show more toggle', () => {
    const long = 'x'.repeat(200);
    render(<JsonFormView value={{ token: long }} />);
    expect(screen.getByText(`${'x'.repeat(120)}…`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it('keeps a Copy button on scalar values', () => {
    render(<JsonFormView value={{ accountId: 'acc_1' }} />);
    expect(screen.getAllByRole('button', { name: 'Copy' }).length).toBeGreaterThan(0);
  });

  it('shows the empty message when value is null, undefined, or an empty object', () => {
    const { rerender } = render(<JsonFormView value={null} />);
    expect(screen.getByText('No data.')).toBeInTheDocument();
    rerender(<JsonFormView value={undefined} />);
    expect(screen.getByText('No data.')).toBeInTheDocument();
    rerender(<JsonFormView value={{}} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
