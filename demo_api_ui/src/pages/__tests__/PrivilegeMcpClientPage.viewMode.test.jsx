// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.viewMode.test.jsx
//
// Demo / Inspect. Two audiences share this page: a customer watching the chain
// do what it was told, and whoever is working out why it did not.
//
// The load-bearing promise is that the split HIDES and never REMOVES — every
// tab, pane and control is one toggle away. The tests below pin that promise
// from the Demo side, plus the two decisions that make the toggle usable
// rather than annoying: the mode persists, and each mode remembers its tab.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const STATE = {
  config: { mcpUrl: "https://mcpgw.example.com/pingone-admin/mcp", clientId: "a6219652", scopes: "openid profile email" },
  gatewayMode: "privilege",
  gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
  oauth: { authenticated: true, scope: "openid profile email" },
  mainAppAuthenticated: true,
  user: { email: "curtis@example.com" },
  tools: [],
  presets: [],
};

beforeEach(() => {
  localStorage.clear();
  global.EventSource = class { addEventListener() {} close() {} };
  global.fetch = vi.fn((url) => {
    if (String(url).endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(STATE) });
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

const tabNames = () =>
  [...document.querySelectorAll(".cur-tab")].map((b) => b.textContent);
// The open pane appends its own "Clear" button carrying the tab class — filter
// it out so this reads the tab strip, not the strip plus whatever pane is open.
const terminalTabNames = () =>
  [...document.querySelectorAll(".cur-terminal-tab")]
    .map((b) => b.textContent.replace(/\d+$/, ""))
    .filter((t) => t !== "Clear");

async function ready() {
  await screen.findByRole("button", { name: "Inspect" });
}

describe("Demo / Inspect", () => {
  it("opens in Demo with the customer-facing tabs only", async () => {
    renderPage();
    await ready();

    expect(tabNames()).toEqual(["Agent Chat", "Tools"]);
    // Tools stays in Demo on purpose: its Run buttons and Present mode are a
    // demo move, not an inspection one.
    expect(screen.getByRole("button", { name: "Tools" })).toBeInTheDocument();
  });

  it("keeps TRACE and RESULTS in Demo, and adds RELAY LOG and SCOPES in Inspect", async () => {
    renderPage();
    await ready();

    // RESULTS is where tool output lands — showing the data that came back is
    // half of what a demo is for, so it is never an Inspect-only pane.
    expect(terminalTabNames()).toEqual(["TRACE", "RESULTS"]);

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(terminalTabNames()).toEqual(["RELAY LOG", "TRACE", "SCOPES", "RESULTS"]);
  });

  it("reveals every hidden surface in Inspect — nothing is removed", async () => {
    renderPage();
    await ready();

    expect(screen.queryByRole("button", { name: "MCP Explorer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Raw RPC" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Policies" })).toBeNull();
    expect(screen.queryByRole("button", { name: /probe other doors/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));

    expect(tabNames()).toEqual(["MCP Explorer", "Raw RPC", "Policies"]);
    expect(screen.getByRole("button", { name: /probe other doors/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LLM Gateway" })).toBeInTheDocument();
  });

  // The skin picker used to be gated behind Inspect with the other appearance
  // chrome. It is the ONLY route to the VS Code, Claude Terminal and Claude
  // Desktop client shells, so gating it hid three whole demos behind a
  // debugging mode. Same correction as Light/Dark, for the same reason.
  it("keeps the skin picker in both modes, because it is the only way to the other shells", async () => {
    renderPage();
    await ready();

    expect(screen.getByRole("combobox", { name: "Skin" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByRole("combobox", { name: "Skin" })).toBeInTheDocument();
  });

  it("keeps the connection rail and the demo controls in both modes", async () => {
    renderPage();
    await ready();

    // The rail is the point of the page in either mode — the identity and the
    // destination answer for whatever the tools did.
    const railInDemo = document.querySelectorAll(".cur-rail__row").length;
    expect(railInDemo).toBe(5);
    // "Clear" is deliberately ambiguous — the titlebar has one and the open
    // terminal pane adds another — so match the titlebar's by its title text.
    expect(screen.getByTitle("Clear chat, events, and results for a fresh demo")).toBeInTheDocument();
    for (const name of ["Guide", "Flow"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // Light/Dark stays in Demo. It was briefly gated behind Inspect with the
    // rest of the appearance chrome, and that was wrong: flipping to light for
    // a projector or a bright room is the most demo-ish control on this bar,
    // and gating it meant reaching for a debugging mode to do a stage job.
    expect(screen.getByRole("button", { name: /^(Light|Dark)$/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(document.querySelectorAll(".cur-rail__row")).toHaveLength(5);
  });

  it("remembers the tab you were on in each mode", async () => {
    renderPage();
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    fireEvent.click(screen.getByRole("button", { name: "Policies" }));

    // Back to Demo: not Agent Chat, the tab we actually left.
    fireEvent.click(screen.getByRole("button", { name: "Demo" }));
    expect(document.querySelector(".cur-tab--active").textContent).toBe("Tools");

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(document.querySelector(".cur-tab--active").textContent).toBe("Policies");
  });

  // A mode that resets on every reload gets re-clicked on every reload, which
  // reads as broken rather than minimal. Same reasoning as cur_priv_theme.
  it("persists the mode across a remount", async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    await waitFor(() => expect(localStorage.getItem("cur_priv_view")).toBe("inspect"));

    document.body.innerHTML = "";
    renderPage();
    await ready();

    // And it lands on an Inspect tab, not on activeTab's 'chat' default — which
    // is not an Inspect tab at all.
    expect(tabNames()).toEqual(["MCP Explorer", "Raw RPC", "Policies"]);
    expect(document.querySelector(".cur-tab--active").textContent).toBe("MCP Explorer");
  });
});
