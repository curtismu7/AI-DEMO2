import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../services/apiClient';
import UseCaseLauncherPage from '../UseCaseLauncherPage';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking' }),
}));

vi.mock('../../context/EducationUIContext', () => ({
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn(), panel: null, tab: null }),
}));

vi.mock('../../components/VerticalSwitcher', () => ({
  default: function VerticalSwitcherStub() {
    return null;
  },
}));

describe('UseCaseLauncherPage — flag gating covers the full required set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/use-cases') {
        return Promise.resolve({
          data: {
            useCases: [{
              id: 'UC14b',
              useCaseId: 'par-rar-intent-verified',
              title: 'PAR + RAR intent verified (PERMIT)',
              maturity: 'flag:ff_rar',
              primaryTool: 'create_transfer',
              trigger: { type: 'chip', text: 'run it' },
            }],
          },
        });
      }
      if (url === '/api/admin/feature-flags') {
        return Promise.resolve({
          data: {
            flags: [
              { id: 'ff_rar', value: 'false' },
              { id: 'ff_mcp_gateway_pinggateway', value: 'false' },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  test('shows both required flags, not just the maturity flag', async () => {
    render(<MemoryRouter><UseCaseLauncherPage /></MemoryRouter>);
    // UC14b is a member of multiple capability-ledger strips (Agent Gateway,
    // PingOne Authorize) and the Demo script, so its card — and this flag
    // chip — renders once per section (no cross-section dedup elsewhere in
    // this page, same as every other multi-section test here).
    await waitFor(() => expect(screen.getAllByText('ff_rar').length).toBeGreaterThan(0));
    expect(screen.getAllByText('ff_mcp_gateway_pinggateway').length).toBeGreaterThan(0);
  });

  test('does not show the flag-gate banner when the server reports the flag ON as a real boolean', async () => {
    // Regression: GET /api/admin/feature-flags returns booleans (resolveFlag()
    // in featureFlags.js), not strings. A use case whose only requirement is
    // ff_mcp_gateway_pinggateway (no maturity: flag:*, just a primaryTool) must
    // not show its banner once useLiveFlags normalizes that boolean to 'true'.
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/use-cases') {
        return Promise.resolve({
          data: {
            useCases: [{
              id: 'UC-gateway-on',
              useCaseId: 'gateway-on-check',
              title: 'Gateway-gated use case',
              track: 'controls',
              primaryTool: 'create_transfer',
              trigger: { type: 'chip', text: 'run it' },
            }],
          },
        });
      }
      if (url === '/api/admin/feature-flags') {
        return Promise.resolve({
          data: { flags: [{ id: 'ff_mcp_gateway_pinggateway', value: true }] },
        });
      }
      return Promise.resolve({ data: {} });
    });
    render(<MemoryRouter><UseCaseLauncherPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Gateway-gated use case')).toBeTruthy());
    expect(screen.queryByText('ff_mcp_gateway_pinggateway')).toBeNull();
    expect(screen.queryByText(/feature flag/i)).toBeNull();
  });
});
