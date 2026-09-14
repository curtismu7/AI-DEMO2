import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PrivilegeMcpDiagramPage from '../PrivilegeMcpDiagramPage';

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
global.ResizeObserver = global.ResizeObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

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

  it('renders the Architecture tab as a React Flow graph, not Mermaid', () => {
    render(<PrivilegeMcpDiagramPage />);
    expect(screen.getByText('Gateway')).toBeInTheDocument();
    expect(screen.getByText('mcp-server :8080')).toBeInTheDocument();
    expect(document.querySelector('.react-flow')).toBeInTheDocument();
  });

  it('renders the Auth Flow tab as a React Flow graph with its branch nodes', () => {
    render(<PrivilegeMcpDiagramPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Auth Flow' }));
    expect(screen.getByText('Token in session?')).toBeInTheDocument();
    expect(screen.getByText('Tools returned to UI')).toBeInTheDocument();
  });

  it('keeps the Sign-in + Tool Call tab on Mermaid — no node/edge primitive fits a sequence diagram', () => {
    render(<PrivilegeMcpDiagramPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign-in + Tool Call' }));
    expect(screen.getByLabelText('Privilege MCP diagram')).toBeInTheDocument();
    expect(screen.queryByText('Token in session?')).not.toBeInTheDocument();
    expect(screen.queryByText('mcp-server :8080')).not.toBeInTheDocument();
  });
});
