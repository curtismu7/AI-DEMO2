// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.clearGuide.test.jsx
// Clear must reset the demo surface (and the server MCP session via an empty
// /config POST) without touching sign-in or gateway config. Guide must open
// the learning content in a draggable modal instead of navigating away.
import { fireEvent, render, screen } from "@testing-library/react";
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

beforeEach(() => {
  navigate.mockClear();
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
  global.fetch = vi.fn((url) => {
    if (String(url).endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "", clientId: "", scopes: "openid" },
            oauth: { authenticated: false },
            mainAppAuthenticated: false,
            tools: [],
            presets: [],
          }),
      });
    }
    if (String(url).endsWith("/api/privilege-mcp/config")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => '{"ok":true}' });
    }
    return new Promise(() => {});
  });
});

function renderPage() {
  render(
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
});
