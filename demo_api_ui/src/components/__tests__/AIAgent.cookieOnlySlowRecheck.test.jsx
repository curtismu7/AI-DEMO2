/**
 * A cookie-only session must not be judged once and then forgotten.
 *
 * When the BFF reports cookieOnlyBffSession:true, the agent polls
 * /api/auth/session every 2s for 10s. If the server-side session finished
 * hydrating after that window, nothing checked again, so the flag stayed
 * stale until a page reload. The agent keeps re-checking at a slow cadence
 * after the fast poll gives up, and stops once the session reports healed.
 */
import React from "react";
import { act } from "@testing-library/react";

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
  sendAgentMessage: vi.fn().mockResolvedValue({ success: true, reply: "ok" }),
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

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
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

vi.mock("../../services/cachedStatusService", () => ({
  getCachedStatus: vi.fn(),
  getCachedJson: vi.fn().mockResolvedValue({ data: {} }),
  clearStatusCache: vi.fn(),
}));

import AIAgent from "../AIAgent";
import { getCachedStatus } from "../../services/cachedStatusService";
import { renderAgentHydrating } from "../../test-utils/renderAgentHydrating";

const USER = { id: "u1", username: "demouser", name: "Demo User", role: "customer" };

let sessionHealed;

// Only the cookie-only poll's own checks — it is the sole caller passing _silent.
function sessionPolls() {
  return global.fetch.mock.calls.filter(
    ([url, opts]) => url === "/api/auth/session" && opts?._silent === true,
  ).length;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  sessionHealed = false;
  getCachedStatus.mockReset();
  getCachedStatus.mockImplementation((url) =>
    Promise.resolve(
      url === "/api/auth/session"
        ? { authenticated: true, user: USER, cookieOnlyBffSession: true }
        : null,
    ),
  );
  global.fetch = vi.fn((url) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(url === "/api/auth/session" ? { cookieOnlyBffSession: !sessionHealed } : {}),
    }),
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("keeps re-checking a cookie-only session after the fast poll gives up, then stops once it heals", async () => {
  renderAgentHydrating(AIAgent, { path: "/dashboard" });

  // React runs the poll effect (and registers its interval) only when an act()
  // scope ends, so the mount check must commit in its own act before advancing.
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });

  // Mount check landed cookie-only; the fast poll runs its 5 × 2s and gives up.
  await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
  const afterFastPoll = sessionPolls();
  // Guard: without this the test would pass vacuously if cookie-only was never reached.
  expect(afterFastPoll).toBeGreaterThanOrEqual(5);

  // The server-side session finishes hydrating well after the fast poll stopped.
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  sessionHealed = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(40000); });
  expect(sessionPolls()).toBeGreaterThan(afterFastPoll);

  // Healed: the flag cleared, so polling stops for good.
  const afterHeal = sessionPolls();
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(sessionPolls()).toBe(afterHeal);
});
