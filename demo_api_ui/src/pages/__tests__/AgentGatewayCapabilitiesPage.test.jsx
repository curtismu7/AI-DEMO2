import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentGatewayCapabilitiesPage from '../AgentGatewayCapabilitiesPage';

describe('AgentGatewayCapabilitiesPage', () => {
  it('opens the live two-step Agent Gateway tester directly', () => {
    render(<AgentGatewayCapabilitiesPage />);
    expect(screen.getByText('Agent Gateway Tester')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open Inspector/ })).not.toBeInTheDocument();
  });
});
