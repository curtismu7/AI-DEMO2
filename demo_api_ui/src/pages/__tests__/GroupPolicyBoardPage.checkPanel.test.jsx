// The group-check panel on /group-policy: pick a user + vertical, run the real
// check, read the decision. The panel is a single-check counterpart of the
// board (which can only ask about the signed-in user) — its tests pin the
// contract the page promises: the picked user and vertical are what get sent,
// a DENY is shown as a deny with its reason, and a failed probe reads UNKNOWN,
// never PERMIT.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GroupPolicyBoardPage from '../GroupPolicyBoardPage';
import { VerticalContext } from '../../vertical/VerticalProvider';

vi.mock('../../components/GroupMembershipToggle', () => ({
  default: () => <div data-testid="membership-toggle" />,
}));

const PATCHES = [];
vi.mock('../../services/apiClient', () => ({
  default: {
    patch: vi.fn((url, body) => {
      PATCHES.push({ url, body });
      return Promise.resolve({ data: {} });
    }),
    get: vi.fn(() => Promise.resolve({ data: { flags: [] } })),
  },
}));

const BOARD = {
  username: 'demoUser',
  liveLookupReady: true,
  policyEnabled: true,
  rows: [
    {
      verticalId: 'banking', displayName: 'Banking', tool: 'get_sensitive_account_details',
      requiredGroup: 'Banking_PremiumTier', inRequiredGroup: true, decision: 'PERMIT',
      codes: ['mcp-tool-authorized'],
    },
  ],
};

const VERTICALS = [
  { id: 'airlines', displayName: 'Airline' },
  { id: 'banking', displayName: 'Banking' },
  { id: 'retail', displayName: 'Retail' },
];

const CHECK_DENY = {
  username: 'demoDelegate', verticalId: 'banking', displayName: 'Banking',
  requiredGroup: 'Banking_PremiumTier', userGroups: ['AI_Demo_Delegates'],
  inRequiredGroup: false, source: 'pingone', decision: 'DENY',
  denyReason: 'user_not_in_group', codes: ['mcp-authorization-denied', 'mcp-user-not-in-group'],
  gatedTool: 'get_sensitive_account_details',
  access: {
    label: 'Private Banking client',
    memberStory: 'demoUser is a tenured Private Banking client — the wealth tier was assigned at onboarding and is reviewed annually.',
    nonMemberStory: 'demoDelegate is a licensed advisor still in onboarding: Private Banking tier access lands only after the background check clears.',
  },
  policyEnabled: true, liveLookupReady: true, raw: { deny_reason: 'user_not_in_group' },
};

function fetchMock(handler) {
  return vi.fn((url) => {
    const u = String(url);
    if (u.startsWith('/api/verticals/list')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => VERTICALS });
    }
    if (u.startsWith('/api/groups/check')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => handler.check(u) });
    }
    if (u.startsWith('/api/groups/decision-board')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => BOARD });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

function renderPage(fetchFn) {
  global.fetch = fetchFn;
  return render(
    <MemoryRouter>
      <VerticalContext.Provider value={{ verticalId: 'banking' }}>
        <GroupPolicyBoardPage />
      </VerticalContext.Provider>
    </MemoryRouter>,
  );
}

