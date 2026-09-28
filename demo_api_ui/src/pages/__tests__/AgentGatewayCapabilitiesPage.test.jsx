import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import AgentGatewayCapabilitiesPage from '../AgentGatewayCapabilitiesPage';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

describe('AgentGatewayCapabilitiesPage', () => {
  it('opens the live two-step Agent Gateway tester directly', async () => {
    await act(async () => {
      render(<AgentGatewayCapabilitiesPage />);
    });

    expect(screen.getByText('Agent Gateway Tester')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open Inspector/ })).not.toBeInTheDocument();
  });
});
