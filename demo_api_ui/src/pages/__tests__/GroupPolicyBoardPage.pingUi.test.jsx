// /group-policy on the Ping UI Standard: banner first and honest to the mode, one primary button in every state,
// chips that carry a word, buttons that keep focus while they work, live regions mounted before their text changes.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GroupPolicyBoardPage from '../GroupPolicyBoardPage';
import { VerticalContext } from '../../vertical/VerticalProvider';

vi.mock('../../components/GroupMembershipToggle', () => ({ default: () => <div data-testid="membership-toggle" /> }));
vi.mock('../../services/apiClient', () => ({
  default: { patch: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(() => Promise.resolve({ data: { flags: [] } })) },
}));

const ROW = {
  verticalId: 'banking', displayName: 'Banking', tool: 'get_sensitive_account_details',
  requiredGroup: 'Banking_PremiumTier', inRequiredGroup: true, decision: 'PERMIT', codes: ['mcp-tool-authorized'],
};
const BOARD = { username: 'demoUser', liveLookupReady: true, policyEnabled: true, rows: [ROW] };
const CHECK = {
  username: 'demoDelegate', verticalId: 'banking', displayName: 'Banking', requiredGroup: 'Banking_PremiumTier',
  inRequiredGroup: false, source: 'pingone', decision: 'DENY', denyReason: 'user_not_in_group',
  codes: ['mcp-authorization-denied'], policyEnabled: true, liveLookupReady: true,
};

function json(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body });
}

function setup({ board = () => json(BOARD), check = () => json(CHECK), toggle = () => json({}) } = {}) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.startsWith('/api/verticals/list')) return json([{ id: 'banking', displayName: 'Banking' }]);
    if (u.startsWith('/api/groups/check/toggle')) return toggle(u);
    if (u.startsWith('/api/groups/check')) return check(u);
    if (u.startsWith('/api/groups/decision-board')) return board(u);
    return json({}, false, 404);
  });
  return render(
    <MemoryRouter>
      <VerticalContext.Provider value={{ verticalId: 'banking' }}>
        <GroupPolicyBoardPage />
      </VerticalContext.Provider>
    </MemoryRouter>,
  );
}

const primaries = (container) => [...container.querySelectorAll('button.pu-btn--primary')].map((b) => b.textContent.trim());

