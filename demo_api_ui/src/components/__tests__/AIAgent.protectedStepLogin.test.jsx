/**
 * A guest who picks a step that needs a session gets a sign-in button, not a
 * doomed request.
 *
 * `/` and `/dashboard` enable guest chat (isPublicMarketingAgentPath), and the
 * old gate treated that as permission to run ANY step. So a guest on the
 * dashboard picking UC1 saw "Running Demo step…", the BFF refused it, and a
 * re-auth banner landed over an empty chat — with no way in. The step's own
 * declared level decides now, and the refusal carries the button.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({ preset: { shortName: "Super Banking", name: "Super Banking" } }),
}));

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: vi.fn(), close: vi.fn() }),
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn() }),
}));

vi.mock("../../context/TokenChainContext", () => ({ useTokenChainOptional: () => null }));

vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: true, setAgentUi: vi.fn() }),
}));

vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: 0, tokenLoading: false, staleSession: false, hasActiveToken: false,
  }),
}));

vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: vi.fn().mockResolvedValue({ source: "local", result: { kind: "none" } }),
}));

const sendAgentMessage = vi.fn();
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
  sendAgentMessage: (...args) => sendAgentMessage(...args),
  fetchAgentTools: vi.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));

vi.mock("../../services/configService", () => ({ loadPublicConfig: vi.fn().mockResolvedValue({}) }));

vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => false),
  setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked by consent decline.",
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

vi.mock("../../hooks/useAgentState", () => ({
  useAgentState: () => ({
    state: {
      messages: [], toolCalls: [], tokenEvents: [], mcpTraffic: [],
      authorizeDecisions: [], lastTokenUsage: null, lastOutcome: null,
      hitlPending: null, error: null,
    },
    handlers: {},
    reset: vi.fn(),
  }),
}));

vi.mock("../../hooks/useAgentRun", () => ({ useAgentRun: () => ({ run: vi.fn(), abort: vi.fn() }) }));

vi.mock("../../services/bffAxios", () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }) },
}));

const apiPatch = vi.fn();
vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: (...args) => apiPatch(...args),
  },
}));

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: "banking",
    pageManifest: { id: "banking", identity: { displayName: "Super Banking" } },
    agentManifest: { id: "banking", identity: { displayName: "Super Banking" } },
    adminManifest: null,
    pageMockData: null,
    isAdminScope: false,
    isAdmin: false,
    refetch: () => {},
  }),
}));

import AIAgent from "../AIAgent";

const UC1 = {
  id: "UC1",
  useCaseId: "delegated-access-with-proof",
  title: "Delegated access with proof",
  auth: "user",
  primaryTool: "get_account_balance",
  trigger: { type: "chip", text: "What is my balance?" },
};

const UC24 = {
  id: "UC24",
  useCaseId: "progressive-trust-public-access",
  title: "Act 1 — Public catalog access",
  auth: "public",
  primaryTool: "get_branch_hours",
  trigger: { type: "chip", text: "What branches are near me?" },
};

const ADMIN1 = {
  id: "ADMIN1",
  useCaseId: "admin-list-apps",
  title: "List applications",
  auth: "admin",
  trigger: { type: "chip", text: "List all PingOne applications in this environment" },
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  apiPatch.mockReset();
  apiPatch.mockResolvedValue({ data: {} });
  sendAgentMessage.mockReset();
  sendAgentMessage.mockResolvedValue({ success: true, reply: "ok" });
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
});

/** `/dashboard` is a guest-chat surface — the case the old gate got wrong. */
function renderAt(path, user = null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent user={user} mode="inline" />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

async function runStep(uc) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("agent-demo-step-select", { detail: { uc, stepNumber: 1 } }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
}

describe("guest on a guest-chat surface", () => {
  it("offers a sign-in button for a step that needs a session", async () => {
    renderAt("/dashboard");
    await runStep(UC1);

    await waitFor(() => {
      expect(screen.getByText(/needs you signed in/i)).toBeInTheDocument();
    });
    // The prompt's own action, not the header's Sign In — that is the button
    // the visitor is actually being offered here.
    expect(screen.getByRole("button", { name: /sign in to continue/i })).toBeInTheDocument();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("asks for an ADMIN sign-in when the step needs admin", async () => {
    renderAt("/dashboard");
    await runStep(ADMIN1);

    await waitFor(() => {
      expect(screen.getByText(/needs an admin sign-in/i)).toBeInTheDocument();
    });
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("still runs a public step without asking for anything", async () => {
    renderAt("/dashboard");
    await runStep(UC24);

    await waitFor(() => {
      expect(screen.getByText(/Running Demo step 1/i)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toMatch(/needs you signed in/i);
  });
});

describe("signed-in customer", () => {
  it("runs a user-level step, and is still refused an admin one", async () => {
    const customer = { id: "u1", role: "customer", email: "u@test.com", username: "cust" };

    const { unmount } = renderAt("/dashboard", customer);
    await runStep(UC1);
    await waitFor(() => {
      expect(screen.getByText(/Running Demo step 1/i)).toBeInTheDocument();
    });
    unmount();

    renderAt("/dashboard", customer);
    await runStep(ADMIN1);
    await waitFor(() => {
      expect(screen.getByText(/needs an admin sign-in/i)).toBeInTheDocument();
    });
  });
});

/**
 * The other half of the queue: what happens when the login actually lands.
 *
 * A step queued while signed out could not arm its flags — arming is
 * admin-gated, so it would only 401. The flags ride along in sessionStorage
 * (the OAuth login is a full redirect, so a React ref does not survive it) and
 * are armed by the resume effect on the way back.
 *
 * This path shipped dead twice: first as a ref the redirect destroyed, then
 * with a restore that ran only on the non-OAuth mount. Both times every other
 * test stayed green, so it is pinned explicitly here.
 */
describe("resuming a queued step after sign-in", () => {
  const CUSTOMER = { id: "u1", role: "customer", username: "cust" };

  /** What handleLoginAction leaves behind before redirecting to PingOne. */
  function seedPendingStep({ nl, ucId, flags }) {
    if (nl) sessionStorage.setItem("bx_agent_pending_nl", nl);
    if (ucId) sessionStorage.setItem("bx_agent_pending_uc_id", ucId);
    if (flags) sessionStorage.setItem("bx_agent_pending_flags", JSON.stringify(flags));
  }

  async function settle() {
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  }

  it("arms the deferred flags and sends, in that order", async () => {
    seedPendingStep({
      nl: "What is my balance?",
      ucId: "delegated-access-with-proof",
      flags: ["ff_a2a_delegation"],
    });

    renderAt("/dashboard", CUSTOMER);
    await settle();

    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalled());

    expect(apiPatch).toHaveBeenCalledWith(
      "/api/admin/feature-flags",
      { updates: { ff_a2a_delegation: true } },
      { _noAuthBanner: true },
    );

    // Armed BEFORE the send. Arming after the step has run is useless — the
    // whole point is the flag being on for that request.
    expect(apiPatch.mock.invocationCallOrder[0])
      .toBeLessThan(sendAgentMessage.mock.invocationCallOrder[0]);

    // The useCaseId survived too; without it the resumed step loses
    // forceHeuristic and its A2.1/A2.2 stamping.
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "What is my balance?",
      null,
      expect.objectContaining({ useCaseId: "delegated-access-with-proof" }),
    );
  });

  it("consumes the keys so a later run cannot inherit them", async () => {
    seedPendingStep({
      nl: "What is my balance?",
      ucId: "delegated-access-with-proof",
      flags: ["ff_a2a_delegation"],
    });

    renderAt("/dashboard", CUSTOMER);
    await settle();

    expect(sessionStorage.getItem("bx_agent_pending_nl")).toBeNull();
    expect(sessionStorage.getItem("bx_agent_pending_uc_id")).toBeNull();
    expect(sessionStorage.getItem("bx_agent_pending_flags")).toBeNull();
  });

  // Both mount paths must claim these keys, and the OAuth one is the path a real
  // login takes. It used to claim them only after a pendingNl turned up, deep
  // inside the session-hydration callback — so when the NL was gone (another
  // instance won the claim, or hydration failed) the useCaseId and flag list
  // were left behind, and the NEXT launcher run inherited a step nobody picked.
  it.each([
    ["the launcher deep-link mount", "/dashboard"],
    ["the OAuth return", "/dashboard?oauth=success"],
  ])("clears a stale ucId and flag list on %s when no pending NL survives", async (_label, path) => {
    seedPendingStep({ ucId: "delegated-access-with-proof", flags: ["ff_a2a_delegation"] });

    renderAt(path, CUSTOMER);
    await settle();

    expect(sessionStorage.getItem("bx_agent_pending_uc_id")).toBeNull();
    expect(sessionStorage.getItem("bx_agent_pending_flags")).toBeNull();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("survives a corrupt flag list instead of losing the step", async () => {
    seedPendingStep({ nl: "What is my balance?", ucId: "delegated-access-with-proof" });
    sessionStorage.setItem("bx_agent_pending_flags", "{not json");

    renderAt("/dashboard", CUSTOMER);
    await settle();

    // Unarmed is a degraded step; a thrown parse error is a lost one.
    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalled());
  });

  // Verified against the live stack with an instrumented sessionStorage probe:
  // before this, clicking the prompt's Sign In wrote NOTHING. handleLoginAction
  // persisted `nlInput` — the composer — and a queued demo step is not there; it
  // lives in nlResumeAfterAuth with the composer empty. So the step the visitor
  // picked was simply gone after login, and every downstream piece (useCaseId,
  // deferred flags, auth level) was riding on a pending NL never written.
  it("persists the queued step itself when the visitor signs in", async () => {
    renderAt("/dashboard");
    await runStep(UC1);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sign in to continue/i })).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByRole("button", { name: /sign in to continue/i }).click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(sessionStorage.getItem("bx_agent_pending_nl")).toBe(UC1.trigger.text);
    expect(sessionStorage.getItem("bx_agent_pending_uc_id")).toBe(UC1.useCaseId);
    expect(sessionStorage.getItem("bx_agent_pending_auth")).toBe("user");
  });

  // The sequence a real OAuth return actually produces, and the one the tests
  // above quietly skip: `user` is null on first render and arrives a beat later,
  // because isLoggedIn comes from an async session hydration.
  //
  // On a guest-chat surface that gap is the bug. `marketingGuestChatEnabled` is
  // already true while `isLoggedIn` is still false, so the resume effect fired
  // in that window, skipped the arming (which requires isLoggedIn), and the
  // pendingNlResumeRef guard then stopped the authenticated re-run from
  // retrying. The step sent unarmed and the deferred arming never ran at all.
  //
  // Mocking the user as present from first render hides this completely — which
  // is how it shipped twice.
  it("waits for the session instead of firing during hydration", async () => {
    seedPendingStep({
      nl: "What is my balance?",
      ucId: "delegated-access-with-proof",
      flags: ["ff_a2a_delegation"],
    });

    // First render: signed out on a guest-chat surface, exactly as the page
    // looks for the moment before the session resolves.
    const { rerender } = render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={null} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );
    await settle();

    // Must not have gone yet — there is nothing to arm with and no session.
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(apiPatch).not.toHaveBeenCalled();

    // Session lands.
    rerender(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={CUSTOMER} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );
    await settle();

    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/admin/feature-flags",
      { updates: { ff_a2a_delegation: true } },
      { _noAuthBanner: true },
    );
    expect(apiPatch.mock.invocationCallOrder[0])
      .toBeLessThan(sendAgentMessage.mock.invocationCallOrder[0]);
  });
});
