/**
 * Regression test for a stale-response race in fetchLiveAccounts.
 *
 * Bug: fetchLiveAccounts (called imperatively from both the login effect and
 * the vertical-switch effect) had no staleness guard, unlike the adjacent
 * tool-fetch effect. Switching verticals twice quickly fires two
 * /api/accounts/my requests; if the OLDER request's response resolves AFTER
 * the newer one (network jitter), setLiveAccounts applied the older
 * vertical's stale accounts last.
 *
 * Fix: a request-id ref in fetchLiveAccounts — only the response matching the
 * most recently issued request is applied.
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import AIAgent from "../AIAgent";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";
import * as demoAgentService from "../../services/demoAgentService";
import { useVertical } from "../../vertical/useVertical";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({ preset: { shortName: "Super Banking", name: "Super Banking" } }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: vi.fn(), close: vi.fn() }),
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => null,
}));
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: true, setAgentUi: vi.fn() }),
}));
vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: 900,
    tokenLoading: false,
    staleSession: false,
    hasActiveToken: true,
  }),
}));
vi.mock("../../vertical/useVertical", () => ({
  useVertical: vi.fn(),
}));
vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: vi.fn().mockResolvedValue({
    source: "local",
    result: { kind: "action", action: { id: "accounts" } },
  }),
}));
vi.mock("../../services/demoAgentService", () => ({
  getMyAccounts: vi.fn().mockResolvedValue([]),
  getAccountBalance: vi.fn().mockResolvedValue({ balance: 100 }),
  getMyTransactions: vi.fn().mockResolvedValue([]),
  createTransfer: vi.fn().mockResolvedValue({ success: true }),
  createDeposit: vi.fn().mockResolvedValue({ success: true }),
  createWithdrawal: vi.fn().mockResolvedValue({ success: true }),
  refreshOAuthSession: vi.fn().mockResolvedValue({}),
  warmupAuthz: vi.fn().mockResolvedValue({}),
  callMcpTool: vi.fn().mockResolvedValue({ success: true }),
  sendAgentMessage: vi.fn().mockResolvedValue({ success: true }),
  fetchAgentTools: vi.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));
vi.mock("../../services/configService", () => ({
  loadPublicConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => false),
  setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked.",
  getConsentState: vi.fn(() => null),
  setConsentDeclined: vi.fn(),
}));
vi.mock("../../utils/agentToolSteps", () => ({ getToolStepsForAction: vi.fn(() => []) }));
vi.mock("react-toastify", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  toast: {
    info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn(),
    warning: vi.fn(), update: vi.fn(), dismiss: vi.fn(),
  },
  notifySuccess: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn(), notifyWarning: vi.fn(),
}));
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "demoUser",
  firstName: "Demo",
};

function verticalMock(id) {
  return {
    pageManifest: { id },
    agentManifest: null,
    adminManifest: null,
    pageMockData: null,
    activeId: id,
    isAdminScope: false,
    isAdmin: false,
    refetch: () => {},
  };
}

function renderAgent(props = {}) {
  return render(
    <MemoryRouter>
      <ProofOfEnforcementProvider>
        <ActivityNarrativeProvider>
          <AIAgent {...props} />
        </ActivityNarrativeProvider>
      </ProofOfEnforcementProvider>
    </MemoryRouter>,
  );
}

describe("fetchLiveAccounts stale-response race (rapid vertical switch)", () => {
  let accountsResolvers;
  let origFetch;

  beforeEach(() => {
    localStorage.clear();
    accountsResolvers = [];
    origFetch = global.fetch;
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes("/api/accounts/my")) {
        return new Promise((resolve) => {
          accountsResolvers.push(resolve);
        });
      }
      if (u.includes("/api/demo-agent/nl")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            source: "heuristic",
            result: {
              kind: "banking",
              banking: { action: "balance", params: { accountType: "checking" } },
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    useVertical.mockReturnValue(verticalMock("vertical-a"));
    demoAgentService.getAccountBalance.mockClear();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it("applies the newer vertical's accounts even when an older request's response resolves later", async () => {
    const { rerender } = renderAgent({ user: customerUser, mode: "inline" });

    // On mount, both the login effect AND the vertical-switch effect's first
    // run (prevVerticalRef starts null) fire fetchLiveAccounts for vertical-a.
    await waitFor(() => expect(accountsResolvers.length).toBe(2));

    // Switch vertical — the vertical-switch effect fires a third request.
    useVertical.mockReturnValue(verticalMock("vertical-b"));
    rerender(
      <MemoryRouter>
        <ProofOfEnforcementProvider>
          <ActivityNarrativeProvider>
            <AIAgent user={customerUser} mode="inline" />
          </ActivityNarrativeProvider>
        </ProofOfEnforcementProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(accountsResolvers.length).toBe(3));

    // Resolve the NEWEST (vertical-b, 3rd request) FIRST...
    await act(async () => {
      accountsResolvers[2]({
        ok: true,
        json: async () => ({
          accounts: [{ id: "acc-b-chk", accountType: "checking", balance: 222 }],
        }),
      });
    });

    // ...then the two OLDER (vertical-a) requests resolve LAST, simulating
    // network jitter. Without the staleness guard, whichever of these
    // resolves last would overwrite liveAccounts with the stale vertical-a
    // account.
    await act(async () => {
      accountsResolvers[0]({
        ok: true,
        json: async () => ({
          accounts: [{ id: "acc-a-chk", accountType: "checking", balance: 111 }],
        }),
      });
      accountsResolvers[1]({
        ok: true,
        json: async () => ({
          accounts: [{ id: "acc-a-chk", accountType: "checking", balance: 111 }],
        }),
      });
    });

    // Ask for the checking balance — resolved by matching liveAccounts by type.
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "what is my checking balance" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(demoAgentService.getAccountBalance).toHaveBeenCalled();
    });
    // Must resolve to vertical-b's account id — the stale vertical-a response
    // must NOT win even though it resolved after vertical-b's.
    expect(demoAgentService.getAccountBalance).toHaveBeenCalledWith(
      "acc-b-chk",
      expect.anything(),
    );
  });
});
