/**
 * finding #66: the track/authorize/agent-gateway/demo derivations in
 * UseCaseLauncherPage used to be plain `const` assignments in the render
 * body — recomputed (re-scanning the full use-case catalog, rebuilding
 * Sets) on every render, including renders triggered by state that has
 * nothing to do with `useCases` or `query` (e.g. enabling a feature flag).
 *
 * Proof: `allPingOneAuthorizeUCIds`/`allAgentGatewayUCIds` are called
 * exactly once inside the now-memoized `authorizeIds`/`agentGatewayIds`
 * (both depend on `[]`, since the capability ledgers are static config).
 * Pre-fix, they were called fresh on every render. Triggering a re-render
 * that changes neither `useCases` nor `query` — enabling a flag-gated UC's
 * required flag via its FlagGate banner, exactly like the "clicking Enable"
 * case in UseCaseLauncherPage.test.js — must not increase the call count
 * once memoized.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import UseCaseLauncherPage from '../UseCaseLauncherPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

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

const authorizeCallCount = vi.fn();
vi.mock('../../config/capabilityLedgers/pingOneAuthorizeCapabilities', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    allRelatedUCIds: (...args) => {
      authorizeCallCount();
      return actual.allRelatedUCIds(...args);
    },
  };
});

const agentGatewayCallCount = vi.fn();
vi.mock('../../config/capabilityLedgers/agentGatewayCapabilities', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    allRelatedUCIds: (...args) => {
      agentGatewayCallCount();
      return actual.allRelatedUCIds(...args);
    },
  };
});

import apiClient from '../../services/apiClient';

const UC_FLAG_GATED = {
  id: 'UC2',
  useCaseId: 'a2a-delegation',
  track: 'foundations',
  title: 'A2A delegation',
  buyerStory: 'Generalist delegates to specialist via nested act chain.',
  pingOneSolution: 'RFC 8693 nested-act.',
  trigger: { type: 'chip', text: 'hand off to a specialist' },
  expectedOutcome: 'PERMIT with act-chain depth',
  evidence: {},
  codeRefs: [],
  maturity: 'flag:ff_fixture_gate',
  owasp: {},
  whatToSay: 'Try A2A delegation.',
  advanced: false,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <UseCaseLauncherPage />
    </MemoryRouter>,
  );
}

describe('UseCaseLauncherPage — memoized derivations (finding #66)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockImplementation((url) => {
      if (url.includes('feature-flags')) {
        return Promise.resolve({
          data: { flags: [{ id: 'ff_fixture_gate', value: false }], categories: [] },
        });
      }
      return Promise.resolve({ data: { vertical: 'banking', useCases: [UC_FLAG_GATED] } });
    });
    apiClient.post.mockResolvedValue({ data: { flags: ['ff_fixture_gate'] } });
  });

  it('does not recompute authorize/agent-gateway id sets on an unrelated re-render', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0));

    const callsAfterMount = authorizeCallCount.mock.calls.length;
    const agwCallsAfterMount = agentGatewayCallCount.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // Clicking a FlagGate banner's Enable button re-renders the page (the
    // local flag-map overlay changes) without touching `useCases` or
    // `query` — the exact case the fix targets.
    const enableBtn = screen.getAllByRole('button', { name: /Enable/i })[0];
    fireEvent.click(enableBtn);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/demo-flags/enable', { useCaseId: 'a2a-delegation' }));

    expect(authorizeCallCount.mock.calls.length).toBe(callsAfterMount);
    expect(agentGatewayCallCount.mock.calls.length).toBe(agwCallsAfterMount);
  });
});
