/**
 * A `public` demo step must run for a signed-out visitor without touching an
 * admin route.
 *
 * Live repro (2026-08-17, signed out on /dashboard): Demo step 1 (UC24, Act 1 —
 * public catalog access) answered correctly — POST /api/agent/invoke returned
 * 200 with all seven branch cards — and then a banner covered it reading
 * "For a more personalized experience, please sign in." The banner came from
 * PATCH /api/admin/feature-flags => 401, fired by the flag-arming step that ran
 * for EVERY demo step regardless of whether the step needed a session.
 *
 * Boilerplate mirrors AIAgent.branchHours.test.jsx, the sibling that drives the
 * same public-catalog action through the typed-prompt path.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({
    preset: { shortName: "Super Banking", name: "Super Banking" },
  }),
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
    tokenSecondsLeft: 0,
    tokenLoading: false,
    staleSession: false,
    hasActiveToken: false,
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

vi.mock("../../services/configService", () => ({
  loadPublicConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => false),
  setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked by consent decline.",
  getConsentState: vi.fn(() => null),
  setConsentDeclined: vi.fn(),
}));

vi.mock("../../utils/agentToolSteps", () => ({
  getToolStepsForAction: vi.fn(() => []),
}));

vi.mock("react-toastify", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../utils/appToast", () => ({
  toast: {
    info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn(),
    warning: vi.fn(), update: vi.fn(), dismiss: vi.fn(),
  },
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifyWarning: vi.fn(),
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

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: vi.fn(), abort: vi.fn() }),
}));

vi.mock("../../services/bffAxios", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

// The 401 that caused the banner came through apiClient.patch, so that is the
// call this test watches.
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
import { requiredFlagsForUseCase } from "../../utils/requiredDemoFlags";

// primaryTool is what makes requiredFlagsForUseCase return a non-empty list
// (every MCP-tool chip needs ff_mcp_gateway_pinggateway armed). Without it the
// "no PATCH" assertion below would pass for the wrong reason.
const UC24 = {
  id: "UC24",
  useCaseId: "progressive-trust-public-access",
  title: "Act 1 — Public catalog access",
  auth: "public",
  primaryTool: "get_branch_hours",
  trigger: { type: "chip", text: "What branches are near me?" },
};

const UC1 = {
  id: "UC1",
  useCaseId: "delegated-access-with-proof",
  title: "Delegated access with proof",
  auth: "user",
  primaryTool: "get_account_balance",
  trigger: { type: "chip", text: "What is my balance?" },
};

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  localStorage.clear();
  apiPatch.mockReset();
  apiPatch.mockResolvedValue({ data: {} });
  sendAgentMessage.mockReset();
  sendAgentMessage.mockResolvedValue({
    success: true,
    reply: "Super Banking branch locations — found 1:",
    publicCatalog: true,
    branches: [
      { id: "b1", name: "Test Branch", city: "Austin", state: "TX", address: "1 Main St", hours: "9-5", atm: true },
    ],
  });
  global.fetch = vi.fn(() => jsonResponse({}));
});

/**
 * Render signed out (`user={null}`).
 *
 * Path matters: `/` and `/dashboard` are marketing guest-chat surfaces
 * (isPublicMarketingAgentPath), where a signed-out visitor may already chat, so
 * the sign-in prompt never appears there for any use case. Anywhere else only
 * the use case's own level decides — that is where the gate is worth testing.
 */
function renderSignedOut(path = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent user={null} mode="inline" />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

async function runStep(uc) {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("agent-demo-step-select", { detail: { uc, stepNumber: 1 } }),
    );
  });
  // The bridge defers the step one tick so the panel mounts first.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150));
  });
}

describe("public demo step, signed out", () => {
  it("never PATCHes the admin feature-flag route", async () => {
    // Sanity: this use case DOES have flags to arm, so a passing assertion
    // below means the gate skipped them, not that there was nothing to skip.
    expect(requiredFlagsForUseCase(UC24).length).toBeGreaterThan(0);

    renderSignedOut();
    await runStep(UC24);

    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("runs the step instead of asking the visitor to sign in", async () => {
    renderSignedOut();
    await runStep(UC24);

    await waitFor(() => {
      expect(screen.getByText(/Running Demo step 1/i)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain("needs you signed in");

    await waitFor(() => {
      expect(sendAgentMessage).toHaveBeenCalledWith(
        "What branches are near me?",
        null,
        expect.objectContaining({ useCaseId: "progressive-trust-public-access" }),
      );
    });
  });
});

describe("protected demo step, signed out, off the marketing surfaces", () => {
  it("still asks the visitor to sign in and does not send", async () => {
    renderSignedOut("/themes");
    await runStep(UC1);

    await waitFor(() => {
      expect(screen.getByText(/needs you signed in/i)).toBeInTheDocument();
    });
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });
});
