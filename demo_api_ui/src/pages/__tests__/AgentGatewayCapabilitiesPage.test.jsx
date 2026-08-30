import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentGatewayCapabilitiesPage from '../AgentGatewayCapabilitiesPage';

describe('AgentGatewayCapabilitiesPage', () => {
  it('renders the Agent Gateway Inspector title and Open Inspector button', () => {
    render(<AgentGatewayCapabilitiesPage />);
    expect(screen.getByRole('heading', { level: 1, name: /Agent Gateway Inspector/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Inspector/ })).toBeInTheDocument();
  });

  it('shows intro text describing the inspector', () => {
    render(<AgentGatewayCapabilitiesPage />);
    expect(screen.getByText(/Test and debug MCP tools/i)).toBeInTheDocument();
  });
});
