import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentGatewayCapabilitiesPage from '../AgentGatewayCapabilitiesPage';

describe('AgentGatewayCapabilitiesPage', () => {
  it('opens the Agent Gateway Inspector directly', () => {
    render(<AgentGatewayCapabilitiesPage />);
    expect(screen.getByText('Agent Gateway Inspector')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open Inspector/ })).not.toBeInTheDocument();
  });
});
