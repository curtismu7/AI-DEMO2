import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../context/ThemeContext';
import { NewRelicRoute, PingOneEventsRoute, P1AzRoute } from '../MonitoringRoutes';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
// AdminSideNav/TopNav require several App.js-level providers that this
// route-level test does not mount (SessionTokenProvider, EducationUIProvider,
// etc.) — same mocking approach as src/components/__tests__/adminSideNav.test.jsx.
vi.mock('../../context/EducationUIContext', () => ({
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn(), panel: null, tab: null }),
}));
vi.mock('../../context/SessionTokenContext', () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: null,
    tokenLoading: false,
    sessionType: null,
    staleSession: false,
    hasActiveToken: false,
    openTokenModal: null,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({
    data: { window: '1h', funnel: [{ category: 'oauth', count: 3 }], timeseries: [], stream: [] },
  });
});

describe('NewRelicRoute', () => {
  it('renders app chrome for a signed-out visitor', async () => {
    render(
      <MemoryRouter initialEntries={['/monitoring/new-relic']}>
        <ThemeProvider><NewRelicRoute user={null} logout={() => {}} /></ThemeProvider>
      </MemoryRouter>,
    );
    // The side nav is the thing PR #1452 dropped; it must be back even logged out.
    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument());
  });

  it('renders the dashboard, not the PingOne panel', async () => {
    render(
      <MemoryRouter initialEntries={['/monitoring/new-relic']}>
        <ThemeProvider><NewRelicRoute user={null} logout={() => {}} /></ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('stage-oauth')).toBeInTheDocument());
    expect(screen.queryByText(/No events received yet/i)).not.toBeInTheDocument();
  });
});

describe('PingOneEventsRoute', () => {
  it('renders the PingOne panel with chrome', async () => {
    render(
      <MemoryRouter initialEntries={['/monitoring/pingone-events']}>
        <ThemeProvider><PingOneEventsRoute user={null} logout={() => {}} /></ThemeProvider>
      </MemoryRouter>,
    );
    // "PingOne Events" appears both as the new nav label and the panel's own
    // title — selector narrows to the panel heading to avoid an ambiguous match.
    await waitFor(() =>
      expect(
        screen.getByText(/PingOne Events/i, { selector: '.pingone-event-panel__title' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});

describe('P1AzRoute', () => {
  it('renders app chrome and the dashboard for a signed-out visitor', async () => {
    apiClient.get.mockResolvedValue({
      data: { view: 'authorize', window: '24h', decisions: [{ decision: 'PERMIT', count: 2 }], posture: [], timeseries: [], stream: [] },
    });
    render(
      <MemoryRouter initialEntries={['/monitoring/p1az']}>
        <ThemeProvider><P1AzRoute user={null} logout={() => {}} /></ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('stat-PERMIT')).toHaveTextContent('2'));
  });
});
