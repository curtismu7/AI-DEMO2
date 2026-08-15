import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PrivilegeMcpDiagramPage from '../PrivilegeMcpDiagramPage';

describe('PrivilegeMcpDiagramPage', () => {
  it('links the footer citation to the real source file, not a placeholder', () => {
    render(<PrivilegeMcpDiagramPage />);
    const link = screen.getByRole('link', { name: 'privilege/PRIVILEGE-MCP.md' });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/curtismu7/AI-DEMO2/blob/main/privilege/PRIVILEGE-MCP.md',
    );
  });

  it('mentions the privilege-mcp-simple direct route the diagrams previously omitted', () => {
    render(<PrivilegeMcpDiagramPage />);
    expect(screen.getByText(/privilege-mcp-simple/)).toBeInTheDocument();
  });
});
