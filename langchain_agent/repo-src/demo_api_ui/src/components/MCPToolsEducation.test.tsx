import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { MCPToolsEducation } from './MCPToolsEducation';

describe('MCPToolsEducation', () => {
  it('renders without crashing', () => {
    render(<MCPToolsEducation />);
    expect(screen.getByTestId('mcp-tools-education')).toBeInTheDocument();
  });

  it('displays the header and introduction', () => {
    render(<MCPToolsEducation />);
    expect(screen.getByText('MCP Banking Tools')).toBeInTheDocument();
    expect(screen.getByText(/The MCP server provides/)).toBeInTheDocument();
    expect(screen.getByText('9 tools')).toBeInTheDocument();
  });

  it('renders 3 category sections', () => {
    render(<MCPToolsEducation />);
    expect(screen.getByText('Read-Only Data Access')).toBeInTheDocument();
    expect(screen.getByText('Write Operations')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  it('shows correct tool counts per category', () => {
    render(<MCPToolsEducation />);
    const toolCounts = screen.getAllByText('4 tools');
    expect(toolCounts.length).toBe(2);
    expect(screen.getByText('1 tool')).toBeInTheDocument();
  });

  it('Write Operations starts expanded, others collapsed', () => {
    render(<MCPToolsEducation />);
    expect(screen.getByTestId('tool-create_deposit')).toBeInTheDocument();
    expect(screen.getByTestId('tool-create_transfer')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-get_my_accounts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-query_user_by_email')).not.toBeInTheDocument();
  });

  it('clicking category header toggles expanded state', () => {
    render(<MCPToolsEducation />);
    fireEvent.click(screen.getByText('Read-Only Data Access'));
    expect(screen.getByTestId('tool-get_my_accounts')).toBeInTheDocument();
    expect(screen.getByTestId('tool-sequential_think')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Read-Only Data Access'));
    expect(screen.queryByTestId('tool-get_my_accounts')).not.toBeInTheDocument();
  });

  it('displays required scopes as badges', () => {
    render(<MCPToolsEducation />);
    expect(screen.getAllByText('transactions:write').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('sensitive:read')).toBeInTheDocument();
  });

  it('shows No scopes required for tools without scopes', () => {
    render(<MCPToolsEducation />);
    fireEvent.click(screen.getByText('Read-Only Data Access'));
    expect(screen.getByText('No scopes required')).toBeInTheDocument();
  });

  it('shows auth indicators correctly', () => {
    render(<MCPToolsEducation />);
    const authLabels = screen.getAllByTitle('Requires user authentication');
    expect(authLabels.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByText('Public'));
    expect(screen.getByTitle('No authentication required')).toBeInTheDocument();
  });

  it('displays tool parameters for expanded tools', () => {
    render(<MCPToolsEducation />);
    // Write Operations is expanded — multiple tools have params
    const paramLabels = screen.getAllByText('Parameters:');
    expect(paramLabels.length).toBeGreaterThanOrEqual(1);
    // to_account_id appears in deposit and transfer
    expect(screen.getAllByText('to_account_id').length).toBeGreaterThanOrEqual(1);
  });

  it('category headers have proper aria-expanded attributes', () => {
    render(<MCPToolsEducation />);
    const writeHeader = screen.getByRole('button', { name: /Write Operations/i });
    const readHeader = screen.getByRole('button', { name: /Read-Only Data Access/i });
    expect(writeHeader).toHaveAttribute('aria-expanded', 'true');
    expect(readHeader).toHaveAttribute('aria-expanded', 'false');
  });

  it('displays all 9 tools when all categories expanded', () => {
    render(<MCPToolsEducation />);
    fireEvent.click(screen.getByText('Read-Only Data Access'));
    fireEvent.click(screen.getByText('Public'));
    expect(screen.getByTestId('tool-get_my_accounts')).toBeInTheDocument();
    expect(screen.getByTestId('tool-get_account_balance')).toBeInTheDocument();
    expect(screen.getByTestId('tool-get_my_transactions')).toBeInTheDocument();
    expect(screen.getByTestId('tool-sequential_think')).toBeInTheDocument();
    expect(screen.getByTestId('tool-create_deposit')).toBeInTheDocument();
    expect(screen.getByTestId('tool-create_withdrawal')).toBeInTheDocument();
    expect(screen.getByTestId('tool-create_transfer')).toBeInTheDocument();
    expect(screen.getByTestId('tool-get_sensitive_account_details')).toBeInTheDocument();
    expect(screen.getByTestId('tool-query_user_by_email')).toBeInTheDocument();
  });
});
