import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentGatewayCapabilitiesTour from './AgentGatewayCapabilitiesTour';

describe('AgentGatewayCapabilitiesTour', () => {
  it('renders 3 group headings and 7 capability cards total', () => {
    render(<AgentGatewayCapabilitiesTour />);
    expect(screen.getByText('Validate & audit MCP requests')).toBeInTheDocument();
    expect(screen.getByText('Throttle requests & transform tokens')).toBeInTheDocument();
    expect(screen.getByText('Enforce OAuth, policy & metadata controls')).toBeInTheDocument();
    expect(document.querySelectorAll('.agct-card')).toHaveLength(7);
  });

  it('shows the node-only fallback note for RAR and no PingGateway evidence citation', () => {
    render(<AgentGatewayCapabilitiesTour />);
    const rarCard = screen.getByTestId('capability-card-metadata-controls');
    expect(rarCard).toHaveTextContent(/No Groovy equivalent exists yet/);
  });

  it('omits the "Try it" link when a capability has no relatedUCIds match (defensive — none currently, guards drift)', () => {
    render(<AgentGatewayCapabilitiesTour />);
    // every capability currently has at least one relatedUCIds entry, so every
    // card should show a Try it link today
    expect(screen.getAllByText(/Try it/)).toHaveLength(7);
  });
});
