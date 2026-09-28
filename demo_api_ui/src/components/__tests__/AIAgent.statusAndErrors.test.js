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

// ─── Post-OAuth auto-open ────────────────────────────────────────────────────
// The agent expands itself on return from login. On the PingOne admin console
// that buried the page the admin just signed in to see, so the auto-open is
// suppressed there and only there.
describe("Auto-open on return from OAuth login", () => {
  it("opens the panel on a non-admin route", async () => {
    renderAgent({ user: customerUser, mode: "float" }, { route: "/dashboard?oauth=success" });
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /AI Agent/i })).toBeInTheDocument();
    });
  });

  it("stays collapsed on the PingOne admin console", async () => {
    renderAgent({ user: adminUser, mode: "float" }, { route: "/admin?oauth=success" });
    // The FAB is the collapsed state; assert it is still the only affordance.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Open.*AI Agent/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: /AI Agent/i })).not.toBeInTheDocument();
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

// ─── MCP Tools is open to every role ─────────────────────────────────────────

describe("MCP Tools action visibility", () => {
  // It reads GET /api/mcp/inspector/tools, which has no auth middleware and
  // answers 200 with no cookie — the listing was already public, so grouping it
  // under `admin` hid a read-only view from a role the server serves anyway.
  it("is offered to a customer, not just an admin", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    expect(screen.getByText("MCP Tools")).toBeInTheDocument();
  });

  it("still hides the genuinely admin-only actions from a customer", () => {
    renderAgent({ user: customerUser, mode: "inline" });
    // Same group MCP Tools came from — only that one action crosses over.
    expect(screen.queryByText("Query User")).not.toBeInTheDocument();
  });

  it("still shows it to an admin", () => {
    renderAgent({ user: adminUser, mode: "inline" });
    expect(screen.getByText("MCP Tools")).toBeInTheDocument();
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
  it("renders action items when user is null — auth is enforced at dispatch, not render", () => {
    renderAgent({ user: null, mode: "inline" });
    expect(screen.getByText("Deposit")).toBeInTheDocument();
    expect(screen.getByText("My Accounts")).toBeInTheDocument();
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

describe("Error-role messages render (admin token on customer agent)", () => {
  let origFetch;

  beforeEach(() => {
    origFetch = global.fetch;
    // Typed sends hit /api/demo-agent/nl with raw fetch; resolve it to the
    // admin lookup_customer vertical intent. Any other fetch gets a benign {}.
    global.fetch = vi.fn((url) => {
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
    global.fetch = vi.fn((url) => {
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
    global.fetch = vi.fn((url) => {
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

  // UC31 ("what is the weather in Miami, FL") is an EXPECTED-deny showcase: the
  // Agent Gateway's geofence is the thing being demonstrated. The coarse `error`
  // is gateway_policy_denied for EVERY policy deny, so mapping on it alone told
  // the user only "declined by the gateway's authorization policy" and dropped
  // the reason. Measured live on SE 2026-08-31: the BFF sent gatewayErrorCode
  // "weather_scope_denied" plus a reply naming Texas, and the chat showed neither.
  it("prefers the specific gateway reason over the coarse policy sentence", async () => {
    await mockAgentFailure({
      success: false,
      error: "gateway_policy_denied",
      gatewayErrorCode: "weather_scope_denied",
      reply: "❌ Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas",
    });
    renderAgent({ user: customerUser, mode: "inline" });
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "what is the weather in Miami, FL" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText(/only allows weather lookups inside Texas/i)).toBeInTheDocument();
    });
    // The generic sentence must be gone, not merely accompanied.
    expect(
      screen.queryByText(/^That step was declined by the gateway's authorization policy/i),
    ).not.toBeInTheDocument();
    // The guard still holds: the backend's own string is never echoed verbatim.
    expect(screen.queryByText(/city not recognized as Texas/i)).not.toBeInTheDocument();
  });

  // An unmapped gatewayErrorCode must not regress the coarse behaviour.
  it("still uses the coarse sentence for a gateway code with no specific entry", async () => {
    await mockAgentFailure({
      success: false,
      error: "gateway_policy_denied",
      gatewayErrorCode: "some_unmapped_policy_rule",
      reply: "❌ nope",
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


// ─── The left column is reachable again ──────────────────────────────────────
// `useActionsPopout` was named for a popout Task 7 deleted, and it gated the ONLY
// call site of renderActionGroups. Every production mount set it, so no
// .ba-action-chip existed anywhere in the running app — measured live on
// /dashboard 2026-08-18, before and after opening the More trigger.
//
// These pin the mount shapes the real routes use. App.js, AgentPage.js and
// PublicRoutes.js all pass distinctFloatingChrome; if the flag ever gates on it
// again, the first test goes red instead of the chips quietly vanishing for
// another few months.
describe("action chips render on the mounts production actually uses", () => {
  it("dashboard shape (inline + distinctFloatingChrome) renders chips", () => {
    const { container } = renderAgent({
      user: customerUser,
      mode: "inline",
      distinctFloatingChrome: true,
    });
    expect(container.querySelectorAll(".ba-action-chip").length).toBeGreaterThan(0);
  });

  it("bare inline still renders chips — the pre-existing path is unchanged", () => {
    const { container } = renderAgent({ user: customerUser, mode: "inline" });
    expect(container.querySelectorAll(".ba-action-chip").length).toBeGreaterThan(0);
  });

  it("float mode keeps its own chrome and grows no left column", () => {
    // Float is the one surface the flag SHOULD suppress: it has its own panel
    // chrome. Restoring the inline column must not leak into it.
    const { container } = renderAgent({ user: customerUser, mode: "float" });
    expect(container.querySelectorAll(".ba-left-col").length).toBe(0);
  });
});
