import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TokenExchangeModeSummary from '../TokenExchangeModeSummary';

describe('TokenExchangeModeSummary', () => {
  const sampleTokens = [
    {
      type: 'User',
      name: 'customer access token',
      issuedBy: 'PingOne AS',
      rfc8693Role: 'subject token',
    },
    {
      type: 'Agent',
      name: 'BFF-delegated MCP token',
      issuedBy: 'PingOne AS (via RFC 8693)',
      rfc8693Role: 'delegated token',
    },
    {
      type: 'MCP',
      name: 'resource-scoped access token',
      issuedBy: 'PingOne AS (RFC 8693 + 8707)',
      rfc8693Role: 'narrowed resource token',
    },
  ];

  it('renders summary line with emoji and token count', () => {
    render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    expect(screen.getByText((content, element) => {
      return element?.className === 'tems-summary-icon' && content === '🔗';
    })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders "View Details" button when collapsed', () => {
    render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    const button = screen.getByRole('button', { name: /View Details/i });
    expect(button).toBeInTheDocument();
  });

  it('expands table when "View Details" button is clicked', () => {
    render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    const button = screen.getByRole('button', { name: /View Details/i });
    fireEvent.click(button);

    // Check that table headers are visible
    expect(screen.getByText(/Token Type/)).toBeInTheDocument();
    expect(screen.getByText(/Full Name/)).toBeInTheDocument();
    expect(screen.getByText(/Issued By/)).toBeInTheDocument();
    expect(screen.getByText(/RFC 8693 Role/)).toBeInTheDocument();
  });

  it('shows "Hide Details" button when expanded', () => {
    render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    const viewButton = screen.getByRole('button', { name: /View Details/i });
    fireEvent.click(viewButton);

    expect(screen.getByRole('button', { name: /Hide Details/i })).toBeInTheDocument();
  });

  it('collapses table when "Hide Details" button is clicked', () => {
    render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    const viewButton = screen.getByRole('button', { name: /View Details/i });
    fireEvent.click(viewButton);

    const hideButton = screen.getByRole('button', { name: /Hide Details/i });
    fireEvent.click(hideButton);

    expect(screen.queryByText(/Token Type/)).not.toBeInTheDocument();
  });

  it('displays all token rows with correct data', () => {
    render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    const viewButton = screen.getByRole('button', { name: /View Details/i });
    fireEvent.click(viewButton);

    // Check first token (User)
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('customer access token')).toBeInTheDocument();
    expect(screen.getByText('PingOne AS')).toBeInTheDocument();
    expect(screen.getByText('subject token')).toBeInTheDocument();

    // Check second token (Agent)
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('BFF-delegated MCP token')).toBeInTheDocument();

    // Check third token (MCP)
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByText('resource-scoped access token')).toBeInTheDocument();
  });

  it('renders token type badges with correct classes', () => {
    const { container } = render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    const viewButton = screen.getByRole('button', { name: /View Details/i });
    fireEvent.click(viewButton);

    const userBadge = container.querySelector('.tems-token-badge--user');
    const agentBadge = container.querySelector('.tems-token-badge--agent');
    const mcpBadge = container.querySelector('.tems-token-badge--mcp');

    expect(userBadge).toBeInTheDocument();
    expect(agentBadge).toBeInTheDocument();
    expect(mcpBadge).toBeInTheDocument();
  });

  it('handles empty tokens array gracefully', () => {
    render(<TokenExchangeModeSummary tokens={[]} />);

    expect(screen.getAllByText('0')[0]).toBeInTheDocument();
  });

  it('handles null tokens gracefully', () => {
    render(<TokenExchangeModeSummary tokens={null} />);

    expect(screen.getAllByText('0')[0]).toBeInTheDocument();
  });

  it('displays summary badge with token count', () => {
    const { container } = render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    const badge = container.querySelector('.tems-summary-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('3');
  });

  it('maintains expanded/collapsed state independently', () => {
    const { rerender } = render(<TokenExchangeModeSummary tokens={sampleTokens} />);

    const viewButton = screen.getByRole('button', { name: /View Details/i });
    fireEvent.click(viewButton);

    expect(screen.getByText(/Token Type/)).toBeInTheDocument();

    // Rerender with same props
    rerender(<TokenExchangeModeSummary tokens={sampleTokens} />);

    // State should persist (still expanded)
    expect(screen.getByText(/Token Type/)).toBeInTheDocument();
  });
});
