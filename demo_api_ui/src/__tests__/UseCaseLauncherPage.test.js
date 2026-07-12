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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const mockOpenEdu = vi.fn();
vi.mock('../context/EducationUIContext', () => ({
  useEducationUI: () => ({ open: mockOpenEdu, close: vi.fn(), panel: null, tab: null }),
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
  id: 'UC-ATTACK-SCOPE',
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
  id: 'UC-ATTACK-AUD',
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

// Demo-track mock for search + Progressive Trust Demo strip interaction tests.
// id 'UC24' is not a DEMO_USE_CASE_IDS member, so it never duplicates into Demo.
const UC_DEMO_ACT1 = {
  id: 'UC24',
  useCaseId: 'progressive-trust-public-access',
  track: 'demo',
  title: 'Act 1 — Public catalog access',
  buyerStory: 'Users should explore low-risk information before signing in.',
  pingOneSolution: 'PingOne Authorize PERMITs a read-only public tool with no token exchange.',
  trigger: { type: 'chip', text: 'What branches are near me?' },
  expectedOutcome: 'PERMIT',
  evidence: {},
  codeRefs: [],
  maturity: 'works',
  owasp: {},
  whatToSay: 'Low-friction first.',
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
    // UC1 now renders in both the Demo section and Happy Path (no cross-section
    // dedup) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole('button', { name: /run/i });
    const chipBtn = buttons.find((b) => !b.disabled && !b.title?.includes('A6'));
    expect(chipBtn).toBeDefined();
    expect(chipBtn.disabled).toBe(false);
  });

  it('renders a disabled Run button for attack-type UC', async () => {
    renderPage();
    // UC11 now renders in both the Demo section and the Attacks track (no
    // cross-section dedup) — scope the button query to the Attacks section.
    await waitFor(() => expect(screen.getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0));
    const attacksHeading = screen.getByRole('heading', { level: 2, name: /Attacks — malicious/i });
    const attacksSection = attacksHeading.closest('section');
    const disabledBtn = within(attacksSection).getByRole('button', { name: /run.*A6/i });
    expect(disabledBtn.disabled).toBe(true);
  });

  it('clicking Run on a chip UC POSTs the use case and navigates to /dashboard with state', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/api/use-cases/demo/run') {
        return Promise.resolve({
          data: { useCaseId: 'delegated-access-with-proof', triggerText: 'show my balance', type: 'chip' },
        });
      }
      if (url === '/api/verticals/active') {
        return Promise.resolve({ data: { success: true } });
      }
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    });
    renderPage();
    // UC1 now renders in both the Demo section and Happy Path (no cross-section
    // dedup) — assert presence, not a single occurrence. buttons[0] still
    // resolves to a UC1 card either way, since both copies share the same
    // onRun handler and produce the identical POST call below.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole('button', { name: /^run$/i });
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/use-cases/demo/run', {
        useCaseId: 'delegated-access-with-proof',
        vertical: 'banking',
      }),
    );
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/verticals/active', { id: 'banking' }),
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
    // UC11 has sim: 'expired-token' which is NOT in RUNNABLE_SIMS. UC11 is also
    // a Demo-script id, so with useCases: [MOCK_USE_CASES[2]] alone its card
    // renders twice on the page (Attacks section + Demo section, no dedup) —
    // scope the button query to the Attacks section.
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[2]] },
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0));
    const attacksHeading = screen.getByRole('heading', { level: 2, name: /Attacks — malicious/i });
    const attacksSection = attacksHeading.closest('section');
    const btn = within(attacksSection).getByRole('button', { name: /A6/i });
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
    // UC2 now renders in both the Demo section and Foundations (no cross-section
    // dedup) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/ff_a2a_delegation/).length).toBeGreaterThan(0);
    const buttons = screen.getAllByRole('button', { name: /^run$/i });
    const disabledRunBtns = buttons.filter((b) => b.disabled && !b.title?.includes('A6'));
    expect(disabledRunBtns.length).toBeGreaterThan(0);
  });

  // T6c — non-flag UC is unaffected
  it('non-flag UC still has enabled Run button', async () => {
    renderPage();
    // UC1 now renders in both the Demo section and Happy Path (no cross-section
    // dedup) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));
    const allBtns = screen.getAllByRole('button', { name: /^run$/i });
    const enabledRuns = allBtns.filter((b) => !b.disabled);
    expect(enabledRuns.length).toBeGreaterThan(0);
  });

  // T6d — toggling ON PATCHes the flag
  it('clicking the toggle PATCHes the flag and enables Run', async () => {
    renderPage();
    // UC2 now renders in both the Demo section and Foundations (no cross-section
    // dedup), so two identical flag toggles exist — clicking either produces
    // the same PATCH, since flag state is global, not per-card. Click the first.
    await waitFor(() => expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0));
    const toggles = screen.getAllByRole('switch', { name: /Enable ff_a2a_delegation/i });
    fireEvent.click(toggles[0]);
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
    // UC2 now renders in both the Demo section and Foundations (no cross-section
    // dedup) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0));
    const allBtns = screen.getAllByRole('button', { name: /^run$/i });
    const disabledFlagBtns = allBtns.filter((b) => b.disabled && !b.title?.includes('A6'));
    expect(disabledFlagBtns.length).toBeGreaterThan(0);
  });

  // ── Happy Path grouping ─────────────────────────────────────────────────
  it('renders a Happy Path section above track sections containing only PERMIT-outcome use cases, deduped from their track', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Happy Paths — successful outcomes/i)).toBeInTheDocument());

    // The Demo section (Task 2) now renders first, above Happy Path — check
    // relative order rather than assuming Happy Path is the first heading.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const demoIdx = headings.findIndex((h) => /Demo — a scripted walkthrough/i.test(h));
    const happyPathIdx = headings.findIndex((h) => /Happy Paths — successful outcomes/i.test(h));
    const foundationsIdx = headings.findIndex((h) => /^Foundations/i.test(h));
    expect(demoIdx).toBe(0);
    expect(happyPathIdx).toBeGreaterThan(demoIdx);
    expect(foundationsIdx).toBeGreaterThan(happyPathIdx);

    // UC1 (expectedOutcome: 'PERMIT') is also Demo script step 1 — it renders
    // once in Demo and once in Happy Path (no cross-section dedup between the
    // two), and is still excluded from Foundations (dedup is only between
    // Happy Path and track sections, unaffected by Demo membership).
    expect(screen.getAllByText('Delegated access with proof')).toHaveLength(2);

    // UC2's outcome is 'PERMIT with act-chain depth', not an exact 'PERMIT' match,
    // so it stays in its original Foundations section, not Happy Path.
    const foundationsHeading = screen.getByRole('heading', { level: 2, name: /^Foundations/i });
    const foundationsSection = foundationsHeading.closest('section');
    expect(within(foundationsSection).getByText('A2A delegation')).toBeInTheDocument();
  });

  it('does not render a Happy Path section when no use case has a PERMIT outcome', async () => {
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [UC_INSUFFICIENT_SCOPE, UC_WRONG_AUD] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Insufficient scope attack')).toBeInTheDocument());
    expect(screen.queryByText(/Happy Paths — successful outcomes/i)).not.toBeInTheDocument();
  });

  // ── Demo section ─────────────────────────────────────────────────────────
  it('renders a Demo section first, above Happy Path, with cards in script order regardless of input order', async () => {
    // Deliberately out of DEMO_USE_CASE_IDS order (UC11 first) to prove the
    // section renders by script order, not by input array order.
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[2], MOCK_USE_CASES[0], MOCK_USE_CASES[1]] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const demoIdx = headings.findIndex((h) => /Demo — a scripted walkthrough/i.test(h));
    const happyPathIdx = headings.findIndex((h) => /Happy Paths — successful outcomes/i.test(h));
    expect(demoIdx).toBe(0);
    expect(happyPathIdx).toBeGreaterThan(demoIdx);

    const demoSection = screen.getByRole('heading', { level: 2, name: /Demo — a scripted walkthrough/i }).closest('section');
    const demoCardIds = within(demoSection).getAllByText(/^UC(1|2|11)$/).map((el) => el.textContent);
    expect(demoCardIds).toEqual(['UC1', 'UC2', 'UC11']);
  });

  it('shows the correct 1-based script step number on each Demo card', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());
    const demoSection = screen.getByRole('heading', { level: 2, name: /Demo — a scripted walkthrough/i }).closest('section');
    // UC1, UC2, UC11 are DEMO_USE_CASE_IDS[0], [1], [9] → Step 1, Step 2, Step 10.
    expect(within(demoSection).getByText('Step 1')).toBeInTheDocument();
    expect(within(demoSection).getByText('Step 2')).toBeInTheDocument();
    expect(within(demoSection).getByText('Step 10')).toBeInTheDocument();
  });

  it('a use case in both Demo and Happy Path renders once per section, not deduped', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());
    // UC1 qualifies for both Demo (script step 1) and Happy Path (PERMIT) — no
    // cross-section dedup, so it renders twice total.
    expect(screen.getAllByText('Delegated access with proof')).toHaveLength(2);
  });

  it('a flag-gated Demo step shows the gate UI', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());
    const demoSection = screen.getByRole('heading', { level: 2, name: /Demo — a scripted walkthrough/i }).closest('section');
    // UC2 (Step 2) is maturity 'flag:ff_a2a_delegation'. Use an exact string
    // match (not a regex) — the card also renders a "Flag-gated:
    // ff_a2a_delegation" maturity badge that a loose regex would also match,
    // which is unrelated to Demo/Happy-Path duplication.
    expect(within(demoSection).getByText('ff_a2a_delegation')).toBeInTheDocument();
  });

  it('does not render a Demo section when none of its script ids are present', async () => {
    apiClient.get.mockResolvedValue({ data: { vertical: 'banking', useCases: [UC_LINK] } });
    renderPage();
    await waitFor(() => expect(screen.getByText('RAG code search')).toBeInTheDocument());
    expect(screen.queryByText(/Demo — a scripted walkthrough/i)).not.toBeInTheDocument();
  });

  // ── Search ───────────────────────────────────────────────────────────────
  it('search filters cards across Demo, Happy Path, and track sections by title', async () => {
    renderPage();
    // UC1 and UC11 are both DEMO_USE_CASE_IDS members, so with the default
    // MOCK_USE_CASES fixture each renders twice pre-search (Demo + its other
    // section) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0);

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'delegated access' } });

    // Only UC1 matches — it still renders twice (Demo + Happy Path, no dedup
    // between those two), but UC11 and UC2 are fully filtered out everywhere.
    expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0);
    expect(screen.queryByText('Bad client to agent gateway')).not.toBeInTheDocument();
    expect(screen.queryByText('A2A delegation')).not.toBeInTheDocument();
    // Attacks section had its only match filtered out — its heading disappears too.
    expect(screen.queryByText(/Attacks — malicious/i)).not.toBeInTheDocument();
  });

  it('search matches by useCaseId substring', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'a2a-delegation' } });

    // UC2 matches by useCaseId and still renders twice (Demo + Foundations).
    expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0);
    expect(screen.queryByText('Delegated access with proof')).not.toBeInTheDocument();
  });

  it('search matches by trigger text substring', async () => {
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[0], UC_INSUFFICIENT_SCOPE] },
    });
    renderPage();
    // UC_INSUFFICIENT_SCOPE's id was renamed off any DEMO_USE_CASE_IDS entry in
    // Task 2, so only UC1 (a Demo id) duplicates here.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'show my balance' } });

    expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0);
    expect(screen.queryByText('Insufficient scope attack')).not.toBeInTheDocument();
  });

  it('clearing the search box restores the full view', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'a2a-delegation' } });
    expect(screen.queryByText('Bad client to agent gateway')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0);
  });

  it('shows an empty-state message when the search matches nothing', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'zzz-no-such-use-case' } });

    expect(screen.getByText('No use cases match "zzz-no-such-use-case".')).toBeInTheDocument();
    expect(screen.queryByText(/Demo — a scripted walkthrough/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Happy Paths — successful outcomes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Foundations/i)).not.toBeInTheDocument();
  });

  it('search filters the Demo section independently, preserving script order', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'a2a-delegation' } });

    // Only UC2 (useCaseId 'a2a-delegation') matches — Demo narrows to just its
    // Step 2 card; UC1's Step 1 and UC11's Step 10 cards disappear from Demo.
    const demoSection = screen.getByRole('heading', { level: 2, name: /Demo — a scripted walkthrough/i }).closest('section');
    expect(within(demoSection).getByText('Step 2')).toBeInTheDocument();
    expect(within(demoSection).queryByText('Step 1')).not.toBeInTheDocument();
    expect(within(demoSection).queryByText('Step 10')).not.toBeInTheDocument();
  });

  it('hides the Progressive Trust Demo strip while searching, restores it when cleared', async () => {
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
      return Promise.resolve({ data: { vertical: 'banking', useCases: [UC_DEMO_ACT1] } });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Progressive Trust Demo — Act 1 from here/i)).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'public catalog' } });
    expect(screen.queryByText(/Progressive Trust Demo — Act 1 from here/i)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText(/Progressive Trust Demo — Act 1 from here/i)).toBeInTheDocument());
  });
});
