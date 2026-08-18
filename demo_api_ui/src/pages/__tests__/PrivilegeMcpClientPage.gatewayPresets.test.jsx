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
  { label: "Agentless gateway (nginx)", url: "https://aidemo.mcpgw.local.ping-devops.com/mcp" },
  { label: "AI Gateway via Priv Agent", url: "https://opensearch.default.applications.procyon.ai:8643/mcp" },
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
    expect(screen.getByRole("option", { name: "AI Gateway via Priv Agent" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: PRESETS[1].url } });

    expect(screen.getByLabelText(/AI Agent Gateway URL/i)).toHaveValue(PRESETS[1].url);
  });

  it("keeps a hand-typed URL selectable as Custom", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle("Settings"));

    const select = await screen.findByLabelText(/gateway preset/i);
    expect(select).toHaveValue("");

    const urlInput = screen.getByLabelText(/AI Agent Gateway URL/i);
    fireEvent.change(urlInput, { target: { value: "https://somewhere.else/mcp" } });

    expect(select).toHaveValue("");
    expect(urlInput).toHaveValue("https://somewhere.else/mcp");
  });
});
