/* eslint-disable testing-library/no-unnecessary-act */
/* eslint-disable testing-library/no-node-access */
/* eslint-disable testing-library/no-render-in-setup */
/* eslint-disable testing-library/prefer-find-by */
/* eslint-disable testing-library/no-wait-for-multiple-assertions */
/* eslint-disable testing-library/no-wait-for-side-effects */
/* eslint-disable testing-library/no-container */
// banking_api_ui/src/components/__tests__/BankingAgent.chips.test.js
/**
 * Tests for BankingAgent suggestion chips, action chips, and education chips
 * across all three rendering modes: float, inline (middle), inline+bottom-dock.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AIAgent from "../AIAgent";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";
import * as demoAgentNlService from "../../services/demoAgentNlService";
import * as configService from "../../services/configService";
import * as demoAgentService from "../../services/demoAgentService";
import * as agentAccessConsent from "../../services/agentAccessConsent";
import { useVertical } from "../../vertical/useVertical";

// ─── Mock heavy dependencies ─────────────────────────────────────────────────

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({
    preset: { shortName: "Super Banking", name: "Super Banking" },
  }),
}));

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: jest.fn(), close: jest.fn() }),
  useEducationUI: () => ({ open: jest.fn(), close: jest.fn() }),
}));

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => null,
}));

const mockAgentUiMode = {
  placement: "none",
  fab: true,
  setAgentUi: jest.fn(),
  toolbarHostEl: null,
};
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => mockAgentUiMode,
}));

// Default matches the real hook's no-VerticalProvider fallback (pageManifest:
// null etc.) so existing tests are unaffected; only the new useCaseId describe
// block below overrides this via mockReturnValue, and restores it afterward.
const DEFAULT_VERTICAL_MOCK = {
  pageManifest: null,
  agentManifest: null,
  adminManifest: null,
  pageMockData: null,
  activeId: null,
  isAdminScope: false,
  isAdmin: false,
  refetch: () => {},
};
vi.mock("../../vertical/useVertical", () => ({
  useVertical: jest.fn(),
}));

vi.mock("../../context/SessionTokenContext", () => ({
  // Token present by default → needsSignIn=false, existing chip behavior.
  useSessionToken: () => ({
    tokenSecondsLeft: 900,
    tokenLoading: false,
    staleSession: false,
    hasActiveToken: true,
  }),
}));

vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: jest
    .fn()
    .mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: jest.fn().mockResolvedValue({
    source: "local",
    result: { kind: "action", action: { id: "accounts" } },
  }),
}));

vi.mock("../../services/demoAgentService", () => ({
  getMyAccounts: jest.fn().mockResolvedValue([]),
  getAccountBalance: jest.fn().mockResolvedValue({ balance: 100 }),
  getMyTransactions: jest.fn().mockResolvedValue([]),
  createTransfer: jest.fn().mockResolvedValue({ success: true }),
  createDeposit: jest.fn().mockResolvedValue({ success: true }),
  createWithdrawal: jest.fn().mockResolvedValue({ success: true }),
  refreshOAuthSession: jest.fn().mockResolvedValue({}),
  warmupAuthz: jest.fn().mockResolvedValue({}),
  callMcpTool: jest.fn().mockResolvedValue({ success: true }),
  sendAgentMessage: jest.fn().mockResolvedValue({ success: true }),
  fetchAgentTools: jest
    .fn()
    .mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));

vi.mock("../../services/configService", () => ({
  loadPublicConfig: jest.fn().mockResolvedValue({}),
}));

vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: jest.fn(() => false),
  setAgentBlockedByConsentDecline: jest.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked by consent decline.",
  getConsentState: jest.fn(() => null),
  setConsentDeclined: jest.fn(),
}));

vi.mock("../../utils/agentToolSteps", () => ({
  getToolStepsForAction: jest.fn(() => []),
}));

vi.mock("react-toastify", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

vi.mock("../../utils/appToast", () => ({
  toast: {
    info: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
    update: jest.fn(),
    dismiss: jest.fn(),
  },
  notifySuccess: jest.fn(),
  notifyError: jest.fn(),
  notifyInfo: jest.fn(),
  notifyWarning: jest.fn(),
}));

// CSS imports are no-ops in tests
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Clear localStorage and re-arm async mocks before each test.
// BankingAgent persists isOpen to localStorage which can contaminate subsequent tests.
// jest.fn().mockResolvedValue() in a factory can be silently cleared; re-arm to be safe.
beforeEach(() => {
  localStorage.clear();
  const nlMock = demoAgentNlService;
  nlMock.fetchNlStatus.mockResolvedValue({
    groqConfigured: false,
    geminiConfigured: false,
  });
  nlMock.parseNaturalLanguage.mockResolvedValue({
    source: "local",
    result: { kind: "action", action: { id: "accounts" } },
  });
  const cfgMock = configService;
  cfgMock.loadPublicConfig.mockResolvedValue({});
  const svcMock = demoAgentService;
  svcMock.sendAgentMessage.mockResolvedValue({ success: true, reply: "Done." });
  useVertical.mockReturnValue(DEFAULT_VERTICAL_MOCK);
});

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "bankUser",
  firstName: "Test",
  lastName: "User",
};
const adminUser = {
  id: "a1",
  role: "admin",
  email: "admin@test.com",
  username: "adminUser",
  firstName: "Admin",
  lastName: "User",
};

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

// ─── Suggestion chips ────────────────────────────────────────────────────────

describe("Suggestion chips — customer role", () => {
  const CUSTOMER_SUGGESTIONS = [
    "Show me my accounts",
    "Show me my full account details",
    "Transfer $100 from checking to savings",
    "Deposit $50 into checking",
  ];

  beforeEach(() => {
    renderAgent({ user: customerUser, mode: "inline" });
  });

  it("renders all customer suggestion chips", () => {
    CUSTOMER_SUGGESTIONS.forEach((text) => {
      expect(screen.getByText(`"${text}"`)).toBeInTheDocument();
    });
  });

  it("renders suggestion chips as buttons", () => {
    const chips = screen.getAllByRole("button", {
      name: /Show me my accounts|Transfer .100|Deposit .50/i,
    });
    expect(chips.length).toBeGreaterThan(0);
  });
});

describe("Suggestion chips — admin role", () => {
  const ADMIN_SUGGESTIONS = [
    "Show all customer accounts",
    "Show me last 5 errors",
    "What is step-up auth?",
  ];

  beforeEach(() => {
    renderAgent({ user: adminUser, mode: "inline" });
  });

  it("renders all 3 admin suggestion chips", () => {
    ADMIN_SUGGESTIONS.forEach((text) => {
      expect(screen.getByText(`"${text}"`)).toBeInTheDocument();
    });
  });

  it("does NOT show customer suggestions for admin", () => {
    expect(screen.queryByText('"Show me my accounts"')).not.toBeInTheDocument();
  });
});

// ─── Suggestion chips in all 3 modes ─────────────────────────────────────────

describe("Suggestion chips — all 3 modes render correctly", () => {
  const FIRST_CUSTOMER_SUGGESTION = '"Show me my accounts"';

  it("inline (middle) mode: renders suggestion chips", () => {
    renderAgent({
      user: customerUser,
      mode: "inline",
      embeddedDockBottom: false,
    });
    expect(screen.getByText(FIRST_CUSTOMER_SUGGESTION)).toBeInTheDocument();
  });

  it("inline bottom-dock mode: renders suggestion chips", () => {
    renderAgent({
      user: customerUser,
      mode: "inline",
      embeddedDockBottom: true,
    });
    expect(screen.getByText(FIRST_CUSTOMER_SUGGESTION)).toBeInTheDocument();
  });
});

// ─── Clicking a suggestion chip ───────────────────────────────────────────────

describe("Suggestion chip click — dispatches NL query", () => {
  it("clicking a suggestion chip dispatches NL query with the chip text", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    const chip = screen.getByText('"Show me my accounts"');
    fireEvent.click(chip);
    await waitFor(() => {
      expect(
        screen.getAllByText("Show me my accounts").length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows the chip text as a user message in chat", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    const chip = screen.getByText('"Show me my accounts"');
    fireEvent.click(chip);
    await waitFor(() => {
      const userMsgs = screen.getAllByText("Show me my accounts");
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ─── Action chips ─────────────────────────────────────────────────────────────

const CORE_ACTION_LABELS = [
  "My Accounts",
  "Recent Transactions",
  "Check Balance",
  "Deposit",
  "Withdraw",
  "Transfer",
  "Sign Out",
];

describe("Action chips — logged-in customer", () => {
  beforeEach(() => {
    renderAgent({ user: customerUser, mode: "inline" });
  });

  it("renders all 7 core action items", () => {
    CORE_ACTION_LABELS.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it("action chips are buttons", () => {
    CORE_ACTION_LABELS.forEach((label) => {
      const btn = screen.getByText(label).closest("button");
      expect(btn).toBeInTheDocument();
    });
  });
});

describe("Action chips — not logged in", () => {
  it("does not render action items when user is null", () => {
    renderAgent({ user: null, mode: "inline" });
    CORE_ACTION_LABELS.filter((l) => l !== "Sign Out").forEach((label) => {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    });
  });
});

describe("Action chips — all 3 modes", () => {
  it("inline (middle) mode: renders action items", () => {
    renderAgent({
      user: customerUser,
      mode: "inline",
      embeddedDockBottom: false,
    });
    expect(screen.getByText("My Accounts")).toBeInTheDocument();
    expect(screen.getByText("Transfer")).toBeInTheDocument();
  });

  it("inline bottom-dock mode: renders action items", () => {
    renderAgent({
      user: customerUser,
      mode: "inline",
      embeddedDockBottom: true,
    });
    expect(screen.getByText("My Accounts")).toBeInTheDocument();
    expect(screen.getByText("Transfer")).toBeInTheDocument();
  });
});

// ─── Action chips — disabled when consent blocked ─────────────────────────────

describe("Action chips — disabled when consent blocked", () => {
  beforeEach(() => {
    agentAccessConsent.isAgentBlockedByConsentDecline.mockReturnValue(true);
  });

  afterEach(() => {
    agentAccessConsent.isAgentBlockedByConsentDecline.mockReturnValue(false);
  });

  it("disables action buttons when consent is blocked (except Sign Out)", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    act(() => {
      window.dispatchEvent(new Event("bankingAgentConsentBlockChanged"));
    });
    const depositBtn = screen.getByText("Deposit").closest("button");
    expect(depositBtn).toBeDisabled();
  });

  it("Sign Out button remains enabled when consent blocked", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    const logoutBtn = screen.getByText("Sign Out").closest("button");
    expect(logoutBtn).not.toBeDisabled();
  });

  it("suggestion chips are disabled when consent blocked", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    act(() => {
      window.dispatchEvent(new Event("bankingAgentConsentBlockChanged"));
    });
    const chip = screen.getByText('"Show me my accounts"').closest("button");
    expect(chip).toBeDisabled();
  });
});

// ─── Actions dropdown removed (Task 7) ────────────────────────────────────────
// The "Actions ▾" trigger + its discovery popout (search box, scope picker,
// BankingChips/SecurityShowcasePanel action-group listing) were deleted —
// see docs/superpowers/plans/2026-07-24-actions-dropdown-removal.md Task 7.
// Its content is reachable elsewhere now: catalog entries via /use-cases,
// admin/PingOne ops via the `Admin ▾` popout (AdminToolsDropdown.jsx,
// AdminToolsDropdown.test.jsx), and the 3 previously popout-only attack
// showcases via the AI Attacks education drawer (AiAttacksPanel.js,
// AiAttacksPanel.runButtons.test.jsx / AiAttacksPanel.inlineAgent.test.jsx).
// The scope toggle and "Clear progress" moved inline into the header (Task 6).

describe("Discovery popout — '⊞ All actions' button (inline, non-popout fallback)", () => {
  // This is the SEPARATE `!useActionsPopout` left-column fallback (isInline &&
  // !distinctFloatingChrome) — unaffected by the main Actions dropdown removal
  // above, but its own "⊞ All actions" trigger opened the same now-deleted
  // popout, so it was removed too (a task-review finding, not part of the
  // original brief) rather than left as a silently-broken no-op click. Only
  // reachable via a bare mode="inline" mount (no production route uses it
  // without distinctFloatingChrome — see App.js's single AIAgent mount).
  it("inline mode: 'All actions' button is no longer rendered (its popout was deleted)", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    expect(
      screen.queryByRole("button", { name: /All actions/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Header controls after the Actions dropdown removal", () => {
  it("float mode: no 'Actions' trigger, but Guide/Demo steps/scope picker/Clear progress still render", async () => {
    renderAgent({ user: customerUser, mode: "float" });
    const fab = screen.getByRole("button", { name: /Open.*AI Agent/i });
    await act(async () => {
      fireEvent.click(fab);
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    expect(
      screen.queryByRole("button", { name: /^Actions/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Guide$/i })).toBeInTheDocument();
    expect(document.querySelector(".agent-scope-picker-row")).toBeInTheDocument();
    expect(screen.getByTestId("header-clear-progress")).toBeInTheDocument();
  });
});

// ─── Server status chips (header) ─────────────────────────────────────────────

describe("Server status chips in header", () => {
  it("shows brand name in the panel when logged in", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    expect(screen.getByText(/Super Banking/i)).toBeInTheDocument();
  });

  it("does not crash in float mode (server chips rendered after open)", async () => {
    renderAgent({ user: customerUser, mode: "float" });
    const fab = screen.getByRole("button", { name: /Open.*AI Agent/i });
    await act(async () => {
      fireEvent.click(fab);
    });
    // Server-status indicator chip renders in the header once the panel is open.
    await waitFor(() => {
      expect(document.querySelector(".ba-status-dot")).not.toBeNull();
    });
  });
});

// ─── Config-focus mode chips ──────────────────────────────────────────────────

describe("Config-focus embedded mode — limited action chips", () => {
  it("shows only mcp_tools and logout actions in config focus", () => {
    renderAgent({
      user: customerUser,
      mode: "inline",
      embeddedFocus: "config",
    });
    // In config focus only CONFIG_ACTION_IDS = ['mcp_tools', 'logout'] are shown
    expect(screen.getByText("MCP Tools")).toBeInTheDocument();
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
    // Banking actions should NOT appear
    expect(screen.queryByText("Deposit")).not.toBeInTheDocument();
    expect(screen.queryByText("Transfer")).not.toBeInTheDocument();
  });

  it("shows config-specific suggestions in config focus", () => {
    renderAgent({
      user: customerUser,
      mode: "inline",
      embeddedFocus: "config",
    });
    // Config suggestions are different from banking suggestions
    expect(screen.queryByText('"Show me my accounts"')).not.toBeInTheDocument();
    // At least one config suggestion should appear — check for any rendered suggestion button
    const suggestionBtns = document.querySelectorAll("button.ba-suggestion");
    expect(suggestionBtns.length).toBeGreaterThan(0);
  });
});

// ─── Not-logged-in state ──────────────────────────────────────────────────────

describe("Chips when not logged in", () => {
  it("does not render action items when user is null", () => {
    renderAgent({ user: null, mode: "inline" });
    expect(screen.queryByText("Deposit")).not.toBeInTheDocument();
    expect(screen.queryByText("My Accounts")).not.toBeInTheDocument();
  });

  it("renders FAB without crashing when user is null in float mode", () => {
    // Float mode with no user: just renders a collapsed FAB
    expect(() => renderAgent({ user: null, mode: "float" })).not.toThrow();
    expect(
      screen.getByRole("button", { name: /Open.*AI Agent/i }),
    ).toBeInTheDocument();
  });

  it("does not crash when user is null in bottom dock mode", () => {
    expect(() =>
      renderAgent({ user: null, mode: "inline", embeddedDockBottom: true }),
    ).not.toThrow();
  });
});

// ─── My Dashboard button placement ───────────────────────────────────────────
// Regression: dashboard button was in left-col (nav column); moved below prompt
// in right-col so it's visible even when consent is blocked.
// Note: button is hidden on marketing paths ("/", "/dashboard") — tests use "/accounts".

function renderAgentAtAccounts(props = {}) {
  return render(
    <MemoryRouter initialEntries={["/accounts"]}>
      <ProofOfEnforcementProvider>
        <ActivityNarrativeProvider>
          <AIAgent {...props} />
        </ActivityNarrativeProvider>
      </ProofOfEnforcementProvider>
    </MemoryRouter>,
  );
}

describe("My Dashboard button placement", () => {
  it("renders My Dashboard button when logged in (inline mode)", () => {
    renderAgentAtAccounts({ user: customerUser, mode: "inline" });
    expect(screen.getByText("My Dashboard")).toBeInTheDocument();
  });

  it("renders Admin Dashboard button for admin user", () => {
    renderAgentAtAccounts({ user: adminUser, mode: "inline" });
    expect(screen.getByText("Admin Dashboard")).toBeInTheDocument();
  });

  it("My Dashboard button is a button element", () => {
    renderAgentAtAccounts({ user: customerUser, mode: "inline" });
    const btn = screen.getByText("My Dashboard").closest("button");
    expect(btn).toBeInTheDocument();
  });

  it("My Dashboard button is NOT inside ba-left-col (must be below prompt)", () => {
    const { container } = renderAgentAtAccounts({
      user: customerUser,
      mode: "inline",
    });
    const leftCol = container.querySelector(".ba-left-col");
    const btn = screen.getByText("My Dashboard");
    expect(leftCol).not.toContainElement(btn);
  });

  it("My Dashboard button is inside ba-right-col (chat column)", () => {
    const { container } = renderAgentAtAccounts({
      user: customerUser,
      mode: "inline",
    });
    const rightCol = container.querySelector(".ba-right-col");
    const btn = screen.getByText("My Dashboard");
    expect(rightCol).toContainElement(btn);
  });

  it("My Dashboard button not rendered when user is null", () => {
    renderAgent({ user: null, mode: "inline" });
    expect(screen.queryByText("My Dashboard")).not.toBeInTheDocument();
  });

  it("renders My Dashboard in bottom-dock mode", () => {
    renderAgentAtAccounts({
      user: customerUser,
      mode: "inline",
      embeddedDockBottom: true,
    });
    expect(screen.getByText("My Dashboard")).toBeInTheDocument();
  });
});

// ─── Consent-denied notice ────────────────────────────────────────────────────
// Regression: the notice rendered as a 3rd flex column in inline/row-reverse mode,
// squeezing the chat column and hiding the prompt. It is now a DraggableModal
// portalled to document.body, so it can no longer take part in the ba-body layout.

describe("Consent-denied banner visibility", () => {
  beforeEach(() => {
    agentAccessConsent.isAgentBlockedByConsentDecline.mockReturnValue(true);
  });

  afterEach(() => {
    agentAccessConsent.isAgentBlockedByConsentDecline.mockReturnValue(false);
  });

  it("renders the consent-denied banner when consent is blocked", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    act(() => {
      window.dispatchEvent(new Event("bankingAgentConsentBlockChanged"));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Access denied/)).toBeInTheDocument();
  });

  it("notice renders in a modal portal, never as a ba-body flex child", () => {
    const { container } = renderAgent({ user: customerUser, mode: "inline" });
    act(() => {
      window.dispatchEvent(new Event("bankingAgentConsentBlockChanged"));
    });
    const body = container.querySelector(".ba-body");
    const alert = screen.getByRole("alert");
    expect(body).not.toContainElement(alert);
    expect(document.querySelector(".dm-panel")).toContainElement(alert);
  });

  it("banner is NOT inside ba-left-col or ba-right-col (must be a direct ba-body child)", () => {
    const { container } = renderAgent({ user: customerUser, mode: "inline" });
    act(() => {
      window.dispatchEvent(new Event("bankingAgentConsentBlockChanged"));
    });
    const leftCol = container.querySelector(".ba-left-col");
    const rightCol = container.querySelector(".ba-right-col");
    const alert = screen.getByRole("alert");
    expect(leftCol).not.toContainElement(alert);
    expect(rightCol).not.toContainElement(alert);
  });

  it("shows Sign out and Learn: Human-in-the-loop buttons in banner", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    act(() => {
      window.dispatchEvent(new Event("bankingAgentConsentBlockChanged"));
    });
    expect(
      screen.getAllByRole("button", { name: /Sign out/i }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("button", { name: /Learn.*Human.in.the.loop/i }),
    ).toBeInTheDocument();
  });

  it("renders banner in bottom-dock mode", () => {
    renderAgent({
      user: customerUser,
      mode: "inline",
      embeddedDockBottom: true,
    });
    act(() => {
      window.dispatchEvent(new Event("bankingAgentConsentBlockChanged"));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not render banner when consent is not blocked", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    // isAgentBlockedByConsentDecline returns false by default in afterEach reset;
    // before dispatching event, component state stays false
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ─── Action chip → MCP tool dispatch ─────────────────────────────────────────
// These tests verify that clicking a chip calls the correct bankingAgentService
// function. The component calls the service then adds a chat message with the result.

describe("Action chip dispatch — MCP tool calls", () => {
  let svcMock;
  beforeEach(() => {
    svcMock = demoAgentService;
    svcMock.getMyAccounts.mockClear();
    svcMock.getMyTransactions.mockClear();
    svcMock.getAccountBalance.mockClear();
    svcMock.createDeposit.mockClear();
    svcMock.createTransfer?.mockClear?.();
  });

  it("'My Accounts' chip adds user message to chat", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    await act(async () => {
      fireEvent.click(screen.getByText("My Accounts"));
    });
    // runAction calls addMessage("user", label) — expect the label in a chat bubble
    await waitFor(() => {
      const msgs = screen.getAllByText("My Accounts");
      // At least 2: the chip button + the user chat message
      expect(msgs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("'Recent Transactions' chip adds user message to chat", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    await act(async () => {
      fireEvent.click(screen.getByText("Recent Transactions"));
    });
    await waitFor(() => {
      const msgs = screen.getAllByText("Recent Transactions");
      expect(msgs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("'Check Balance' chip dispatches getAccountBalance via runAction", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    await act(async () => {
      fireEvent.click(screen.getByText("Check Balance"));
    });
    // Balance is an API_DIRECT_CHIPS — runAction calls getAccountBalance immediately
    await waitFor(() => expect(svcMock.getAccountBalance).toHaveBeenCalled());
  });

  it("'Account nickname' chip dispatches get_account_nickname via callMcpTool", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    await act(async () => {
      fireEvent.click(screen.getByText("Account nickname"));
    });
    await waitFor(() =>
      expect(svcMock.callMcpTool).toHaveBeenCalledWith(
        "get_account_nickname",
        {},
        // 3rd arg: runAction now always forwards { useCaseId, vertical } opts
        // (null here — this chip is clicked directly, not via a chip carrying
        // a useCaseId) so proof-of-enforcement context threads through, plus
        // an onTokenEvent callback that live-appends to Token Chain.
        expect.objectContaining({
          useCaseId: null,
          vertical: null,
          onTokenEvent: expect.any(Function),
        }),
      ),
    );
  });

  it("'Deposit' chip dispatches createDeposit via runAction", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    await act(async () => {
      fireEvent.click(screen.getByText("Deposit"));
    });
    // Deposit is an API_DIRECT_CHIPS — runAction calls createDeposit immediately
    await waitFor(() => expect(svcMock.createDeposit).toHaveBeenCalled());
  });

  it("'Transfer' chip dispatches via runAction (API_DIRECT_CHIPS)", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    await act(async () => {
      fireEvent.click(screen.getByText("Transfer"));
    });
    // Transfer is an API_DIRECT_CHIPS — dispatches immediately via runAction
    // (creates a user message in chat)
    await waitFor(() => {
      const msgs = screen.getAllByText("Transfer");
      expect(msgs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("'Think Through a Question' chip pre-fills prompt with think example", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    fireEvent.click(screen.getByText("Think Through a Question"));
    const input = screen.getByRole("textbox");
    expect(input.value).toMatch(/Think:/i);
  });

  // "admin actions popout renders the admin action chips" (BankingChips'
  // discovery-popout admin section) removed with the Actions dropdown (Task 7).
  // Equivalent, real coverage already exists for its replacement:
  // AdminToolsDropdown.test.jsx's "loads and lists tools when open" asserts
  // the identical "Look Up Customer" / "List all apps" content via the new
  // `Admin ▾` popout.
});

// ─── Suggested prompts (Actions dropdown) ────────────────────────────────────
// Validate that the suggestion lists contain useful, working example prompts.

describe("Suggested prompts — customer list", () => {
  const EXPECTED = [
    "Show me my accounts",
    "Transfer $100 from checking to savings",
    "Deposit $50 into checking",
  ];
  it("contains key customer prompts", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    EXPECTED.forEach((text) => {
      expect(screen.getByText(`"${text}"`)).toBeInTheDocument();
    });
  });

  it("each customer suggestion is a clickable button", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    EXPECTED.forEach((text) => {
      const btn = screen.getByText(`"${text}"`).closest("button");
      expect(btn).not.toBeNull();
      expect(btn).not.toBeDisabled();
    });
  });
});

describe("Suggested prompts — admin list", () => {
  it("admin sees 'Show all customer accounts' suggestion", () => {
    renderAgent({ user: adminUser, mode: "inline" });
    expect(
      screen.getByText('"Show all customer accounts"'),
    ).toBeInTheDocument();
  });

  it("admin does not see 'Show me my accounts' (customer-only prompt)", () => {
    renderAgent({ user: adminUser, mode: "inline" });
    expect(screen.queryByText('"Show me my accounts"')).not.toBeInTheDocument();
  });
});

// ─── Error-role messages must render in the transcript ───────────────────────
// Regression: the transcript filter only passed user/assistant (+token-event
// behind RFC info), so role:"error" cards — including the admin-token-on-
// customer "Log in as customer" card from maybeHandleCustomerLogin — were
// added to state but never rendered. The agent looked like it gave NO response.

describe("Error-role messages render (admin token on customer agent)", () => {
  let origFetch;

  beforeEach(() => {
    origFetch = global.fetch;
    // Typed sends hit /api/demo-agent/nl with raw fetch; resolve it to the
    // admin lookup_customer vertical intent. Any other fetch gets a benign {}.
    global.fetch = jest.fn((url) => {
      if (String(url).includes("/api/demo-agent/nl")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            source: "heuristic",
            result: {
              kind: "vertical",
              vertical: "admin",
              action: "lookup_customer",
              params: {},
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    demoAgentService.sendAgentMessage.mockResolvedValue({
      success: false,
      error: "admin_token_on_customer",
      code: "admin_token_on_customer",
      requiresCustomerLogin: true,
      reply:
        "This action needs a customer sign-in. You are signed in with an admin token, " +
        "which cannot read customer banking data. Log in as a customer to continue, " +
        "or cancel to stay on the admin console.",
      toolsCalled: [],
      _status: 200,
    });
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it("shows the login-as-customer error card instead of silence", async () => {
    renderAgent({ user: adminUser, mode: "inline" });
    const input = screen.getByPlaceholderText(/^Message /);
    fireEvent.change(input, { target: { value: "look up a customer" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The NL → /agent/invoke flow must have run; the card must then RENDER
    // (the original bug: message added to state but dropped by the role filter).
    await waitFor(() => {
      expect(demoAgentService.sendAgentMessage).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.getByText(/needs a customer sign-in/i),
      ).toBeInTheDocument();
      expect(screen.getByText("Log in as customer")).toBeInTheDocument();
    });
  });
});

// ─── /nl error envelopes must degrade gracefully ─────────────────────────────
// Regression: when the BFF is restarting, the UI proxy answers /api/demo-agent/nl
// with 502 {"error":"proxy_error"} — a JSON body with NO `result`. dispatchNlResult
// then crashed reading `result.kind`, surfacing the raw TypeError as
// "Could not parse: Cannot read properties of undefined (reading 'kind')".

describe("NL error envelope (BFF restarting) degrades gracefully", () => {
  let origFetch;

  beforeEach(() => {
    origFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      if (String(url).includes("/api/demo-agent/nl")) {
        // Vite proxy shape when the BFF is down: JSON, parses fine, no `result`.
        return Promise.resolve({
          ok: false,
          status: 502,
          json: async () => ({ error: "proxy_error", detail: "ECONNREFUSED" }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it("shows a friendly backend-unavailable message, not a TypeError", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "show my accounts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByText(/may be restarting|backend .*unavailable/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/Could not parse: Cannot read properties/i),
    ).not.toBeInTheDocument();
  });
});

// ─── Agent-run failures must never render the raw backend error ──────────────
// Regression: a gateway policy DENY came back as HTTP 200 {success:false,
// reply:"❌ Gateway policy denied the tool call"}. reportNlFailure had no branch
// for the code, so it echoed the reply as "Could not parse: ❌ Gateway policy
// denied the tool call" — a demo step showing a raw backend string.

describe("agent failure envelopes render a plain sentence, not the raw error", () => {
  let origFetch;

  // Real chip path: /nl resolves a vertical intent (fetch), then sendAgentMessage
  // (mocked service) runs the tool and returns success:false with backend prose.
  const mockAgentFailure = async (body) => {
    demoAgentService.sendAgentMessage.mockResolvedValue(body);
    global.fetch = jest.fn((url) => {
      if (String(url).includes("/api/demo-agent/nl")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            result: { kind: "vertical", action: "list_gear", vertical: "sporting-goods", params: {} },
            source: "heuristic",
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
  };

  beforeEach(() => {
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it("maps gateway_policy_denied to a friendly sentence", async () => {
    await mockAgentFailure({
      success: false,
      error: "gateway_policy_denied",
      reply: "❌ Gateway policy denied the tool call",
    });
    renderAgent({ user: customerUser, mode: "inline" });
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "my gear" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByText(/declined by the gateway's authorization policy/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Could not parse/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Gateway policy denied the tool call/i),
    ).not.toBeInTheDocument();
  });

  // needsParams is also success:false, but its reply is the useful clarification
  // question — it must NOT be swallowed by the failure-sentence mapping.
  it("keeps the needsParams clarification reply intact", async () => {
    await mockAgentFailure({
      success: false,
      reply: "To show gear order, I need: Order ID. Please provide this detail.",
      needsParams: { action: "show_gear_order", missing: ["orderId"], hint: null },
    });
    renderAgent({ user: customerUser, mode: "inline" });
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "my gear order" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText(/I need: Order ID/i)).toBeInTheDocument();
    });
  });

  it("falls back to a plain sentence when the failure carries no code", async () => {
    // No `error` field at all — the shape a BFF that predates the errorCode
    // plumbing returns. Must still resolve to a sentence, never the raw reply.
    await mockAgentFailure({
      success: false,
      reply: "❌ ECONNRESET at upstream::0x7f",
    });
    renderAgent({ user: customerUser, mode: "inline" });
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "my gear" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByText(/couldn't be completed.*pick another demo step/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/ECONNRESET/i)).not.toBeInTheDocument();
  });

  // Regression: "my gear" → list_gear → token exchange failed with
  // delegation_chain_broken → UI showed "Could not parse: ❌ Delegation chain
  // validation failed." instead of a friendly sentence.
  it("maps delegation_chain_broken to a friendly sentence, not the raw error", async () => {
    await mockAgentFailure({
      success: false,
      error: "delegation_chain_broken",
      reply: "❌ Delegation chain validation failed.",
    });
    renderAgent({ user: customerUser, mode: "inline" });
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "my gear" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByText(/Token exchange failed/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Could not parse/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Delegation chain validation failed/i),
    ).not.toBeInTheDocument();
  });
});

// ─── Chip useCaseId → dispatchNlResult (REMOVED — mechanism now unreachable) ──
// These 3 describe blocks tested dispatchNlResult's useCaseId-forwarding logic
// (→ sendAgentMessage's opts / getMyAccounts' params / getMyTransactions'
// params) by injecting a custom chip into pageManifest.dashboard.chips10 and
// clicking it inside the old Actions popout (BankingChips, deleted in Task 7
// — see docs/superpowers/plans/2026-07-24-actions-dropdown-removal.md).
//
// Verified before deleting (grepped every remaining dispatchNlResult call site
// in AIAgent.js): `dashboard.chips10` had exactly one consumer — BankingChips.jsx
// — so no UI surface reads it anymore. Every surviving chip-click path either
// (a) calls sendAsNl(message) → dispatchNlResult(result, source, text) with
// only 3 args, never a useCaseId, or (b) bypasses dispatchNlResult entirely via
// the nlResumeAfterAuth/sendAgentMessage-direct mechanism (Demo Steps, Admin
// Tools, /use-cases, CustomChipsTab's Run button), which explicitly sets
// pendingUcIdRef instead. dispatchNlResult's own useCaseId parameter and
// forwarding logic are untouched and still correct — they are just not
// currently exercised by any live caller. Flagged in the Task 7 report as a
// residual concern rather than silently removed from AIAgent.js, since the
// parameter may be needed again if a future caller reintroduces it.

// ─── Header toolbar portal (live workbench hoist) ────────────────────────────

describe("Header controls portal", () => {
  afterEach(() => {
    mockAgentUiMode.toolbarHostEl = null;
  });

  it("renders the header controls inside the agent header when no host is registered", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    const clear = screen.getByTestId("header-clear-progress");
    expect(clear.closest(".ba-header")).not.toBeNull();
  });

  it("portals the header controls into a registered toolbar host", () => {
    const host = document.createElement("div");
    host.setAttribute("data-testid", "toolbar-host");
    document.body.appendChild(host);
    mockAgentUiMode.toolbarHostEl = host;

    renderAgent({ user: customerUser, mode: "inline" });

    const clear = screen.getByTestId("header-clear-progress");
    expect(host.contains(clear)).toBe(true);
    expect(clear.closest(".ba-header")).toBeNull();
    // The controls keep their wrapper class, so existing selectors still resolve.
    expect(clear.closest(".ba-header-tools")).not.toBeNull();

    document.body.removeChild(host);
  });
});
