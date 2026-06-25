/* eslint-disable testing-library/no-unnecessary-act */
/* eslint-disable testing-library/no-node-access */
/* eslint-disable testing-library/no-render-in-setup */
/* eslint-disable testing-library/prefer-find-by */
/* eslint-disable testing-library/no-wait-for-multiple-assertions */
/* eslint-disable testing-library/no-wait-for-side-effects */
/* eslint-disable testing-library/no-container */
// banking_api_ui/src/components/__tests__/DelegatedAccessPage.test.js
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DelegatedAccessPage from '../DelegatedAccessPage';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../utils/appToast', () => ({
  notifySuccess: jest.fn(),
  notifyInfo:    jest.fn(),
}));

vi.mock('../../styles/appShellPages.css', () => ({}), { virtual: true });
vi.mock('../DelegatedAccessPage.css',      () => ({}), { virtual: true });

/** RFC 8693 exchange chain returned by POST /api/mcp/tool */
const MOCK_TOKEN_EVENTS = [
  {
    id:            'user-token',
    label:         'User access token',
    status:        'active',
    timestamp:     new Date().toISOString(),
    explanation:   'User access token stored in BFF session.',
    claims:        { sub: 'user-123', aud: 'banking', scope: 'read', may_act: { client_id: 'bff' } },
    alg:           'RS256',
    jwtFullDecode: { header: { alg: 'RS256' }, claims: { sub: 'user-123' } },
  },
  {
    id:          'exchange-required',
    label:       'Exchange Required',
    status:      'acquiring',
    timestamp:   new Date().toISOString(),
    explanation: 'RFC 8693 exchange needed to produce narrowed MCP token.',
    claims:      null,
  },
  {
    id:              'exchanged-token',
    label:           'MCP access token (delegated) → MCP server',
    status:          'exchanged',
    timestamp:       new Date().toISOString(),
    explanation:     'Narrowed MCP token with act claim proving delegation.',
    exchangeRequest: 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange\nsubject_token=<user_token>\nactor_token=<bff_creds>\nscope=read',
    claims:          { sub: 'user-123', aud: 'banking_mcp', scope: 'read', act: { sub: 'bff-client' } },
    alg:             'RS256',
  },
];

/** Helper — renders page inside a router. */
function renderPage() {
  const user = { username: 'bankuser', name: 'Bank User', role: 'customer' };
  return render(
    <MemoryRouter>
      <DelegatedAccessPage user={user} onLogout={jest.fn()} />
    </MemoryRouter>
  );
}

/** Shared fetch mock that returns MOCK_TOKEN_EVENTS. */
function mockFetchSuccess() {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: {}, tokenEvents: MOCK_TOKEN_EVENTS }),
    })
  );
}

// ── TokenExchangeSimulator ────────────────────────────────────────────────────

