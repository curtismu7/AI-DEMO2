import React from 'react';
import { render, screen } from '@testing-library/react';
import EventStream from '../EventStream';

describe('EventStream', () => {
  it('shows the empty state when there are no rows', () => {
    render(<EventStream columns={[{ key: 'a', label: 'A' }]} rows={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('No events in this window.');
  });

  it('renders a plain-value column as text, with no markup escape hatch by default', () => {
    render(
      <EventStream
        columns={[{ key: 'amount', label: 'Amount' }]}
        rows={[{ amount: 60000 }]}
      />,
    );
    const cell = screen.getByText('60000');
    expect(cell.tagName).toBe('TD');
    // No child element — the value was stringified, not rendered as markup.
    expect(cell.children).toHaveLength(0);
  });

  it('stringifies a React element given as a plain (non-render) cell value, rather than rendering it as markup', () => {
    // Guards against reinstating the old blanket `React.isValidElement(val)`
    // passthrough: a column with no `render` must treat ANY value, including
    // an element, as opaque data to stringify — never as markup to mount.
    // React elements stringify to "[object Object]"; that ugly output is the
    // whole point of the assertion, not a bug — it's proof the plain path
    // never special-cases an element.
    render(
      <EventStream
        columns={[{ key: 'amount', label: 'Amount' }]}
        rows={[{ amount: <span>60000</span> }]}
      />,
    );
    const cell = document.querySelector('td');
    expect(cell).toHaveTextContent('[object Object]');
    expect(screen.queryByText('60000')).not.toBeInTheDocument();
  });

  it('renders null/undefined plain values as an empty cell, not the string "null"', () => {
    render(
      <EventStream
        columns={[{ key: 'ruleName', label: 'Rule' }]}
        rows={[{ ruleName: null }]}
      />,
    );
    const cell = document.querySelector('td');
    expect(cell).toHaveTextContent('');
  });

  it('uses a column-level render() to opt a single column into markup, leaving other columns plain', () => {
    render(
      <EventStream
        columns={[
          { key: 'severity', label: 'Severity', render: (row) => <span className="sev-dot">{row.severity}</span> },
          { key: 'message', label: 'Message' },
        ]}
        rows={[{ severity: 'warning', message: 'rate limit approaching' }]}
      />,
    );
    const dot = screen.getByText('warning');
    expect(dot.tagName).toBe('SPAN');
    expect(dot).toHaveClass('sev-dot');
    // The non-render column on the same row stayed plain text.
    const messageCell = screen.getByText('rate limit approaching');
    expect(messageCell.tagName).toBe('TD');
    expect(messageCell.children).toHaveLength(0);
  });

  it('passes the full row to render(), not just the column\'s own value', () => {
    render(
      <EventStream
        columns={[{ key: 'category', label: 'Category', render: (row) => `${row.category}/${row.severity}` }]}
        rows={[{ category: 'mcp', severity: 'info' }]}
      />,
    );
    expect(screen.getByText('mcp/info')).toBeInTheDocument();
  });
});
