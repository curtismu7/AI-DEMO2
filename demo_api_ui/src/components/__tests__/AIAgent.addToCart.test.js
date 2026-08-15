/* eslint-disable testing-library/no-unnecessary-act */
// demo_api_ui/src/components/__tests__/AIAgent.addToCart.test.js
/**
 * Task 4 fix-round-1: VerticalResult's productGrid branch renders
 * ProductCardGrid and forwards Add to Cart clicks via the onAction prop
 * threaded from AIAgent.js's runAction. This exercises that whole path for
 * real (NL request -> productGrid card renders -> click Add to Cart ->
 * runAction's "add_to_cart" switch case -> callMcpTool), the same path a
 * missing switch case would silently break with "Unknown action: add_to_cart".
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AIAgent from "../AIAgent";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";
import * as demoAgentNlService from "../../services/demoAgentNlService";
import * as configService from "../../services/configService";
import * as demoAgentService from "../../services/demoAgentService";
import { useVertical } from "../../vertical/useVertical";

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

vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({
    placement: "none",
    fab: true,
    setAgentUi: jest.fn(),
    toolbarHostEl: null,
  }),
}));

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

vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

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
    <MemoryRouter initialEntries={["/"]}>
      <ProofOfEnforcementProvider>
        <ActivityNarrativeProvider>
          <AIAgent {...props} />
        </ActivityNarrativeProvider>
      </ProofOfEnforcementProvider>
    </MemoryRouter>,
  );
}

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
  svcMock.callMcpTool.mockResolvedValue({ success: true });
  useVertical.mockReturnValue(DEFAULT_VERTICAL_MOCK);
});

// Real path: /nl resolves a "browse_gear" vertical intent (fetch, mocked
// below), sendAgentMessage (mocked service) returns success with a
// verticalResult descriptor of type "productGrid", which VerticalResult
// renders as a ProductCardGrid inline under the reply.
describe("productGrid card renders from a real NL response and Add to Cart dispatches add_to_cart", () => {
  let origFetch;

  beforeEach(() => {
    origFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      if (String(url).includes("/api/demo-agent/nl")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            result: {
              kind: "vertical",
              action: "browse_gear",
              vertical: "sporting-goods",
              params: {},
            },
            source: "heuristic",
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    demoAgentService.sendAgentMessage.mockResolvedValue({
      success: true,
      reply: "Here's some gear for your next hike.",
      verticalResult: {
        descriptor: { type: "productGrid", title: "Gear for Your Next Hike" },
        data: {
          products: [
            {
              id: "prod-boots",
              name: "Trail Runner Hiking Boots",
              icon: "boots",
              price: 129.99,
              rating: 4.6,
              reviewCount: 312,
              stock: "In stock",
            },
          ],
        },
      },
    });
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it("renders the product card and calls callMcpTool('add_to_cart', ...) when clicked", async () => {
    renderAgent({ user: customerUser, mode: "inline", forceVertical: "sporting-goods" });
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "show me hiking gear" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Trail Runner Hiking Boots")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    });

    await waitFor(() => {
      expect(demoAgentService.callMcpTool).toHaveBeenCalledWith(
        "add_to_cart",
        { productId: "prod-boots" },
        expect.objectContaining({ vertical: "sporting-goods" }),
      );
    });
  });

  // Critical fix-round-2: runAction's "add_to_cart" case dispatches via
  // callMcpTool directly (not the NL/dispatchVerticalIntent path that
  // auto-attaches verticalResult), so the raw MCP envelope response never
  // populated response.verticalResult and formatResult fell through to a raw
  // JSON.stringify dump. Assert the confirmation reads as text, not JSON.
  it("shows a plain confirmation (not a JSON dump) after Add to Cart resolves", async () => {
    // Real app: pageManifest is the active vertical's manifest.json, whose
    // render.add_to_cart descriptor is what verticalResultExtra resolves the
    // card from. Mirror that shape here instead of the default null manifest.
    useVertical.mockReturnValue({
      ...DEFAULT_VERTICAL_MOCK,
      pageManifest: {
        render: {
          add_to_cart: {
            type: "card",
            title: "Added to Cart",
            fields: [
              { label: "Item", path: "name" },
              { label: "Price", path: "price", format: "money" },
            ],
          },
        },
      },
    });
    demoAgentService.callMcpTool.mockResolvedValueOnce({
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              render: "add_to_cart",
              data: {
                id: "cart-1",
                productId: "prod-boots",
                name: "Trail Runner Hiking Boots",
                price: 129.99,
                addedAt: "2026-01-01T00:00:00.000Z",
              },
            }),
          },
        ],
        isError: false,
      },
      tokenEvents: [],
    });

    renderAgent({ user: customerUser, mode: "inline", forceVertical: "sporting-goods" });
    const input = screen.getByPlaceholderText(/^Message |^Ask about/);
    fireEvent.change(input, { target: { value: "show me hiking gear" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Trail Runner Hiking Boots")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Added Trail Runner Hiking Boots \(\$129\.99\) to your cart\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/"productId"/)).not.toBeInTheDocument();
  });
});
