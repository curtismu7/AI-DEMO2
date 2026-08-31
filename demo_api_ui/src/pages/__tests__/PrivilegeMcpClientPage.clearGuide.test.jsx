// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.clearGuide.test.jsx
// Clear must reset the demo surface (and the server MCP session via an empty
// /config POST) without touching sign-in or gateway config. Guide must open
// the learning content in a draggable modal instead of navigating away.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const tools = [
  { name: "first_tool", description: "First tool", inputSchema: { properties: {} } },
  { name: "second_tool", description: "Second tool", inputSchema: { properties: {} } },
];

beforeEach(() => {
  navigate.mockClear();
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
  global.fetch = vi.fn((url, opts) => {
    if (String(url).endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "", clientId: "", scopes: "openid" },
            oauth: { authenticated: false },
            mainAppAuthenticated: false,
            tools,
            presets: [],
          }),
      });
    }
    if (String(url).endsWith("/api/privilege-mcp/config")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => '{"ok":true}' });
    }
    if (String(url).endsWith("/api/privilege-mcp/tools/call")) {
      const { name } = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ output: `${name} output` }) });
    }
    return new Promise(() => {});
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

describe("Clear and Guide buttons", () => {
  it("Clear resets the server MCP session via an empty /config POST", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle(/clear chat, events/i));

    const configCalls = global.fetch.mock.calls.filter(
      ([url, opts]) => String(url).endsWith("/api/privilege-mcp/config") && opts?.method === "POST",
    );
    expect(configCalls).toHaveLength(1);
    expect(configCalls[0][1].body).toBe("{}");
  });

  it("Guide opens a draggable modal instead of navigating", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle("Learning Guide"));

    expect(await screen.findByText("AI Agent Gateway Guide")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith("/privilege-mcp-learning");
  });

  it("replaces the previous result when another tool runs", async () => {
    const { container } = renderPage();

    // The Run buttons live in ToolsTable, which mounts only while activeTab is
    // 'tools'. The page starts on 'chat' and auto-lands on Tools via an effect
    // that fires AFTER the discovered tools paint. Waiting on "Run" alone races
    // that extra render against findAllByRole's 1s default: it won scoped and
    // lost under full-suite load, so this test failed ONLY in full runs — the
    // sidebar showed both tools while the Agent Chat tab was still active.
    // Wait for discovery, then switch tabs explicitly so the query below has no
    // timing dependency at all.
    await screen.findByText("first_tool");
    fireEvent.click(screen.getByTitle("MCP Tools"));

    const runButtons = await screen.findAllByRole("button", { name: "Run" });
    fireEvent.click(runButtons[0]);
    await waitFor(() => expect(container.querySelector(".cur-terminal-results")).toHaveTextContent("first_tool output"));

    fireEvent.click(runButtons[1]);

    await waitFor(() => expect(container.querySelector(".cur-terminal-results")).toHaveTextContent("second_tool output"));
    expect(container.querySelector(".cur-terminal-results")).not.toHaveTextContent("first_tool output");
    expect(container.querySelector(".cur-terminal-tab-badge")).toHaveTextContent("1");
  });
});