describe('GroupPolicyBoardPage — group check panel', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('turns ff_authorize_group_policy ON on mount and OFF on unmount — the step cleans up after itself', async () => {
    const { unmount } = renderPage(fetchMock({ check: () => CHECK_DENY }));
    // The page step cannot demonstrate the group deciding while the flag is
    // off, so entering the page arms it (the demo step's own doing).
    await waitFor(() => expect(
      PATCHES.some((p) => p.body?.updates?.ff_authorize_group_policy === true),
    ).toBe(true));

    unmount();
    // Leaving the page restores the flag, so the demo leaves no surface changed.
    await waitFor(() => expect(
      PATCHES.some((p) => p.body?.updates?.ff_authorize_group_policy === false),
    ).toBe(true));
  });

  it('tells the vertical\'s access story: label + why this user is out (or in)', async () => {
    const check = vi.fn(() => CHECK_DENY);
    renderPage(fetchMock({ check }));
    await waitFor(() => expect(screen.getByText('Banking')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /run.*check/i }));
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('DENY'));

    // The story is per-vertical and says WHY this user is out — the presenter
    // reads it aloud in the vertical's own business language.
    expect(screen.getByTestId('check-access-label')).toHaveTextContent('Private Banking client');
    expect(screen.getByTestId('check-access-story')).toHaveTextContent(/demoDelegate is a licensed advisor/);
    expect(screen.getByTestId('check-access-story').textContent).not.toMatch(/demoUser is a tenured/);

    // In-group → the member story instead.
    const inGroup = { ...CHECK_DENY, inRequiredGroup: true, decision: 'PERMIT', denyReason: null };
    check.mockImplementation(() => inGroup);
    fireEvent.click(screen.getByRole('button', { name: /re-?run|run.*check/i }));
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('PERMIT'));
    expect(screen.getByTestId('check-access-story')).toHaveTextContent(/demoUser is a tenured/);
  });

  it('sends the picked username and vertical when Run is pressed and shows the decision', async () => {
    const check = vi.fn(() => CHECK_DENY);
    renderPage(fetchMock({ check }));
    // The board renders first.
    await waitFor(() => expect(screen.getByText('Banking')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/user/i), { target: { value: 'demoDelegate' } });
    fireEvent.click(screen.getByRole('button', { name: /run.*check/i }));

    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('DENY'));
    expect(check).toHaveBeenCalledTimes(1);
    const called = new URL(check.mock.calls[0][0], 'http://x');
    expect(called.searchParams.get('username')).toBe('demoDelegate');
    expect(called.searchParams.get('verticalId')).toBe('banking');
    // The deny says why.
    expect(screen.getByTestId('check-reason')).toHaveTextContent('user_not_in_group');
  });

  it('renders UNKNOWN — never PERMIT — when the probe fails', async () => {
    const check = vi.fn(() => ({
      ...CHECK_DENY, decision: 'UNKNOWN', denyReason: null, codes: [],
      error: 'PingOne unreachable',
    }));
    renderPage(fetchMock({ check }));
    await waitFor(() => expect(screen.getByText('Banking')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /run.*check/i }));
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('UNKNOWN'));
    expect(screen.getByTestId('check-decision').textContent).not.toMatch(/PERMIT/);
  });

  it('names the board\'s subject — the signed-in user — so its verdict is not confused with the picked user\'s', async () => {
    // Seen live 2026-10-12: panel DENY for demoDelegate (picked) next to a
    // board PERMIT for the signed-in demoUser read as a contradiction. The
    // board must say WHO it is asking about.
    renderPage(fetchMock({ check: () => CHECK_DENY }));
    await waitFor(() => expect(screen.getByTestId('board-subject')).toBeTruthy());
    expect(screen.getByTestId('board-subject')).toHaveTextContent('demoUser');
  });

  it('adds the picked user to the group, then re-runs the check against the live directory', async () => {
    // The check first answers DENY (user out of the group); after the toggle
    // it must re-run and answer PERMIT — the transition IS the demo.
    const checks = [
      CHECK_DENY,
      { ...CHECK_DENY, inRequiredGroup: true, decision: 'PERMIT', denyReason: null,
        userGroups: ['Banking_PremiumTier'], codes: ['mcp-tool-authorized'] },
    ];
    const check = vi.fn(() => checks[Math.min(check.mock.calls.length - 1, checks.length - 1)]);
    const toggles = [];
    const boardUrls = [];
    const fetchFn = (url, opts) => {
      const u = String(url);
      if (u.startsWith('/api/verticals/list')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => VERTICALS });
      }
      if (u.startsWith('/api/groups/check/toggle')) {
        toggles.push({ url: u, body: JSON.parse(opts?.body || '{}') });
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ username: 'demoDelegate', groupName: 'Banking_PremiumTier',
            requested: true, inGroup: true, verified: true, verticalId: 'banking',
            displayName: 'Banking' }),
        });
      }
      if (u.startsWith('/api/groups/check')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => check(u) });
      }
      if (u.startsWith('/api/groups/decision-board')) {
        boardUrls.push(u);
        return Promise.resolve({ ok: true, status: 200, json: async () => BOARD });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    };
    renderPage(fetchFn);
    await waitFor(() => expect(screen.getByText('Banking')).toBeTruthy());
    // The picker scopes the board to ONE vertical decision, not ~13.
    expect(boardUrls.length).toBeGreaterThanOrEqual(1);
    expect(new URL(boardUrls[0], 'http://x').searchParams.get('verticalId')).toBe('banking');

    // Run once → DENY. Then add to group.
    fireEvent.click(screen.getByRole('button', { name: /run.*check/i }));
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('DENY'));

    fireEvent.click(screen.getByRole('button', { name: /add to/i }));
    await waitFor(() => expect(toggles.length).toBe(1));
    expect(toggles[0].body).toEqual({ inGroup: true, username: 'demoDelegate', verticalId: 'banking' });

    // The panel re-runs the check on its own after the write, against the
    // post-write directory: PERMIT.
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('PERMIT'));
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('removes the picked user from the group when the check shows them in', async () => {
    const check = vi.fn(() => ({
      ...CHECK_DENY, inRequiredGroup: true, decision: 'PERMIT', denyReason: null,
      userGroups: ['Banking_PremiumTier'],
    }));
    const toggles = [];
    const fetchFn = (url, opts) => {
      const u = String(url);
      if (u.startsWith('/api/verticals/list')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => VERTICALS });
      }
      if (u.startsWith('/api/groups/check/toggle')) {
        toggles.push(JSON.parse(opts?.body || '{}'));
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ username: 'demoDelegate', groupName: 'Banking_PremiumTier',
            requested: false, inGroup: false, verified: true, verticalId: 'banking',
            displayName: 'Banking' }),
        });
      }
      if (u.startsWith('/api/groups/check')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => check(u) });
      }
      if (u.startsWith('/api/groups/decision-board')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => BOARD });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    };
    renderPage(fetchFn);
    await waitFor(() => expect(screen.getByText('Banking')).toBeTruthy());

    // The toggle lives on the check result, so run the check first — the same
    // order the presenter follows.
    fireEvent.click(screen.getByRole('button', { name: /run.*check/i }));
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('PERMIT'));

    fireEvent.click(screen.getByRole('button', { name: /remove from/i }));
    await waitFor(() => expect(toggles.length).toBe(1));
    expect(toggles[0]).toEqual({ inGroup: false, username: 'demoDelegate', verticalId: 'banking' });
    // The check re-ran after the write.
    await waitFor(() => expect(check.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
