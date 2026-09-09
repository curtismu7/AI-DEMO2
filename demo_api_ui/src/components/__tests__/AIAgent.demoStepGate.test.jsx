/**
 * Demo Steps dispatcher (handleDemoStepSelect) — two defects from the
 * 2026-09-08 Demo Steps review:
 *
 *   1. Only the CHIP branch checked the step's auth level. A signed-out click
 *      on an attack sim or a `user`-level link step POSTed / navigated anyway,
 *      401'd, and raised the app-wide "please sign in" banner.
 *   2. markUseCaseCompleted ran before any branch, so a step that never ran
 *      (blocked by auth, no runnable trigger, sim failed) showed ✓ and counted
 *      toward "N of 25 done".
 *
 * Boilerplate mirrors AIAgent.publicUseCase.test.jsx.
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

const apiPost = vi.fn();
vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: (...args) => apiPost(...args),
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

import AIAgent from "../AIAgent";
import { getCompletedUseCaseIds } from "../../utils/useCaseDemoProgress";

const UC12 = {
  id: "UC12",
  useCaseId: "token-replay-defense",
  title: "Token theft / replay defense",
  auth: "user",
  primaryTool: null,
  trigger: { type: "attack", sim: "replayed-token" },
};

const UC38 = {
  id: "UC38",
  useCaseId: "personal-agent-concierge",
  title: "Personal Agent Concierge",
  auth: "user",
  primaryTool: "redeem_miles",
  trigger: { type: "link", path: "/personal-agent" },
};

const UC27 = {
  id: "UC2.7",
  useCaseId: "a2a-end-to-end",
  title: "A2A end to end — protocol + identity",
  auth: "public",
  primaryTool: null,
  trigger: { type: "link", path: "/a2a-protocol-learning" },
};

const NO_TRIGGER = {
  id: "UC99",
  useCaseId: "no-trigger",
  title: "Nothing runnable",
  auth: "public",
  primaryTool: null,
  trigger: {},
};

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  apiPost.mockReset();
  apiPost.mockResolvedValue({ data: { status: 401, errorCode: "invalid_aud", tokenChainEvents: [] } });
  sendAgentMessage.mockReset();
  global.fetch = vi.fn(() => jsonResponse({}));
});

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
      new CustomEvent("agent-demo-step-select", { detail: { uc, stepNumber: 7 } }),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150));
  });
}

describe("signed out, protected non-chip steps are gated like chips", () => {
  it("an attack sim shows the sign-in prompt, never POSTs, and is not ticked", async () => {
    renderSignedOut();
    await runStep(UC12);

    await waitFor(() => {
      expect(screen.getByText(/needs you signed in/i)).toBeInTheDocument();
    });
    expect(apiPost).not.toHaveBeenCalledWith("/api/demo/attack-sim/run", expect.anything());
    expect(getCompletedUseCaseIds().has("UC12")).toBe(false);
  });

  it("a user-level link step shows the sign-in prompt instead of opening the page", async () => {
    renderSignedOut();
    await runStep(UC38);

    await waitFor(() => {
      expect(screen.getByText(/needs you signed in/i)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain("opening /personal-agent");
    expect(getCompletedUseCaseIds().has("UC38")).toBe(false);
  });

  it("a public link step still opens, and is ticked once it did", async () => {
    renderSignedOut();
    await runStep(UC27);

    await waitFor(() => {
      expect(screen.getByText(/opening \/a2a-protocol-learning/i)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain("needs you signed in");
    expect(getCompletedUseCaseIds().has("UC2.7")).toBe(true);
  });
});

describe("✓ only after the step ran", () => {
  it("a step with no runnable trigger is not ticked", async () => {
    renderSignedOut();
    await runStep(NO_TRIGGER);

    await waitFor(() => {
      expect(screen.getByText(/no runnable trigger/i)).toBeInTheDocument();
    });
    expect(getCompletedUseCaseIds().has("UC99")).toBe(false);
  });
});
