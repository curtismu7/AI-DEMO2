/**
 * @file WebMcpPanel.test.jsx
 * Unit tests for WebMcpPanel — tool listing, tool invocation,
 * SSE stream event display, and result rendering.
 *
 * All network calls are mocked via the service layer; no real HTTP or EventSource.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BrowserRouter } from "react-router-dom";

// ─── Service mocks ────────────────────────────────────────────────────────────

vi.mock("../../services/webMcpClient", () => ({
  listMcpTools: jest.fn(),
  listMcpToolsWithStream: jest.fn(),
  callMcpTool: jest.fn(),
  openMcpToolStream: jest.fn(),
  openMcpDiscoveryStream: jest.fn(),
}));

vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ setWebMcpLastResult: jest.fn() }),
}));

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: jest.fn(), close: jest.fn() }),
  useEducationUIOptional: () => ({ open: jest.fn(), close: jest.fn() }),
}));

vi.mock("../WebMcpPanel.css", () => ({}), { virtual: true });
vi.mock("../../styles/appShellPages.css", () => ({}), { virtual: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

import {
  listMcpTools,
  listMcpToolsWithStream,
  callMcpTool,
  openMcpToolStream,
} from "../../services/webMcpClient";

const MOCK_TOOLS = [
  {
    name: "get_my_accounts",
    description: "Returns all accounts for the authenticated user.",
    inputSchema: { properties: {}, required: [] },
  },
  {
    name: "get_account_balance",
    description: "Returns the balance for a specific account.",
    inputSchema: {
      properties: {
        account_id: { type: "string", description: "Account identifier" },
      },
      required: ["account_id"],
    },
  },
];

async function renderComponent() {
  const { default: WebMcpPanel } = await import("../WebMcpPanel");
  return render(
    <BrowserRouter>
      <WebMcpPanel />
    </BrowserRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  listMcpTools.mockResolvedValue({ tools: MOCK_TOOLS });
  // Component switched from listMcpTools to listMcpToolsWithStream; delegate
  // so existing tests that set listMcpTools.mockResolved/RejectedValue still
  // drive the same code path without changing every test body.
  listMcpToolsWithStream.mockImplementation((_traceId, _onPhase, _signal) =>
    listMcpTools(),
  );
  callMcpTool.mockResolvedValue({ result: { content: [{ text: "OK" }] } });
  openMcpToolStream.mockReturnValue(() => {});
});

// ─── Tool listing ─────────────────────────────────────────────────────────────

describe("WebMcpPanel — tool listing", () => {
  it("renders the panel title", async () => {
    await renderComponent();
    await waitFor(() => {
      expect(screen.getByText(/WebMCP — Tool Inspector/i)).toBeInTheDocument();
    });
  });

  it("shows available tool count after loading", async () => {
    await renderComponent();
    await waitFor(() => {
      expect(screen.getByText(/Available Tools \(2\)/i)).toBeInTheDocument();
    });
  });

  it("renders a button for each tool name", async () => {
    await renderComponent();
    await screen.findByText("get_my_accounts");
    expect(screen.getByText("get_account_balance")).toBeInTheDocument();
  });

  it("shows error message when tool listing fails", async () => {
    listMcpTools.mockRejectedValue(new Error("MCP server unreachable"));
    await renderComponent();
    await waitFor(() => {
      expect(screen.getByText(/Could not load MCP tools/i)).toBeInTheDocument();
    });
  });
});

// ─── Tool selection ───────────────────────────────────────────────────────────

describe("WebMcpPanel — tool selection", () => {
  it("clicking a tool shows its name as a detail-panel heading", async () => {
    await renderComponent();
    await screen.findByText("get_account_balance");

    fireEvent.click(screen.getByText("get_account_balance"));

    expect(
      screen.getByText("get_account_balance", { selector: ".rp-detail__title" }),
    ).toBeInTheDocument();
  });

  it("shows parameter input for required fields", async () => {
    await renderComponent();
    await screen.findByText("get_account_balance");

    fireEvent.click(screen.getByText("get_account_balance"));

    // account_id label is rendered (by McpParamText or McpParamSelect depending on accountOptions)
    expect(screen.getByText("account_id")).toBeInTheDocument();
    // a form control (select or input) is rendered for the parameter
    const paramControl = document.querySelector("select, input[type='text']");
    expect(paramControl).not.toBeNull();
  });

  it("marks required parameters with required badge", async () => {
    await renderComponent();
    await screen.findByText("get_account_balance");

    fireEvent.click(screen.getByText("get_account_balance"));

    expect(screen.getByText("required")).toBeInTheDocument();
  });

  it("shows Call Tool button after selecting a tool", async () => {
    await renderComponent();
    await screen.findByText("get_my_accounts");

    fireEvent.click(screen.getByText("get_my_accounts"));

    expect(
      screen.getByRole("button", { name: /Call Tool/i }),
    ).toBeInTheDocument();
  });
});

// ─── Tool invocation and SSE streaming ────────────────────────────────────────

describe("WebMcpPanel — tool invocation", () => {
  it("calls openMcpToolStream before callMcpTool", async () => {
    await renderComponent();
    await screen.findByText("get_my_accounts");

    fireEvent.click(screen.getByText("get_my_accounts"));
    fireEvent.click(screen.getByRole("button", { name: /Call Tool/i }));

    await waitFor(() => expect(callMcpTool).toHaveBeenCalledTimes(1));
    expect(openMcpToolStream).toHaveBeenCalledTimes(1);
    expect(callMcpTool).toHaveBeenCalledWith(
      "get_my_accounts",
      {},
      expect.any(String),
    );
    expect(openMcpToolStream.mock.invocationCallOrder[0]).toBeLessThan(
      callMcpTool.mock.invocationCallOrder[0],
    );
  });

  it("passes the same UUID flowTraceId to stream and tool call", async () => {
    await renderComponent();
    await screen.findByText("get_my_accounts");

    fireEvent.click(screen.getByText("get_my_accounts"));
    fireEvent.click(screen.getByRole("button", { name: /Call Tool/i }));

    await waitFor(() => expect(callMcpTool).toHaveBeenCalledTimes(1));
    const streamTraceId = openMcpToolStream.mock.calls[0][0];
    const callTraceId = callMcpTool.mock.calls[0][2];
    expect(streamTraceId).toBe(callTraceId);
    expect(streamTraceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("displays SSE stream events received during tool call", async () => {
    let capturedOnEvent;
    openMcpToolStream.mockImplementation((_traceId, onEvent) => {
      capturedOnEvent = onEvent;
      return () => {};
    });
    callMcpTool.mockImplementation(async () => {
      capturedOnEvent?.({ phase: "token_exchange", status: "ok" });
      capturedOnEvent?.({ phase: "tool_call", tool: "get_my_accounts" });
      return { result: { content: [{ text: "accounts listed" }] } };
    });

    await renderComponent();
    await screen.findByText("get_my_accounts");
    fireEvent.click(screen.getByText("get_my_accounts"));
    fireEvent.click(screen.getByRole("button", { name: /Call Tool/i }));

    await screen.findByText(/Pipeline Events/i);
    expect(screen.getByText(/token_exchange/)).toBeInTheDocument();
  });

  it("displays the tool result after successful call", async () => {
    callMcpTool.mockResolvedValue({
      result: { content: [{ text: "account balance: $5000" }] },
    });

    await renderComponent();
    await screen.findByText("get_my_accounts");
    fireEvent.click(screen.getByText("get_my_accounts"));
    fireEvent.click(screen.getByRole("button", { name: /Call Tool/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 5, name: /^Server Response$/ }),
      ).toBeInTheDocument();
    });
  });

  it("shows error section when callMcpTool rejects", async () => {
    callMcpTool.mockRejectedValue(new Error("insufficient scope"));

    await renderComponent();
    await screen.findByText("get_my_accounts");
    fireEvent.click(screen.getByText("get_my_accounts"));
    fireEvent.click(screen.getByRole("button", { name: /Call Tool/i }));

    await waitFor(() => {
      expect(screen.getByText(/Tool call failed/i)).toBeInTheDocument();
    });
  });

  it("calls disconnect on SSE stream before starting a new call", async () => {
    const disconnect = jest.fn();
    openMcpToolStream.mockReturnValue(disconnect);

    await renderComponent();
    await screen.findByText("get_my_accounts");
    fireEvent.click(screen.getByText("get_my_accounts"));
    fireEvent.click(screen.getByRole("button", { name: /Call Tool/i }));

    await screen.findByRole("heading", { level: 5, name: /^Server Response$/ });

    fireEvent.click(screen.getByRole("button", { name: /Call Tool/i }));

    expect(disconnect).toHaveBeenCalled();
  });
});
