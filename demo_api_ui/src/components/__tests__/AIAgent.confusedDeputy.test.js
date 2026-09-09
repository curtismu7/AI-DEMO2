/**
 * Confused deputy attack chip (atk_confused_deputy): fires a raw fetch to
 * /api/mcp/tool with a rogue _testActClientId to prove PingOne Authorize's
 * HasValidActorChain denies non-allowlisted actors. Covers the UI half of
 * the fix that surfaces the real allowed actor alongside the rogue one that
 * was tried — see docs/superpowers/plans/2026-07-13-remaining-tried-vs-allowed.md
 * Task 2.
 *
 * This live harness used to be reachable only through the old "Actions"
 * dropdown's manifest-driven Security Showcase panel (BankingChips →
 * SecurityShowcasePanel). That dropdown was removed (see
 * docs/superpowers/plans/2026-07-24-actions-dropdown-removal.md Task 7); the
 * harness itself was ported into AIAgent.js's `runDrawerAttackRef` (the same
 * bridge that already serves the AI Attacks education drawer's "Run this
 * attack" buttons — see education/AiAttacksPanel.js's 'confused-deputy' tab)
 * and is now driven by the 'banking-run-showcase' window event, exactly like
 * the other showcase attacks (see AiAttacksPanel.inlineAgent.test.jsx).
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

// ─── Mock heavy dependencies (mirrors AIAgent.wrongAudience.test.js) ───────

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
    tokenSecondsLeft: 900,
    tokenLoading: false,
    staleSession: false,
    hasActiveToken: true,
  }),
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
  sendAgentMessage: vi.fn().mockResolvedValue({ success: true, reply: "Done." }),
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

vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

vi.mock("../../hooks/useAgentState", () => ({
  useAgentState: () => ({
    state: {
      messages: [],
      toolCalls: [],
      tokenEvents: [],
      mcpTraffic: [],
      authorizeDecisions: [],
      lastTokenUsage: null,
      lastOutcome: null,
      hitlPending: null,
      error: null,
    },
    handlers: {},
    reset: vi.fn(),
  }),
}));

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: vi.fn(), abort: vi.fn() }),
}));

import AIAgent from "../AIAgent";

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "bankUser",
  firstName: "Test",
  lastName: "User",
};

function renderAgent(props = {}) {
  return render(
    <MemoryRouter>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent {...props} />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

// atk_confused_deputy now runs via the 'banking-run-showcase' window event —
// the same bridge the AI Attacks education drawer's "Run this attack" button
// uses for its 'confused-deputy' tab (see AiAttacksPanel.js RUN_BY_TAB and
// AiAttacksPanel.runButtons.test.jsx for the button→event wiring; this file
// only needs to lock the AIAgent-side harness behavior).
function runConfusedDeputyShowcase() {
  renderAgent({ user: customerUser });
  act(() => {
    window.dispatchEvent(
      new CustomEvent("banking-run-showcase", {
        detail: { showcase: "atk_confused_deputy", label: "Confused Deputy" },
      }),
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ba_show_rfc_info", "true");
});

describe("Confused Deputy attack chip", () => {
  it("shows both the tried (rogue) actor and the real allowed actor on denial", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 403,
      json: async () => ({
        error: "gateway_policy_denied",
        gatewayErrorCode: "mcp-invalid-actor",
        allowedActor: "real-agent-client-id",
      }),
    });

    runConfusedDeputyShowcase();

    await waitFor(() => {
      expect(document.body.textContent).toContain("rogue-agent-9f2a-not-allowlisted");
      expect(document.body.textContent).toContain("real-agent-client-id");
    });
  });
});
