import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PrivilegeMcpDiagramPage from '../PrivilegeMcpDiagramPage';
import { buildSequenceFlow } from '../SequenceFlowDiagram';

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
      'https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/privilege/PRIVILEGE-MCP.md',
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

  it('renders the Sign-in + Tool Call tab as a React Flow sequence diagram with lifelines and numbered messages', () => {
    render(<PrivilegeMcpDiagramPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign-in + Tool Call' }));
    expect(screen.getByLabelText('Privilege MCP sequence diagram')).toBeInTheDocument();
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.getByText('mcp-server — MCP SERVER')).toBeInTheDocument();
    expect(screen.queryByText('Token in session?')).not.toBeInTheDocument();
    expect(document.querySelector('.pmd-diagram svg')).toBeNull();
  });

  it('turns the sequence source into one step per message, in order', () => {
    const { steps, edges } = buildSequenceFlow(`sequenceDiagram
    participant U as Operator
    participant P as Client page (UI)
    U->>P: Sign In with Privilege
    P-->>U: authUrl`);
    expect(edges).toHaveLength(2);
    expect(steps).toEqual(['Operator → Client page (UI): Sign In with Privilege', 'Client page (UI) → Operator: authUrl']);
  });

  it('the sequence tab has Simulate, Reset and a speed selector that walk its messages', () => {
    render(<PrivilegeMcpDiagramPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign-in + Tool Call' }));
    const seq = screen.getByRole('group', { name: 'Privilege MCP sequence diagram' });
    expect(within(seq).getByTitle('Time each step takes during Simulate')).toBeTruthy();
    fireEvent.click(within(seq).getByRole('button', { name: 'Simulate' }));
    expect(within(seq).getByText(/Step 1 of \d+/)).toBeTruthy();
    fireEvent.click(within(seq).getByRole('button', { name: 'Reset' }));
    expect(within(seq).getByRole('button', { name: 'Simulate' })).toBeTruthy();
  });
});
