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
import { ThemeProvider } from "../../context/ThemeContext";
import * as demoAgentNlService from "../../services/demoAgentNlService";
import * as configService from "../../services/configService";
import * as demoAgentService from "../../services/demoAgentService";
import * as agentAccessConsent from "../../services/agentAccessConsent";
import { useVertical } from "../../vertical/useVertical";
import { clearIdJagRunState, ID_JAG_REPLAYED_KEY, ID_JAG_USE_CASE_ID, ID_JAG_VALIDATED_CALLBACK_KEY } from "../../utils/idJagRunMode";
import { PI_FLOW_SIGNIN_EVENT } from "../../utils/authUi";

const simpleStepperPanelMock = vi.hoisted(() => ({ props: [] }));

// ─── Mock heavy dependencies ─────────────────────────────────────────────────

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

const mockAgentUiMode = {
  placement: "none",
  fab: true,
  setAgentUi: vi.fn(),
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
  useVertical: vi.fn(),
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

vi.mock("../SimpleStepperPanel", () => ({
  default: (props) => {
    simpleStepperPanelMock.props.push(props);
    return null;
  },
}));

vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi
    .fn()
    .mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
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
  fetchAgentTools: vi
    .fn()
    .mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
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
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../utils/appToast", () => ({
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

// CSS imports are no-ops in tests
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Clear localStorage and re-arm async mocks before each test.
// BankingAgent persists isOpen to localStorage which can contaminate subsequent tests.
// vi.fn().mockResolvedValue() in a factory can be silently cleared; re-arm to be safe.
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

function renderAgent(props = {}, { route = "/" } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ProofOfEnforcementProvider>
        <ActivityNarrativeProvider>
          <AIAgent {...props} />
        </ActivityNarrativeProvider>
      </ProofOfEnforcementProvider>
    </MemoryRouter>,
  );
}

function renderThemedAgent(props = {}, { route = "/" } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <ProofOfEnforcementProvider>
          <ActivityNarrativeProvider>
            <AIAgent {...props} />
          </ActivityNarrativeProvider>
        </ProofOfEnforcementProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

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

// ─── Sign-in triggers route through the pi.flow modal ────────────────────────
// The agent's login chips dispatch PI_FLOW_SIGNIN_EVENT (the branded modal);
// they never redirect straight to a BFF login endpoint.
describe("Sign-in chips open the pi.flow modal", () => {
  test("the guest sign-in prompt opens the modal, not a redirect", async () => {
    const handled = vi.fn((e) => { e.detail.handled = true; });
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://app.test", pathname: "/", href: "", assign },
    });
    renderAgent({ user: null, mode: "inline" });
    // An auth-gated chip as a guest → the assistant offers "Sign in to continue".
    await act(async () => {
      fireEvent.click(screen.getByText("Check Balance"));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Sign in to continue" }));
    });
    // handleLoginAction defers 150ms before navigating.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(handled).toHaveBeenCalled();
    expect(window.location.href).toBe("");
    window.removeEventListener(PI_FLOW_SIGNIN_EVENT, handled);
  });
});
