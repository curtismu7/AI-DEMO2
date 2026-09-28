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
  // Float mode keeps only the title row and window buttons in the agent
  // header; the secondary controls live in the Command Dock tray. Tests in
  // this block open the dock first, exactly like a presenter would.
  async function openFloatAgentWithDock(renderFn, props = {}, opts = {}) {
    renderFn(props, opts);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Demo Controls/i }));
    });
    await waitFor(() =>
      expect(document.querySelector(".cmd-dock-body")).not.toBeNull(),
    );
  }
  async function openDock() {
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Demo Controls/i, expanded: false }),
      );
    });
    await waitFor(() =>
      expect(document.querySelector(".cmd-dock-body")).not.toBeNull(),
    );
  }

  it("always offers an Approval button that opens the safe demo drawer", async () => {
    await openFloatAgentWithDock(renderThemedAgent, { user: customerUser, mode: "float" });

    fireEvent.click(screen.getByRole("button", { name: /^Approval$/i }));

    expect(
      await screen.findByRole("dialog", { name: "Authorize Agent Action" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Extend Rental")).toBeInTheDocument();
  });

  it("float mode: no 'Actions' trigger, but Guide/Demo steps/scope picker/Clear progress still render", async () => {
    await openFloatAgentWithDock(renderThemedAgent, { user: customerUser, mode: "float" });
    expect(
      screen.queryByRole("button", { name: /^Actions/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Guide$/i })).toBeInTheDocument();
    expect(document.querySelector(".agent-scope-picker-row")).toBeInTheDocument();
    expect(screen.getByTestId("header-clear-progress")).toBeInTheDocument();
  });

  // The secondary controls moved into a "Quick Config" tray. Guide, Demo steps, the
  // scope picker and Clear progress deliberately did NOT move — the test above
  // is the 2026-07-24 Actions-dropdown-removal contract and still holds.
  it("float mode: Topology and Script are in the Quick Config tray, not the header", async () => {
    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();

    expect(screen.queryByRole("button", { name: /^Topology$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Script$/i })).not.toBeInTheDocument();

    const more = screen.getByRole("button", { name: /^Quick Config$/i });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      fireEvent.click(more);
    });

    expect(screen.getByRole("button", { name: /Pop out Quick Config/i })).toBeInTheDocument();
    expect(screen.getByText("Movie reel controls")).toBeInTheDocument();
    // The items live in the tray container, not loose in the header row. This
    // asserts structure only — jsdom applies no CSS, so whether the tray is
    // actually positioned as an overlay is not covered here.
    expect(document.querySelector(".ba-header-more-pop")).toBeInTheDocument();
    // The locked-inline controls are unaffected by opening the tray.
    expect(screen.getByRole("button", { name: /^Guide$/i })).toBeInTheDocument();
  });

  it("offers a toggle and readable surface choices for each evidence view", async () => {
    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    for (const [view, label] of [
      ["Movie reel", "Movie reel surface"],
      ["Token topology", "Token topology surface"],
      ["Simple stepper", "Simple stepper surface"],
      ["Sequence view", "Sequence view surface"],
      ["OAuth visualizer", "OAuth visualizer surface"],
    ]) {
      const viewName = view === "Movie reel"
        ? "^Movie reel Step-by-step live trace$"
        : `^${view}`;
      await act(async () => fireEvent.click(screen.getByRole("button", { name: new RegExp(viewName) })));
      const trigger = screen.getByRole("button", { name: label });
      await act(async () => {
        fireEvent.click(trigger);
      });
      const options = screen.getByRole("listbox", { name: `${label} options` });
      expect(options.querySelectorAll('[role="option"]')).toHaveLength(4);
      expect(options).toHaveTextContent("Off");
      expect(options).toHaveTextContent("Embedded");
      expect(options).toHaveTextContent("Pop-out");
      expect(options).toHaveTextContent("Both");
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: /^Off\b/ }));
      });
    }

  }, 60000);

  it("auto-pops the Simple Stepper when its surface is set to pop-out", async () => {
    simpleStepperPanelMock.props.length = 0;
    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Simple stepper/ })));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Simple stepper surface" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /^Pop-out\b/ }));
    });

    await waitFor(() => {
      expect(simpleStepperPanelMock.props.at(-1)).toEqual(expect.objectContaining({
        isOpen: true,
        autoPopOut: true,
      }));
    });
  });

  it("lets Quick Config choose the evidence view before its surface", async () => {
    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    expect(screen.getByRole("button", { name: /^Movie reel Step-by-step live trace$/ })).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Simple stepper/ }));
    });
    expect(screen.getAllByRole("button", { name: /Simple stepper/ }).find((button) => button.hasAttribute("aria-pressed"))).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Movie reel Step-by-step live trace$/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("restores Demo controls choices after the agent remounts", async () => {
    const first = renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Movie reel surface" }));
    fireEvent.click(screen.getByRole("option", { name: /^Off\b/ }));
    expect(localStorage.getItem("ba_show_filmstrip")).toBe("0");
    const sequenceCard = [...document.querySelectorAll(".ba-header-more-view-option")]
      .find((button) => button.textContent.includes("Sequence view"));
    fireEvent.click(sequenceCard);
    fireEvent.click(screen.getByRole("button", { name: /Token topology/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Token topology surface" }));
    });
    fireEvent.click(screen.getByRole("option", { name: /^Pop-out\b/ }));
    fireEvent.click(sequenceCard);
    first.unmount();

    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    const restoredSequenceCard = [...document.querySelectorAll(".ba-header-more-view-option")]
      .find((button) => button.textContent.includes("Sequence view"));
    expect(restoredSequenceCard).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Movie reel/ }));
    });
    expect(localStorage.getItem("dashboard-sequence-surface")).toBe("none");
    expect(restoredSequenceCard).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /Token topology/ }));
    expect(screen.getByRole("button", { name: "Token topology surface" })).toHaveTextContent("Pop-out");
  });

  it("keeps RFC info off when a stale embedded surface preference remains", async () => {
    localStorage.setItem("ba_show_rfc_info", "false");
    localStorage.setItem("ba_rfc_info_surface", "embedded");

    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    expect(screen.getByRole("checkbox", { name: "RFC info" })).not.toBeChecked();
  });

  it("keeps surface menus exclusive and leaves Pop-out available for every view", async () => {
    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    const views = [
      ["Movie reel", "Movie reel surface"],
      ["Token topology", "Token topology surface"],
      ["Simple stepper", "Simple stepper surface"],
      ["Sequence view", "Sequence view surface"],
      ["OAuth visualizer", "OAuth visualizer surface"],
    ];
    for (const [view, label] of views) {
      await act(async () => {
        const viewName = view === "Movie reel"
          ? "^Movie reel Step-by-step live trace$"
          : `^${view}`;
        fireEvent.click(screen.getByRole("button", { name: new RegExp(viewName) }));
      });
      const trigger = screen.getByRole("button", { name: label });
      expect(trigger).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(trigger);
      });
      expect(screen.getByRole("listbox", { name: `${label} options` })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /^Pop-out\b/ })).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: /^Off\b/ }));
      });
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Token topology Delegation map$/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Token topology Delegation map$/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Token topology surface" }));
    });
    expect(screen.getByRole("listbox", { name: "Token topology surface options" })).toBeInTheDocument();
  }, 90000);

  it("dispatches the movie reel surface choice for the dashboard", async () => {
    const surfaceChange = vi.fn();
    window.addEventListener("agent-filmstrip-toggle", surfaceChange);
    try {
      renderAgent({ user: customerUser, mode: "float" });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
      });
      await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Movie reel Step-by-step live trace$/ }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Movie reel surface" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: /^Pop-out\b/ }));
      });

      expect(surfaceChange).toHaveBeenCalledWith(expect.objectContaining({
        detail: { on: false, surface: "popout" },
      }));
    } finally {
      window.removeEventListener("agent-filmstrip-toggle", surfaceChange);
    }
  });

  it("labels trace evidence views and keeps only the selected view embedded", async () => {
    localStorage.setItem("ba_simple_stepper_surface", "embedded");
    localStorage.setItem("dashboard-sequence-surface", "embedded");
    localStorage.setItem("ba_token_topology_surface", "both");
    localStorage.setItem("ba_oauth_visualizer_surface", "embedded");

    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    expect(screen.getByRole("group", { name: "Choose one embedded trace view" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep Movie reel embedded" }));
    });
    expect(screen.getByRole("group", { name: "Trace evidence views" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Movie reel Step-by-step live trace$/ }));
    });
    expect(localStorage.getItem("ba_simple_stepper_surface")).toBe("none");
    expect(localStorage.getItem("dashboard-sequence-surface")).toBe("none");
    expect(localStorage.getItem("ba_token_topology_surface")).toBe("popout");
    expect(localStorage.getItem("ba_oauth_visualizer_surface")).toBe("none");
  });

  it("reflects movie reel surface changes coming from the dashboard", async () => {
    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Movie reel Step-by-step live trace$/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Movie reel surface" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /^Pop-out\b/ }));
    });
    expect(screen.getByRole("button", { name: "Movie reel surface" })).toHaveTextContent("Pop-out");

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-filmstrip-toggle", {
        detail: { on: false, surface: "none" },
      }));
    });
    expect(screen.getByRole("button", { name: "Movie reel surface" })).toHaveTextContent("Off");
  });

  it("marks Quick Config while a surface menu is open so its layout can expand", async () => {
    renderAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    const quickConfig = document.querySelector(".ba-header-more-pop");
    expect(quickConfig).not.toBeNull();
    expect(quickConfig).not.toHaveClass("ba-header-more-pop--surface-open");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Token topology/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Token topology surface" }));
    });

    expect(quickConfig).toHaveClass("ba-header-more-pop--surface-open");
  });

  it("supports dark mode and four-corner Quick Config resizing", async () => {
    renderThemedAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Dark mode"));
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    const quickConfig = document.querySelector(".ba-header-more-pop");
    expect(quickConfig).not.toBeNull();
    for (const direction of ["northwest", "northeast", "southwest", "southeast"]) {
      expect(quickConfig.querySelector(`[aria-label="Resize ${direction}"]`)).toBeInTheDocument();
    }
  });

  it("keeps Quick Config open for internal mouse interaction and exposes window controls", async () => {
    renderThemedAgent({ user: customerUser, mode: "float" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open.*AI Agent/i }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: /AI Agent/i }));
    await openDock();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Config$/i }));
    });

    const quickConfig = document.querySelector(".ba-header-more-pop");
    expect(quickConfig).not.toBeNull();
    expect(quickConfig).toHaveStyle({ zIndex: "100061" });
    expect(quickConfig.querySelector('[aria-label="Move Quick Config"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pop out Quick Config/i })).toBeInTheDocument();
    expect(quickConfig.querySelector('[role="separator"][tabindex="0"]')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Token topology Delegation map/i }));
    });
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("button", { name: /Token topology surface/i }));
    });
    expect(document.querySelector(".ba-header-more-pop")).toBeInTheDocument();
  });
});
