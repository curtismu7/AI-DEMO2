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

describe("ID-JAG agent phrases", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearIdJagRunState();
  });
  afterEach(() => {
    clearIdJagRunState();
    sessionStorage.clear();
  });
  it.each(["run demo", "run ID-JAG demo", "enterprise managed MCP", "show my balance"])(
    "launches %s in the UC40 use-case context",
    async (phrase) => {
      const onLaunch = vi.fn();
      window.addEventListener("id-jag-run-requested", onLaunch);
      try {
        renderAgent({ user: customerUser, mode: "inline" }, { route: "/dashboard" });
        act(() => window.dispatchEvent(new CustomEvent("banking-agent-prefill", {
          detail: { useCaseId: ID_JAG_USE_CASE_ID, message: phrase },
        })));
        const input = screen.getByPlaceholderText(/^Message |^Ask about/);
        await waitFor(() => expect(input).toHaveValue(phrase));
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
        expect(onLaunch.mock.calls[0][0].detail).toMatchObject({
          useCaseId: ID_JAG_USE_CASE_ID,
          mode: "live-id-jag",
          message: "show my balance",
          returnTo: "/dashboard",
        });
        expect(demoAgentService.sendAgentMessage).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("id-jag-run-requested", onLaunch);
      }
    },
  );

  it.each(["show my balance", "run demo"])(
    "keeps an unscoped %s request on the ordinary NL path",
    async (phrase) => {
      const onLaunch = vi.fn();
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ source: "heuristic", result: { kind: "none" } }),
      });
      window.addEventListener("id-jag-run-requested", onLaunch);
      try {
        renderAgent({ user: customerUser, mode: "inline" }, { route: "/dashboard" });
        const input = screen.getByPlaceholderText(/^Message |^Ask about/);
        fireEvent.change(input, { target: { value: phrase } });
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
          "/api/demo-agent/nl",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining(`"message":"${phrase}"`),
          }),
        ));
        expect(onLaunch).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("id-jag-run-requested", onLaunch);
        fetchSpy.mockRestore();
      }
    },
  );

  it("replays a validated callback exactly once with live UC40 metadata", async () => {
    const onPrefill = vi.fn();
    window.addEventListener("banking-agent-prefill", onPrefill);
    try {
      renderAgent({ user: customerUser, mode: "inline" }, { route: "/dashboard" });
      act(() => window.dispatchEvent(new CustomEvent("userAuthenticated")));
      expect(onPrefill).not.toHaveBeenCalled();
      const callback = new CustomEvent("userAuthenticated", { detail: {
        idJagCallbackValidated: true,
        useCaseId: ID_JAG_USE_CASE_ID,
        mode: "live-id-jag",
        message: "show my balance",
      } });
      act(() => {
        window.dispatchEvent(callback);
        window.dispatchEvent(callback);
      });
      expect(onPrefill).toHaveBeenCalledTimes(1);
      expect(onPrefill.mock.calls[0][0].detail).toEqual({
        useCaseId: ID_JAG_USE_CASE_ID,
        mode: "live-id-jag",
        message: "show my balance",
        autoSend: true,
      });
    } finally {
      window.removeEventListener("banking-agent-prefill", onPrefill);
    }
  });

  it("sends the saved PF callback prompt after a late agent mount", async () => {
    sessionStorage.setItem(ID_JAG_VALIDATED_CALLBACK_KEY, JSON.stringify({
      idJagCallbackValidated: true,
      useCaseId: ID_JAG_USE_CASE_ID,
      mode: "live-id-jag",
      message: "show my balance",
    }));
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ source: "heuristic", result: { kind: "none" } }),
    });
    try {
      renderAgent({ user: customerUser, mode: "inline" }, { route: "/dashboard" });
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
        "/api/demo-agent/nl",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"message":"show my balance"'),
        }),
      ));
      expect(sessionStorage.getItem(ID_JAG_REPLAYED_KEY)).toBe("1");
    } finally {
      fetchSpy.mockRestore();
    }
  });
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

// Product rule: "show all actions, then authenticate when the UC requires it,
// and we have SoT". These two blocks previously asserted the OPPOSITE — that a
// guest sees no action chips — which hid the demo's discovery story behind a
// bare `isLoggedIn &&` at the render site. Discovery is now ungated; the auth
// challenge moved to dispatch (chipAuthLevel → handleChipActivate).
describe("Action chips — not logged in", () => {
  it("DOES render action items when user is null (discovery is never gated)", () => {
    renderAgent({ user: null, mode: "inline" });
    CORE_ACTION_LABELS.filter((l) => l !== "Sign Out").forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it("clicking a session-requiring chip offers sign-in instead of dispatching", async () => {
    renderAgent({ user: null, mode: "inline" });
    fireEvent.click(screen.getByText("My Accounts").closest("button"));
    // The offer, not a 401 round-trip — same shape handleDemoStepSelect uses.
    expect(await screen.findByText(/needs you signed in/i)).toBeInTheDocument();
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
