import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentGatewayCapabilitiesPage from '../AgentGatewayCapabilitiesPage';

describe('AgentGatewayCapabilitiesPage', () => {
  it('renders the Agent Gateway title and every capability card without any network call', () => {
    render(<AgentGatewayCapabilitiesPage />);
    expect(screen.getByRole('heading', { level: 1, name: /Agent Gateway/ })).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-mcp-validation')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-weather-tx-scope')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-secrets-dotenvx')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-audit-logging')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-rate-limiting')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-token-transformation')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-oauth-enforcement')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-policy-enforcement')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-metadata-controls')).toBeInTheDocument();
  });

  it('states the PingGateway-default / Node-fallback claim in the intro copy', () => {
    const { container } = render(<AgentGatewayCapabilitiesPage />);
    const intro = container.querySelector('.cap-showcase__intro');
    expect(intro).toHaveTextContent(/default live enforcement path/i);
  });
});
