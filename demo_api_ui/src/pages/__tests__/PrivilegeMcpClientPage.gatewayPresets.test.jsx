// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.gatewayPresets.test.jsx
// The Settings modal must offer the gateway presets served by /state so the
// operator can point the client at the agent-based AI Gateway frontend
// (*.applications.procyon.ai) without typing the URL by hand.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const PRESETS = [
  { label: "Agentless gateway (nginx)", mode: "privilege", url: "https://aidemo.mcpgw.local.ping-devops.com/mcp" },
  { label: "AI Gateway via Priv Agent", mode: "direct", url: "https://opensearch.default.applications.procyon.ai:8643/mcp" },
];

beforeEach(() => {
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
            config: { mcpUrl: "", clientId: "", scopes: "openid profile email" },
            gatewayMode: "privilege",
            gatewayConfigs: {
              agent: { mcpUrl: PRESETS[1].url },
              agentless: { mcpUrl: "", clientId: "", scopes: "openid profile email" },
            },
            oauth: { authenticated: false },
            mainAppAuthenticated: false,
            tools: [],
            presets: PRESETS,
          }),
      });
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

describe("gateway presets in the Settings modal", () => {
  it("lists the presets from /state and picking one fills the gateway URL field", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle("Settings"));

    const select = await screen.findByLabelText(/gateway preset/i);
    expect(screen.getByRole("button", { name: /Sign In with Privilege/i })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: PRESETS[1].url } });

    // Choosing a preset fills the one URL field every path shares. The fields
    // no longer come and go with the mode: privilege and façade authenticate
    // the same way, which is why the retired agent mode's bare-URL form is
    // gone. Direct is the exception — PRESETS[1] is mode: 'direct', which has
    // no auth front door at all, so "Sign In with Privilege" is correctly
    // replaced rather than staying present.
    expect(screen.getByLabelText(/MCP URL/i)).toHaveValue(PRESETS[1].url);
    expect(screen.getByLabelText(/OAuth Client ID/i)).toBeInTheDocument();
    expect(screen.getByText(/no sign-in required/i)).toBeInTheDocument();
  });

  it("keeps a hand-typed URL selectable as Custom", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle("Settings"));

    const select = await screen.findByLabelText(/gateway preset/i);
    expect(select).toHaveValue("");

    const urlInput = screen.getByLabelText(/MCP URL/i);
    fireEvent.change(urlInput, { target: { value: "https://somewhere.else/mcp" } });

    expect(select).toHaveValue("");
    expect(urlInput).toHaveValue("https://somewhere.else/mcp");
  });
});
