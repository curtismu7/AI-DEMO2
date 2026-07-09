/**
 * Smoke test for UseCaseLauncherPage (Plan A · A5 + A6).
 * Verifies:
 *   1. Loading state renders while fetch is pending.
 *   2. Track headings render once data loads.
 *   3. chip-type UC renders an enabled Run button.
 *   4. attack-type UC without runnable sim renders a disabled "coming in A6.2" button.
 *   5. Clicking Run on a chip UC POSTs the use case and navigates to /dashboard with state.
 *   6. OWASP badge renders for UCs with owasp data.
 *   A6:
 *   8. Runnable attack UC (insufficient-scope) renders an enabled Run button.
 *   9. Clicking Run on a runnable attack UC POSTs the normalized sim and renders the DENY result.
 *  10. wrong-aud-token sim is normalized to wrong-aud before POST.
 *  11. Non-runnable attack UC keeps the disabled "coming in A6.2" button.
 *  12. POST failure shows an error message.
 *   A5.3 additions:
 *   T6b. Gate notice + disabled Run for flag-gated UC when flag is OFF.
 *   T6c. Non-flag UC still has an enabled Run button.
 *   T6d. Clicking the toggle PATCHes the flag and enables Run.
 *   T6e. Flag-gated Run stays disabled while flags are loading.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import UseCaseLauncherPage from '../pages/UseCaseLauncherPage';

// Mock useNavigate (chip Run POSTs then navigates to /dashboard with state).
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

// Mock apiClient so no network calls fire in tests.
vi.mock('../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

// Mock useVertical — return 'banking' for activeId.
vi.mock('../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking' }),
}));

// VerticalSwitcher hits /api/verticals/list — stub as empty so the picker stays quiet in unit tests.
vi.mock('../components/VerticalSwitcher', () => ({
  default: function VerticalSwitcherStub() {
    return null;
  },
}));

// Import apiClient after mocking
import apiClient from '../services/apiClient';

const MOCK_USE_CASES = [
  {
    id: 'UC1',
    useCaseId: 'delegated-access-with-proof',
    track: 'foundations',
    title: 'Delegated access with proof',
    buyerStory: 'Buyer story for UC1.',
    pingOneSolution: 'PingOne solution.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'PERMIT',
    evidence: {},
    codeRefs: [],
    maturity: 'works',
    owasp: { threats: ['T8'], sections: ['§4.1.1'] },
    whatToSay: 'The agent acted for you.',
    advanced: false,
  },
  {
    id: 'UC2',
    useCaseId: 'a2a-delegation',
    track: 'foundations',
    title: 'A2A delegation',
    buyerStory: 'Generalist delegates to specialist via nested act chain.',
    pingOneSolution: 'RFC 8693 nested-act.',
    trigger: { type: 'chip', text: 'check sensitive_patient_records' },
    expectedOutcome: 'PERMIT with act-chain depth',
    evidence: {},
    codeRefs: [],
    maturity: 'flag:ff_a2a_delegation',
    owasp: {},
    whatToSay: 'Try A2A delegation.',
    advanced: false,
  },
  {
    id: 'UC11',
    useCaseId: 'bad-client-to-gateway',
    track: 'attacks',
    title: 'Bad client to agent gateway',
    buyerStory: 'Buyer story for UC11.',
    pingOneSolution: 'PingOne rejects.',
    trigger: { type: 'attack', sim: 'expired-token' },
    expectedOutcome: '401',
    evidence: {},
    codeRefs: [],
    maturity: 'works',
    owasp: { threats: ['T9'], sections: ['§8'] },
    whatToSay: 'Missing token — 401.',
    advanced: false,
  },
];

// Additional mocks for A6 attack sim tests
const UC_INSUFFICIENT_SCOPE = {
  id: 'UC12',
  useCaseId: 'insufficient-scope',
  track: 'attacks',
  title: 'Insufficient scope attack',
  buyerStory: 'Agent tries to call a tool it lacks scope for.',
  pingOneSolution: 'PingOne rejects.',
  trigger: { type: 'attack', sim: 'insufficient-scope' },
  expectedOutcome: '403',
  evidence: {},
  codeRefs: [],
  maturity: 'works',
  owasp: {},
  whatToSay: 'Scope denied.',
  advanced: false,
};

const UC_WRONG_AUD = {
  id: 'UC13',
  useCaseId: 'wrong-aud',
  track: 'attacks',
  title: 'Wrong audience token',
  buyerStory: 'Agent presents token with wrong aud claim.',
  pingOneSolution: 'PingOne rejects.',
  trigger: { type: 'attack', sim: 'wrong-aud-token' }, // catalog uses wrong-aud-token alias
  expectedOutcome: '401',
  evidence: {},
  codeRefs: [],
  maturity: 'works',
  owasp: {},
  whatToSay: 'Audience rejected.',
  advanced: false,
};

// Link-type UC (developer tool) — navigates to a page instead of running an agent.
const UC_LINK = {
  id: 'UC-TOOL1',
  useCaseId: 'code-search',
  track: 'tools',
  title: 'RAG code search',
  buyerStory: 'Semantic search across an indexed codebase.',
  pingOneSolution: 'n/a',
  trigger: { type: 'link', path: '/code-search', label: 'Open Code Search' },
  expectedOutcome: 'n/a',
  evidence: {},
  codeRefs: [],
  maturity: 'works',
  owasp: {},
  whatToSay: 'Open the code search tool.',
  advanced: false,
};

const SAMPLE_SIM_RESULT = {
  sim: 'insufficient-scope',
  status: 403,
  errorCode: 'insufficient_scope',
  reason: 'The agent token does not carry the required scope.',
  tokenChainEvents: [
    { label: 'User token issued', status: 'OK' },
    { label: 'Agent token exchanged', status: 'OK' },
    { label: 'Gateway scope check', status: 'DENY' },
  ],
  useCaseId: 'insufficient-scope',
};

function renderPage() {
  return render(
    <MemoryRouter>
      <UseCaseLauncherPage />
    </MemoryRouter>,
  );
}

describe('UseCaseLauncherPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockImplementation((url) => {
      if (url.includes('feature-flags')) {
        return Promise.resolve({
          data: {
            flags: [
              { id: 'ff_a2a_delegation', value: false },
              { id: 'ff_authorize_group_policy', value: false },
              { id: 'ff_dpop', value: false },
              { id: 'ff_rar', value: false },
              { id: 'ciba_enabled', value: false },
            ],
            categories: [],
          },
        });
      }
      return Promise.resolve({ data: { vertical: 'banking', useCases: MOCK_USE_CASES } });
    });
    apiClient.patch = vi.fn().mockResolvedValue({ data: { updated: true } });
  });

  it('shows loading state initially', () => {
    apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.getByText(/loading use cases/i)).toBeInTheDocument();
  });

  it('renders track headings after load', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Happy Paths/i)).toBeInTheDocument());
    expect(screen.getByText(/Attacks — malicious/i)).toBeInTheDocument();
  });

  it('renders an enabled Run button for chip-type UC', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /run/i });
    const chipBtn = buttons.find((b) => !b.disabled && !b.title?.includes('A6'));
    expect(chipBtn).toBeDefined();
    expect(chipBtn.disabled).toBe(false);
  });

  it('renders a disabled Run button for attack-type UC', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Bad client to agent gateway')).toBeInTheDocument());
    const disabledBtn = screen.getByRole('button', { name: /run.*A6/i });
    expect(disabledBtn.disabled).toBe(true);
  });

  it('clicking Run on a chip UC POSTs the use case and navigates to /dashboard with state', async () => {
    apiClient.post.mockResolvedValue({
      data: { useCaseId: 'delegated-access-with-proof', triggerText: 'show my balance', type: 'chip' },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /^run$/i });
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/use-cases/demo/run', {
        useCaseId: 'delegated-access-with-proof',
        vertical: 'banking',
      }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
        state: {
          useCaseId: 'delegated-access-with-proof',
          triggerText: 'show my balance',
          type: 'chip',
          vertical: 'banking',
        },
      }),
    );
  });

  it('renders an Open button for a link-type UC and navigates to its path', async () => {
    apiClient.get.mockResolvedValue({ data: { vertical: 'banking', useCases: [UC_LINK] } });
    renderPage();
    await waitFor(() => expect(screen.getByText('RAG code search')).toBeInTheDocument());
    const openBtn = screen.getByRole('button', { name: /open code search/i });
    expect(openBtn.disabled).toBe(false);
    fireEvent.click(openBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/code-search');
  });

  it('shows OWASP badge for UCs with owasp data', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('OWASP ASI').length).toBeGreaterThan(0));
  });

  // ── A6 attack sim tests ───────────────────────────────────────────────────

  it('renders an enabled Run button for a runnable attack UC (insufficient-scope)', async () => {
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [UC_INSUFFICIENT_SCOPE] },
    });
    apiClient.post.mockResolvedValue({ data: SAMPLE_SIM_RESULT });
    renderPage();
    await waitFor(() => expect(screen.getByText('Insufficient scope attack')).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /^run$/i });
    expect(btn.disabled).toBe(false);
    expect(btn.title).not.toMatch(/A6/i);
  });

  it('clicking Run on a runnable attack UC POSTs normalized sim and renders DENY result', async () => {
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [UC_INSUFFICIENT_SCOPE] },
    });
    apiClient.post.mockResolvedValue({ data: SAMPLE_SIM_RESULT });
    renderPage();
    await waitFor(() => expect(screen.getByText('Insufficient scope attack')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/demo/attack-sim/run', { sim: 'insufficient-scope' });

    await waitFor(() => expect(screen.getByText(/403 DENY/i)).toBeInTheDocument());
    expect(screen.getAllByText('insufficient_scope').length).toBeGreaterThan(0);
    expect(screen.getAllByText(SAMPLE_SIM_RESULT.reason).length).toBeGreaterThan(0);
    // Token chain events
    expect(screen.getByText('User token issued')).toBeInTheDocument();
    expect(screen.getByText('Gateway scope check')).toBeInTheDocument();
  });

  it('normalizes wrong-aud-token catalog sim to wrong-aud before POSTing', async () => {
    const wrongAudResult = { ...SAMPLE_SIM_RESULT, sim: 'wrong-aud', errorCode: 'invalid_aud' };
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [UC_WRONG_AUD] },
    });
    apiClient.post.mockResolvedValue({ data: wrongAudResult });
    renderPage();
    await waitFor(() => expect(screen.getByText('Wrong audience token')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/demo/attack-sim/run', { sim: 'wrong-aud' });

    // Wait for async state update to settle before the test tears down.
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  });

  it('non-runnable attack UC keeps disabled coming-in-A6.2 button', async () => {
    // UC11 has sim: 'expired-token' which is NOT in RUNNABLE_SIMS
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[2]] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Bad client to agent gateway')).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /A6/i });
    expect(btn.disabled).toBe(true);
  });

  it('shows error message when attack sim POST fails', async () => {
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [UC_INSUFFICIENT_SCOPE] },
    });
    apiClient.post.mockRejectedValue({ message: 'Network error' });
    renderPage();
    await waitFor(() => expect(screen.getByText('Insufficient scope attack')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));

    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument());
  });

  // T6b — gate notice renders for flag-gated UC when flag is OFF
  it('shows gate notice and disabled Run for flag-gated UC when flag is OFF', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('A2A delegation')).toBeInTheDocument());
    expect(screen.getAllByText(/ff_a2a_delegation/).length).toBeGreaterThan(0);
    const buttons = screen.getAllByRole('button', { name: /^run$/i });
    const disabledRunBtns = buttons.filter((b) => b.disabled && !b.title?.includes('A6'));
    expect(disabledRunBtns.length).toBeGreaterThan(0);
  });

  // T6c — non-flag UC is unaffected
  it('non-flag UC still has enabled Run button', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());
    const allBtns = screen.getAllByRole('button', { name: /^run$/i });
    const enabledRuns = allBtns.filter((b) => !b.disabled);
    expect(enabledRuns.length).toBeGreaterThan(0);
  });

  // T6d — toggling ON PATCHes the flag
  it('clicking the toggle PATCHes the flag and enables Run', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('A2A delegation')).toBeInTheDocument());
    const toggle = screen.getByRole('switch', { name: /Enable ff_a2a_delegation/i });
    fireEvent.click(toggle);
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/admin/feature-flags',
      { updates: { ff_a2a_delegation: true } }
    );
    await waitFor(() => {
      const allBtns = screen.getAllByRole('button', { name: /^run$/i });
      const runForUC2 = allBtns.find((b) => !b.disabled && !b.title?.includes('A6'));
      expect(runForUC2).toBeDefined();
    });
  });

  // T6e — default-safe: flags loading → flag-gated Run stays disabled
  it('flag-gated Run is disabled while flags are loading', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url.includes('feature-flags')) {
        return new Promise(() => {}); // never resolves = loading
      }
      return Promise.resolve({ data: { vertical: 'banking', useCases: MOCK_USE_CASES } });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('A2A delegation')).toBeInTheDocument());
    const allBtns = screen.getAllByRole('button', { name: /^run$/i });
    const disabledFlagBtns = allBtns.filter((b) => b.disabled && !b.title?.includes('A6'));
    expect(disabledFlagBtns.length).toBeGreaterThan(0);
  });
});
