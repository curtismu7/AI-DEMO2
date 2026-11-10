// /admin (components/Dashboard) on the Ping UI Standard: banner first and honest to what loaded, one primary button
// in every view state, chips that carry a word, buttons that keep focus while they work, no second <main>.
// The admin session is a prop here (the app's RequireAdminLogin guards the route), so this renders the admin view.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../Dashboard';
import RequireAdminLogin from '../../routes/RequireAdminLogin';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), startRoleSwitch: vi.fn(() => Promise.resolve()) }));

vi.mock('../../services/bffAxios', () => ({ default: { get: mocks.get, post: mocks.post } }));
vi.mock('../../utils/roleSwitch', () => ({ startRoleSwitch: mocks.startRoleSwitch }));
vi.mock('../../utils/appToast', () => {
  const fn = vi.fn();
  return { toast: { dismiss: fn }, notifySuccess: fn, notifyError: fn, notifyWarning: fn, notifyInfo: fn };
});
vi.mock('../../utils/dashboardToast', () => ({ toastAdminSessionError: vi.fn() }));
vi.mock('../../utils/authUi', () => ({ navigateToAdminOAuthLogin: vi.fn() }));
vi.mock('../../services/sessionResolver', () => ({ resolveSessionUser: vi.fn(() => Promise.resolve(null)) }));
vi.mock('../../hooks/useDividerDrag', () => ({ default: () => ({ size: 380, handleProps: {} }) }));
vi.mock('../../hooks/useCurrentUserTokenEvent', () => ({ useCurrentUserTokenEvent: () => {} }));
vi.mock('../../context/AgentUiModeContext', () => ({ useAgentUiMode: () => ({ placement: 'floating' }) }));
vi.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }) }));
vi.mock('../../context/SessionTokenContext', () => ({ useSessionToken: () => ({ registerTokenModalOpener: () => () => {} }) }));
vi.mock('../../context/EventStreamContext', () => ({ useEventStream: () => ({ addEvent: vi.fn() }) }));
vi.mock('../TokenChainTraceRail', () => ({ default: () => <div data-testid="token-rail" /> }));
vi.mock('../ExchangeModeToggle', () => ({ default: () => <div /> }));
vi.mock('../GroupMembershipToggle', () => ({ default: () => <div /> }));
vi.mock('../AdminDemoControlStrip', () => ({ default: () => <div /> }));
vi.mock('../ThresholdControls', () => ({ default: () => <div /> }));
vi.mock('../EventStreamPanel', () => ({ default: () => <div /> }));
vi.mock('../ApiCallsModal', () => ({ default: () => null }));
vi.mock('../OAuthTokenDisplayPage', () => ({ default: () => <div /> }));
vi.mock('../FloatingPanel', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../shared/PingIdentitySpinner', () => ({ default: () => <span>spinner</span> }));

const ADMIN = { id: 'a1', username: 'admin', role: 'admin' };
const STATS = { totalUsers: 12, activeUsers: 7, totalAccounts: 24, totalTransactions: 318, totalBalance: 1234567.5, averageBalance: 51440.31 };
const LOGS = [
  { id: 1, timestamp: '2026-11-09T10:00:00Z', username: 'bob', action: 'LOGIN', endpoint: '/api/auth/login', responseStatus: 200 },
  { id: 2, timestamp: '2026-11-09T10:01:00Z', username: 'carol', action: 'TRANSFER_MONEY', endpoint: '/api/transactions', responseStatus: 403 },
];

const reject = (status) => Promise.reject({ response: { status }, message: `HTTP ${status}` });

function routes({ stats = () => Promise.resolve({ data: { stats: STATS } }), activity = () => Promise.resolve({ data: { logs: LOGS } }) } = {}) {
  mocks.get.mockImplementation((url) => {
    if (url === '/api/admin/stats') return stats();
    if (url.startsWith('/api/admin/activity/recent')) return activity();
    if (url === '/api/admin/config') return Promise.resolve({ data: { ff_inject_scopes: 'false' } });
    if (url === '/api/admin/users/hints') return Promise.resolve({ data: { users: [] } });
    return Promise.resolve({ data: {} });
  });
}

const renderPage = (props = {}) =>
  render(<MemoryRouter><Dashboard user={ADMIN} onLogout={vi.fn()} {...props} /></MemoryRouter>);

const primaries = (root = document) => [...root.querySelectorAll('button.pu-btn--primary')].map((b) => b.textContent.trim());

describe('Dashboard (/admin) — Ping UI Standard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('puts the note banner first inside PingPage, with one h1 and no second <main>', async () => {
    routes();
    const { container } = renderPage();
    await screen.findByText('Key metrics');
    const root = container.querySelector('.pu-page.admin-dashboard-page');
    expect(root).not.toBeNull();
    expect(root.firstElementChild).toBe(root.querySelector('.pu-banner-wrap'));
    expect(screen.getByTestId('admin-banner').getAttribute('role')).toBe('note');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(container.querySelector('main')).toBeNull();
    // the skip link still lands on a named, focusable region
    const target = container.querySelector('#admin-dashboard-main');
    expect(target.getAttribute('role')).toBe('region');
    expect(target.getAttribute('aria-label')).toBeTruthy();
    expect(target.getAttribute('tabindex')).toBe('-1');
  });

  it('words the banner from what loaded: figures read, or none shown', async () => {
    routes();
    const first = renderPage();
    await screen.findByText('Key metrics');
    expect(screen.getByTestId('admin-banner')).toHaveTextContent('Key metrics were loaded from the BFF.');
    expect(screen.getByTestId('admin-banner')).toHaveTextContent(/demo records held in the BFF's memory, not a real bank/);
    // it must not claim a source (PingOne) or mode it cannot know: the BFF falls back to the demo store
    expect(screen.getByTestId('admin-banner').textContent).not.toMatch(/requested from PingOne/);
    first.unmount();

    routes({ stats: () => reject(500) });
    renderPage();
    await screen.findByTestId('admin-stats-unavailable');
    const text = screen.getByTestId('admin-banner').textContent;
    expect(text).toMatch(/Key metrics could not be loaded, so no figures are shown/);
    expect(text).not.toMatch(/were loaded from the BFF/);
  });

  it('loaded state: View Profile is the one primary; the other actions and the toolbar are secondaries', async () => {
    routes();
    const { container } = renderPage();
    await screen.findByText('Key metrics');
    expect(primaries(container)).toEqual(['View Profile']);
    for (const name of ['Dark mode', 'API Calls', 'Export seed JSON', 'Reset Demo', 'View Accounts', 'Reset Password']) {
      expect(screen.getByRole('button', { name: new RegExp(name) }).className).not.toMatch(/pu-btn--primary/);
    }
  });

  it('unavailable state: Retry is the one primary, the customer panel steps down, and the card says so with a word', async () => {
    routes({ stats: () => reject(500) });
    const { container } = renderPage();
    const card = await screen.findByTestId('admin-stats-unavailable');
    expect(primaries(container)).toEqual(['Retry']);
    expect(within(card).getByRole('alert')).toHaveTextContent('Unavailable');
    expect(card.className).toMatch(/pu-card--danger/);
  });

  it('403: Sign out is a secondary, Retry stays the only primary', async () => {
    routes({ stats: () => reject(403) });
    const { container } = renderPage();
    await screen.findByTestId('admin-stats-unavailable');
    expect(primaries(container)).toEqual(['Retry']);
    expect(screen.getByRole('button', { name: 'Sign out' }).className).toBe('pu-btn');
  });

  it('Retry keeps its name and keyboard focus while it runs; the always-mounted status line speaks, and focus lands on the metrics when it succeeds', async () => {
    let ok = false;
    let release;
    routes({ stats: () => (ok ? new Promise((r) => { release = () => r({ data: { stats: STATS } }); }) : reject(500)) });
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const live = screen.getByTestId('admin-load-status');
    expect(live.getAttribute('role')).toBe('status'); // mounted before its text changes
    expect(live).toHaveTextContent('');
    ok = true;
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(live).toHaveTextContent('Retrying…'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBe(retry); // name did not change
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(retry);
    expect(screen.queryByText('spinner')).toBeNull();
    fireEvent.click(retry); // ignored while running
    expect(mocks.get.mock.calls.filter(([u]) => u === '/api/admin/stats')).toHaveLength(2);
    await act(async () => { release(); });
    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    await waitFor(() => expect(document.activeElement).toBe(metrics));
    expect(live).toHaveTextContent('Key metrics loaded.');
  });

  it('a failed Retry says so in the status line, keeps the Retry card and focus, and does not pull focus on a later reload', async () => {
    routes({ stats: () => reject(500) });
    const view = renderPage();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const live = screen.getByTestId('admin-load-status');
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(live).toHaveTextContent('Retry failed. Key metrics are still unavailable.'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBe(retry);
    expect(document.activeElement).toBe(retry);
    // a later successful reload by another path (a new user object re-runs the load) leaves focus alone
    routes();
    view.rerender(<MemoryRouter><Dashboard user={{ ...ADMIN }} onLogout={vi.fn()} /></MemoryRouter>);
    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    expect(document.activeElement).not.toBe(metrics);
  });

  it('recent activity: every cell chip carries a word, and a failed read does not read as "no activity"', async () => {
    routes();
    const first = renderPage();
    await screen.findByText('Key metrics');
    const table = screen.getByRole('table');
    const chips = [...table.querySelectorAll('.pu-chip')].map((c) => c.textContent.trim());
    expect(chips).toEqual(['LOGIN', '200 OK', 'TRANSFER_MONEY', '403 Error']);
    // rows the BFF recorded earlier are not something this page checked: neutral, never green; a recorded error stays red
    const toneOf = (word) => [...table.querySelectorAll('.pu-chip')].find((c) => c.textContent.trim() === word).className;
    expect(toneOf('200 OK')).toMatch(/pu-chip--neutral/);
    expect(toneOf('200 OK')).not.toMatch(/pu-chip--ok/);
    expect(toneOf('403 Error')).toMatch(/pu-chip--danger/);
    expect(table.querySelector('[style]')).toBeNull();
    first.unmount();

    routes({ activity: () => reject(500) });
    renderPage();
    expect(await screen.findByText('Recent activity could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No recent activity')).toBeNull();
  });

  it('Reset Demo asks for confirmation before it posts, and the page keeps its dialog', async () => {
    routes();
    mocks.post.mockResolvedValue({ data: {} });
    renderPage();
    await screen.findByText('Key metrics');
    fireEvent.click(screen.getByRole('button', { name: /Reset Demo/ }));
    expect(await screen.findByText('Reset Demo Accounts?')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset accounts' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/accounts/reset-all-demo'));
  });

  it('customer actions use aria-disabled with a visible reason, so a focused button is never dropped', async () => {
    routes();
    renderPage();
    await screen.findByText('Key metrics');
    const view = screen.getByRole('button', { name: 'View Profile' });
    expect(view.hasAttribute('disabled')).toBe(false);
    expect(view.getAttribute('aria-disabled')).toBe('true');
    const hint = document.getElementById(view.getAttribute('aria-describedby'));
    expect(hint).toHaveTextContent(/Search and select a customer/);
    view.focus();
    fireEvent.click(view); // no customer: ignored, no request
    expect(mocks.get.mock.calls.some(([u]) => u.includes('/api/admin/agent/users'))).toBe(false);
    expect(document.activeElement).toBe(view);
  });
});

describe('RequireAdminLogin around /admin', () => {
  it('a non-admin session never sees the dashboard, only the admin sign-in confirmation', () => {
    routes();
    render(
      <MemoryRouter>
        <RequireAdminLogin user={{ id: 'u', role: 'user' }}>
          <Dashboard user={{ id: 'u', role: 'user' }} onLogout={vi.fn()} />
        </RequireAdminLogin>
      </MemoryRouter>,
    );
    expect(screen.getByText('Admin sign-in required')).toBeInTheDocument();
    expect(document.querySelector('.admin-dashboard-page')).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Log in as admin' }));
    expect(mocks.startRoleSwitch).toHaveBeenCalledWith('admin', '/');
  });
});
