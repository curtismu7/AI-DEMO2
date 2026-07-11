/**
 * AiAttacksPanel.inlineAgent.test.jsx
 *
 * Locks the AIAgent side of the AI Attacks drawer wiring for the INLINE agent:
 * only one <AIAgent> mounts at a time (App.js shouldMountSingleAgent), so the
 * mounted instance must handle 'banking-agent-prefill' (autoSend) and
 * 'banking-run-showcase' even when mode="inline" — the old `if (isInline) return`
 * guards made the drawer's Run buttons dead on /dashboard.
 *
 * Also locks the no-agent fallback contract on the agent side:
 *   - window.__bankingAgentMounted set on mount, cleared on unmount
 *   - a pending 'banking-agent-pending-attack' sessionStorage entry is
 *     read + cleared + replayed on mount.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AIAgent from "../../AIAgent";
import { ActivityNarrativeProvider } from "../../../context/ActivityNarrativeContext";
import * as demoAgentNlService from "../../../services/demoAgentNlService";
import * as configService from "../../../services/configService";
import * as demoAgentService from "../../../services/demoAgentService";

// ─── Mock heavy dependencies (same harness as AIAgent.chips.test.js) ─────────

vi.mock("../../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({
    preset: { shortName: "Super Banking", name: "Super Banking" },
  }),
}));

vi.mock("../../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: vi.fn(), close: vi.fn() }),
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn() }),
}));

vi.mock("../../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => null,
}));

vi.mock("../../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({
    placement: "none",
    fab: true,
    setAgentUi: vi.fn(),
  }),
}));

vi.mock("../../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: 900,
    tokenLoading: false,
    staleSession: false,
    hasActiveToken: true,
  }),
}));

vi.mock("../../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi
    .fn()
    .mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: vi.fn().mockResolvedValue({
    source: "local",
    result: { kind: "none", message: "ok" },
  }),
}));

vi.mock("../../../services/demoAgentService", () => ({
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
  fetchAgentTools: vi
    .fn()
    .mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));

vi.mock("../../../services/configService", () => ({
  loadPublicConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => false),
  setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked by consent decline.",
  getConsentState: vi.fn(() => null),
  setConsentDeclined: vi.fn(),
}));

vi.mock("../../../utils/agentToolSteps", () => ({
  getToolStepsForAction: vi.fn(() => []),
}));

vi.mock("react-toastify", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../../utils/appToast", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    warning: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../../BankingAgent.css", () => ({}), { virtual: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "bankUser",
  firstName: "Test",
  lastName: "User",
};

function renderInlineAgent(props = {}) {
  return render(
    <MemoryRouter>
      <ActivityNarrativeProvider>
        <AIAgent user={customerUser} mode="inline" {...props} />
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.removeItem("banking-agent-pending-attack");
  demoAgentNlService.fetchNlStatus.mockResolvedValue({
    groqConfigured: false,
    geminiConfigured: false,
  });
  configService.loadPublicConfig.mockResolvedValue({});
  demoAgentService.sendAgentMessage.mockResolvedValue({ success: true, reply: "Done." });
  // sendAsNl POSTs /api/demo-agent/nl; injection showcases POST the seed
  // endpoint. Return a benign parse result for everything.
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { kind: "none", message: "ok" }, source: "heuristic" }),
  });
});

afterEach(() => {
  sessionStorage.removeItem("banking-agent-pending-attack");
  delete global.fetch;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Inline agent handles AI Attacks drawer events (no isInline early return)", () => {
  it("banking-agent-prefill with autoSend submits the message through the NL pipeline", async () => {
    renderInlineAgent();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("banking-agent-prefill", {
          detail: { message: "Transfer $1000 to savings", autoSend: true },
        }),
      );
    });

    // Handler defers 80ms then sendAsNl adds the user turn to the transcript.
    expect(
      await screen.findByText(/Transfer \$1000 to savings/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("banking-run-showcase runs the showcase attack in the inline agent", async () => {
    renderInlineAgent();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("banking-run-showcase", {
          detail: { showcase: "atk_prompt_injection", label: "Prompt Injection" },
        }),
      );
    });

    // runDrawerAttackRef echoes the run as a user turn before seeding.
    expect(
      await screen.findByText(/Run attack: Prompt Injection/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

describe("Agent presence flag + pending-attack replay", () => {
  it("sets window.__bankingAgentMounted on mount and clears it on unmount", () => {
    const { unmount } = renderInlineAgent();
    expect(window.__bankingAgentMounted).toBe(true);
    unmount();
    expect(window.__bankingAgentMounted).toBeUndefined();
  });

  it("replays a pending prefill attack from sessionStorage and clears the key", async () => {
    sessionStorage.setItem(
      "banking-agent-pending-attack",
      JSON.stringify({
        type: "prefill",
        payload: { message: "Transfer $1000 to savings", autoSend: true },
      }),
    );

    renderInlineAgent();

    await waitFor(() =>
      expect(sessionStorage.getItem("banking-agent-pending-attack")).toBeNull(),
    );
    // Replay defers 300ms then submits through the same NL pipeline.
    expect(
      await screen.findByText(/Transfer \$1000 to savings/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("replays a pending showcase attack from sessionStorage", async () => {
    sessionStorage.setItem(
      "banking-agent-pending-attack",
      JSON.stringify({
        type: "showcase",
        payload: { showcase: "atk_prompt_injection", label: "Prompt Injection" },
      }),
    );

    renderInlineAgent();

    expect(
      await screen.findByText(/Run attack: Prompt Injection/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem("banking-agent-pending-attack")).toBeNull();
  });
});