describe('GroupPolicyBoardPage — Ping UI Standard', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('puts the note banner first inside the page root', async () => {
    const { container } = setup();
    const root = container.querySelector('.pu-page.gpb-page');
    expect(root).not.toBeNull();
    const banner = screen.getByTestId('gpb-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(root.querySelector('.pu-banner-wrap')).toBe(root.firstElementChild);
    await waitFor(() => expect(banner).toHaveTextContent(/LIVE DECISIONS/));
  });

  it('words the banner from what the board read returned, not from fixed text', async () => {
    // Before anything has come back: nothing has been checked.
    let release;
    const first = setup({ board: () => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => BOARD }); }) });
    expect(screen.getByTestId('gpb-banner')).toHaveTextContent(/READING THE BOARD/);
    expect(screen.getByTestId('gpb-banner').textContent).not.toMatch(/LIVE DECISIONS|read from the PingOne directory/);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('gpb-banner')).toHaveTextContent(/LIVE DECISIONS/));
    first.unmount();

    // Worker credentials missing: membership is declared, and the banner says so.
    const manifest = setup({ board: () => json({ ...BOARD, liveLookupReady: false, rows: [{ ...ROW, source: 'manifest' }] }) });
    await waitFor(() => expect(screen.getByTestId('gpb-banner')).toHaveTextContent(/MEMBERSHIP DECLARED/));
    expect(screen.getByTestId('gpb-banner').textContent).not.toMatch(/LIVE DECISIONS/);
    expect(screen.getByTestId('gpb-manifest-note')).toBeTruthy();
    manifest.unmount();

    // A failed read: no verdict is claimed either way.
    setup({ board: () => json({}, false, 500) });
    await waitFor(() => expect(screen.getByTestId('gpb-banner')).toHaveTextContent(/BOARD UNAVAILABLE/));
    expect(screen.getByTestId('gpb-banner').textContent).not.toMatch(/LIVE DECISIONS/);
    expect(screen.getByTestId('gpb-board-status')).toHaveTextContent(/Unavailable/);
  });

  it('says when the policy flag is off', async () => {
    setup({ board: () => json({ ...BOARD, policyEnabled: false }) });
    await waitFor(() => expect(screen.getByTestId('gpb-banner')).toHaveTextContent(/ff_authorize_group_policy is OFF right now/));
  });

  it('has exactly one primary button, Run check, before a check, with a result, and after a failed check', async () => {
    const check = vi.fn(() => json(CHECK));
    const { container } = setup({ check });
    await waitFor(() => expect(screen.getByTestId('gpb-board-status')).toHaveTextContent(/Loaded/));
    expect(primaries(container)).toEqual(['Run check']);

    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('DENY'));
    expect(primaries(container)).toEqual(['Run check']);
    // The Add / Remove write control and Re-check are secondaries.
    expect(screen.getByTestId('gpb-check-toggle').className).not.toMatch(/primary/);
    expect(screen.getByTestId('gpb-refresh').className).not.toMatch(/primary/);

    check.mockImplementation(() => json({ message: 'boom' }, false, 500));
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Check failed/));
    expect(primaries(container)).toEqual(['Run check']);
  });

  it('every chip carries a word, including the decision on the board and the result', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByTestId('gpb-board-status')).toHaveTextContent(/Loaded/));
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('DENY'));
    const chips = [...container.querySelectorAll('.pu-chip')];
    expect(chips.length).toBeGreaterThan(3);
    chips.forEach((c) => expect(c.textContent.trim().length).toBeGreaterThan(0));
    // The board row's decision is a chip, and the tally says permit / deny in words.
    expect(container.querySelector('.gpb-table .pu-chip--ok')).toHaveTextContent('PERMIT');
    expect(container).toHaveTextContent(/1 permit/);
    expect(container).toHaveTextContent(/0 deny/);
  });

  it('keeps keyboard focus on Run check while it works, ignores a second click, and keeps the label', async () => {
    let release;
    const check = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => CHECK }); }));
    setup({ check });
    await waitFor(() => expect(screen.getByTestId('gpb-board-status')).toHaveTextContent(/Loaded/));
    const status = screen.getByTestId('gpb-check-status'); // mounted before its text changes
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('');

    const run = screen.getByRole('button', { name: 'Run check' });
    run.focus();
    fireEvent.click(run);
    await waitFor(() => expect(run.getAttribute('aria-disabled')).toBe('true'));
    expect(run.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(run);
    expect(run).toHaveTextContent('Run check');
    expect(screen.getByTestId('gpb-check-status')).toHaveTextContent(/Asking for the decision/);
    fireEvent.click(run);
    expect(check).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('DENY'));
    expect(run.getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(run);
  });

  it('keeps focus on the Add / Remove button through the write and the re-check', async () => {
    const checks = [CHECK, { ...CHECK, inRequiredGroup: true, decision: 'PERMIT', denyReason: null }];
    const check = vi.fn(() => json(checks[Math.min(check.mock.calls.length - 1, 1)]));
    let release;
    const toggle = vi.fn(() => new Promise((r) => {
      release = () => r({ ok: true, status: 200, json: async () => ({ username: 'demoDelegate', groupName: 'Banking_PremiumTier', requested: true, inGroup: true, verified: true }) });
    }));
    setup({ check, toggle });
    await waitFor(() => expect(screen.getByTestId('gpb-board-status')).toHaveTextContent(/Loaded/));
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('DENY'));

    const add = screen.getByRole('button', { name: /add to banking_premiumtier/i });
    add.focus();
    fireEvent.click(add);
    await waitFor(() => expect(add.getAttribute('aria-disabled')).toBe('true'));
    expect(document.activeElement).toBe(add);
    expect(add).toHaveTextContent('Add to Banking_PremiumTier'); // label does not change while applying
    expect(screen.getByText(/Applying the change in PingOne/)).toBeTruthy();
    fireEvent.click(add);
    expect(toggle).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('check-decision')).toHaveTextContent('PERMIT'));
    const same = screen.getByRole('button', { name: /remove from banking_premiumtier/i });
    expect(same).toBe(add); // same element, so focus was never dropped
    expect(document.activeElement).toBe(add);
  });

  it('keeps the board mounted during Re-check and keeps focus on the button', async () => {
    let release;
    const board = vi.fn()
      .mockImplementationOnce(() => json(BOARD))
      .mockImplementation(() => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => BOARD }); }));
    setup({ board });
    await waitFor(() => expect(screen.getByTestId('gpb-board-status')).toHaveTextContent(/Loaded/));
    const refresh = screen.getByTestId('gpb-refresh');
    refresh.focus();
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh.getAttribute('aria-disabled')).toBe('true'));
    expect(document.activeElement).toBe(refresh);
    expect(screen.getByTestId('gpb-board-status')).toHaveTextContent(/Refreshing/);
    expect(screen.getByRole('region', { name: 'Decision table' })).toBeTruthy(); // rows stay while reloading
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('gpb-board-status')).toHaveTextContent(/Loaded/));
  });

  it('dark mode is a secondary with a stable name and aria-pressed', async () => {
    setup();
    const t = screen.getByTestId('gpb-theme-toggle');
    expect(t.className).toMatch(/pu-btn/);
    expect(t.className).not.toMatch(/primary/);
    expect(t).toHaveTextContent('Dark mode');
    expect(t.getAttribute('aria-pressed')).toBe('false');
  });
});
