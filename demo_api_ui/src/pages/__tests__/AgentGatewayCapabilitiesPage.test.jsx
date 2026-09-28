import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentGatewayCapabilitiesPage from '../AgentGatewayCapabilitiesPage';

const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../services/apiClient', () => ({ default: apiClientMock }));

beforeEach(() => {
  apiClientMock.get.mockClear();
  apiClientMock.get.mockReturnValue(new Promise(() => {}));
});

describe('AgentGatewayCapabilitiesPage', () => {
  it('opens the live two-step Agent Gateway tester directly', () => {
    render(<AgentGatewayCapabilitiesPage />);
    expect(screen.getByText('Agent Gateway Tester')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open Inspector/ })).not.toBeInTheDocument();
  });

  it('aborts its initial gateway requests when the page unmounts', () => {
    const { unmount } = render(<AgentGatewayCapabilitiesPage />);
    const initialReads = apiClientMock.get.mock.calls.filter(([url]) =>
      ['/api/mcp-gateway/active', '/api/mcp/inspector/tools', '/api/authorize/rules', '/api/mcp-gateway/rate-limit-status'].includes(url),
    );
    const signals = initialReads.map(([, options]) => options?.signal);

    unmount();

    expect(initialReads).toHaveLength(4);
    expect(signals.every((signal) => signal instanceof AbortSignal && signal.aborted)).toBe(true);
  });
});
