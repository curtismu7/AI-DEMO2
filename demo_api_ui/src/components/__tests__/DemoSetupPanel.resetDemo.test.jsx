/**
 * handleResetDemo swallowed the failure of POST /api/admin/reset-demo with
 * an empty catch, then unconditionally cleared local storage and logged the
 * user out -- a failed reset was indistinguishable from a successful one,
 * and the admin was signed out believing server state had actually cleared.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DemoSetupPanel from '../DemoSetupPanel';

vi.mock('../../context/IndustryBrandingContext', () => ({
  useIndustryBranding: () => ({}),
}));
vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: null, pageManifest: null }),
}));
vi.mock('../VerticalSwitcher', () => ({ default: () => null }));
vi.mock('../PingOneAudit', () => ({ default: () => null }));
vi.mock('../../services/demoScenarioService', () => ({
  fetchDemoScenario: vi.fn().mockResolvedValue(null),
  saveDemoScenario: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({}),
  },
}));
const performLogoutMock = vi.fn();
vi.mock('../../services/logout', () => ({
  performLogout: (...a) => performLogoutMock(...a),
}));
const notifyErrorMock = vi.fn();
vi.mock('../../utils/appToast', () => ({
  notifySuccess: vi.fn(), notifyError: (...a) => notifyErrorMock(...a),
  notifyWarning: vi.fn(), notifyInfo: vi.fn(),
}));

describe('DemoSetupPanel — reset demo failure handling', () => {
  beforeEach(() => {
    performLogoutMock.mockClear();
    notifyErrorMock.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
  });

  afterEach(() => {
    window.confirm.mockRestore();
    delete global.fetch;
  });

  it('surfaces the failure and does NOT clear local state or log out when the reset POST fails', async () => {
    const axios = (await import('axios')).default;
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('500'));
    vi.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    localStorage.setItem('tokenChainHistory', '[]');

    render(<MemoryRouter><DemoSetupPanel /></MemoryRouter>);

    const btn = await screen.findByRole('button', { name: /reset demo/i });
    fireEvent.click(btn);

    await waitFor(() => expect(notifyErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/reset demo failed/i),
    ));
    expect(performLogoutMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('tokenChainHistory')).toBe('[]'); // not cleared
  });

  it('clears local state and logs out when the reset POST succeeds', async () => {
    const axios = (await import('axios')).default;
    vi.spyOn(axios, 'post').mockResolvedValue({});
    vi.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    localStorage.setItem('tokenChainHistory', '[]');

    render(<MemoryRouter><DemoSetupPanel /></MemoryRouter>);

    const btn = await screen.findByRole('button', { name: /reset demo/i });
    fireEvent.click(btn);

    await waitFor(() => expect(performLogoutMock).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('tokenChainHistory')).toBeNull();
    expect(notifyErrorMock).not.toHaveBeenCalled();
  });
});
