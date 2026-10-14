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
  [...document.querySelectorAll(".cur-tabs[aria-label='Demo tabs'] .cur-tab")].map((b) => b.textContent);
// Inspect lives in a drawer beside Demo, with its own tablist.
const drawerTabNames = () =>
  [...document.querySelectorAll(".cur-inspect-drawer .cur-tab")].map((b) => b.textContent);
// The open pane appends its own "Clear" button carrying the tab class — filter
// it out so this reads the tab strip, not the strip plus whatever pane is open.
const terminalTabNames = () =>
  [...document.querySelectorAll(".cur-terminal-tab")]
    .map((b) => b.textContent.replace(/\d+$/, ""))
    .filter((t) => t !== "Clear");

async function ready() {
  await screen.findByRole("button", { name: "Inspect" });
}

describe("title bar", () => {
  it("keeps the reference links under one More menu, and the controls outside it", async () => {
    renderPage();
    await ready();

    const more = document.querySelector("details.cur-more");
    expect(more).not.toBeNull();
    const inMenu = [...more.querySelectorAll("a")].map((a) => a.textContent);
    expect(inMenu).toEqual(["Demo step", "Diagram", "Topologies", "Logs"]);
    // Controls stay one click away, not behind the menu.
    for (const name of ["Light", "Clear", "Guide", "Settings", "Flow"]) {
      for (const b of screen.getAllByRole("button", { name })) expect(more.contains(b)).toBe(false);
    }
  });
});

describe("Demo / Inspect", () => {
  it("opens in Demo with the customer-facing tabs only", async () => {
    renderPage();
    await ready();

    expect(tabNames()).toEqual(["Agent Chat", "Tools", "User API Key & Secrets"]);
    // Tools stays in Demo on purpose: its flow is for presenting. A2A is its own page (/privilege-a2a).
    expect(screen.getByRole("tab", { name: "Tools" })).toBeInTheDocument();
  });

  it("keeps TRACE and RESULTS in both views; Relay log and Scopes live in the Inspect drawer", async () => {
    renderPage();
    await ready();

    // RESULTS is where tool output lands — showing the data that came back is
    // half of what a demo is for, so it is never an Inspect-only pane.
    expect(terminalTabNames()).toEqual(["TRACE", "RESULTS"]);

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(terminalTabNames()).toEqual(["TRACE", "RESULTS"]);
    expect(drawerTabNames()).toEqual(["MCP Explorer", "Raw RPC", "Policies", "Relay log", "Scopes"]);
  });

  it("reveals every hidden surface in Inspect — nothing is removed", async () => {
    renderPage();
    await ready();

    expect(screen.queryByRole("tab", { name: "MCP Explorer" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Raw RPC" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Policies" })).toBeNull();
    expect(screen.queryByRole("button", { name: /probe other doors/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));

    // Inspect opens a drawer; the Demo tabs stay where they were.
    expect(drawerTabNames()).toEqual(["MCP Explorer", "Raw RPC", "Policies", "Relay log", "Scopes"]);
    expect(tabNames()).toEqual(["Agent Chat", "Tools", "User API Key & Secrets"]);
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

    fireEvent.click(screen.getByRole("tab", { name: "Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    fireEvent.click(screen.getByRole("tab", { name: "Policies" }));

    // Back to Demo: not Agent Chat, the tab we actually left.
    fireEvent.click(screen.getByRole("button", { name: "Demo" }));
    expect(document.querySelector(".cur-tabs[aria-label='Demo tabs'] .cur-tab--active").textContent).toBe("Tools");
    expect(document.querySelector(".cur-inspect-drawer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(document.querySelector(".cur-inspect-drawer .cur-tab--active").textContent).toBe("Policies");
    // The Demo tab did not move while the drawer was open.
    expect(document.querySelector(".cur-tabs[aria-label='Demo tabs'] .cur-tab--active").textContent).toBe("Tools");
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
    expect(drawerTabNames()).toEqual(["MCP Explorer", "Raw RPC", "Policies", "Relay log", "Scopes"]);
    expect(document.querySelector(".cur-inspect-drawer .cur-tab--active").textContent).toBe("MCP Explorer");
  });

  it("closes the drawer from its own close button and keeps the Demo tab", async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("tab", { name: "Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(document.querySelector(".cur-inspect-drawer")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close inspect" }));
    expect(document.querySelector(".cur-inspect-drawer")).toBeNull();
    expect(screen.getByRole("button", { name: "Demo" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".cur-tab--active").textContent).toBe("Tools");
  });
});

describe("getting-started guide", () => {
  it("lists the three steps in the empty chat and marks what is already done", async () => {
    renderPage();
    await ready();
    const guide = screen.getByTestId("start-guide");
    expect(guide).toHaveAttribute("aria-label", "Getting started");
    expect(guide.querySelectorAll("li")).toHaveLength(3);
    // Signed in (mocked) but no tools discovered yet: step 1 done, step 2 pending.
    expect(guide.querySelectorAll("li.is-done")).toHaveLength(1);
    expect(guide.textContent).toMatch(/Press Get MCP Tools/);
    // It is text, not a second Get MCP Tools button.
    expect(screen.getAllByRole("button", { name: /Get MCP Tools/i })).toHaveLength(1);
  });
});