describe('TokenExchangeSimulator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchSuccess();
  });
  afterEach(() => { delete global.fetch; });

  /** Open the simulator and wait until loading is done. */
  async function openSimulator() {
    renderPage();
    const actAsButtons = await screen.findAllByRole('button', { name: /act as/i });
    await act(async () => { fireEvent.click(actAsButtons[0]); });
    // Wait for the dialog to appear
    await waitFor(() =>
      screen.getByRole('dialog', { name: /token exchange simulator/i })
    );
  }

  it('opens the simulator dialog when "Act as" is clicked', async () => {
    await openSimulator();
    expect(screen.getByRole('dialog', { name: /token exchange simulator/i })).toBeInTheDocument();
  });

  it('fires POST /api/mcp/tool immediately on open', async () => {
    await openSimulator();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/mcp/tool',
      expect.objectContaining({
        method:      'POST',
        credentials: 'include',
        body:        JSON.stringify({ tool: 'get_my_accounts', params: {} }),
      })
    );
  });

  it('renders all token chain step labels in the left column', async () => {
    await openSimulator();
    // Each label appears in the da-sim-row__label spans (left chain)
    const dialog = screen.getByRole('dialog', { name: /token exchange simulator/i });
    const chainCol = dialog.querySelector('.da-sim__chain');
    expect(within(chainCol).getByText('User access token')).toBeInTheDocument();
    expect(within(chainCol).getByText('Exchange Required')).toBeInTheDocument();
    expect(within(chainCol).getByText('MCP access token (delegated) → MCP server')).toBeInTheDocument();
  });

  it('auto-selects user-token and shows may_act claim in right panel', async () => {
    await openSimulator();
    // may_act claim key should be visible in the claims list
    const dialog = screen.getByRole('dialog', { name: /token exchange simulator/i });
    const detailCol = dialog.querySelector('.da-sim__detail-col');
    await waitFor(() =>
      expect(within(detailCol).getByText('may_act')).toBeInTheDocument()
    );
  });

  it('switches right panel when a different chain row is clicked', async () => {
    await openSimulator();
    const dialog = screen.getByRole('dialog', { name: /token exchange simulator/i });
    const chainCol = dialog.querySelector('.da-sim__chain');

    // Click the MCP access token row
    await act(async () => {
      fireEvent.click(within(chainCol).getByText('MCP access token (delegated) → MCP server'));
    });

    // Right panel should now show the API call section and act claim
    const detailCol = dialog.querySelector('.da-sim__detail-col');
    await waitFor(() => {
      expect(within(detailCol).getByText(/Token Exchange API Call/i)).toBeInTheDocument();
      expect(within(detailCol).getByText('act')).toBeInTheDocument();
    });
  });

  it('shows the POST /as/token body (grant_type) in the right detail panel', async () => {
    await openSimulator();
    const dialog = screen.getByRole('dialog', { name: /token exchange simulator/i });
    const chainCol = dialog.querySelector('.da-sim__chain');

    await act(async () => {
      fireEvent.click(within(chainCol).getByText('MCP access token (delegated) → MCP server'));
    });

    await waitFor(() => {
      expect(screen.getByText(/grant_type=urn:ietf:params:oauth:grant-type:token-exchange/i)).toBeInTheDocument();
    });
  });

  it('shows an error message when the fetch rejects', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
    await openSimulator();
    await waitFor(() =>
      expect(screen.getByText(/Network error/i)).toBeInTheDocument()
    );
  });

  it('shows an informational message when tokenEvents is empty', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ result: {}, tokenEvents: [] }),
      })
    );
    await openSimulator();
    await waitFor(() =>
      expect(screen.getByText(/No token events returned/i)).toBeInTheDocument()
    );
  });

  it('re-runs fetch when the retry button is clicked', async () => {
    await openSimulator();
    // Wait for first load
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const retryBtn = screen.getByTitle(/re-run exchange/i);
    await act(async () => { fireEvent.click(retryBtn); });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('closes the simulator when × is clicked', async () => {
    await openSimulator();
    const closeBtn = screen.getByRole('button', { name: /close/i });
    await act(async () => { fireEvent.click(closeBtn); });
    expect(screen.queryByRole('dialog', { name: /token exchange simulator/i })).not.toBeInTheDocument();
  });

  it('toggles the Full JWT block when the toggle button is clicked', async () => {
    await openSimulator();
    // user-token is auto-selected and has jwtFullDecode
    const toggleBtn = await screen.findByText(/Full JWT/i);
    await act(async () => { fireEvent.click(toggleBtn); });
    // RS256 from the header should now be in the pre block
    await waitFor(() =>
      expect(screen.getByText(/"alg"/)).toBeInTheDocument()
    );
  });
});

// ── Core page structure ───────────────────────────────────────────────────────

describe('DelegatedAccessPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // fetch is never auto-triggered on the page itself (only when simulator opens)
  });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /delegated access/i })).toBeInTheDocument();
  });

  it('renders the "Access I\'ve granted" tab', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /access i've granted/i })).toBeInTheDocument();
  });

  it('renders the "Granted to me" tab', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /granted to me/i })).toBeInTheDocument();
  });

  it('renders the "+ Add person" button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /add person/i })).toBeInTheDocument();
  });

  it('opens the AddDelegateModal when "+ Add person" is clicked', async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add person/i }));
    });
    expect(screen.getByRole('dialog', { name: /add delegation/i })).toBeInTheDocument();
  });

  it('switches to "Granted to me" tab and still shows "Act as" buttons', async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /granted to me/i }));
    });
    const actButtons = await screen.findAllByRole('button', { name: /act as/i });
    expect(actButtons.length).toBeGreaterThan(0);
  });
});
