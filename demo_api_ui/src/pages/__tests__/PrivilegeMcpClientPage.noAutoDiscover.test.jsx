// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.noAutoDiscover.test.jsx
//
// Returning from OAuth used to fire tools/list automatically ("OAuth completed.
// Refreshing tools..."). Signing in says who you are; it does not say which door
// you meant to probe. Auto-discovering spends a real call against whatever door
// happened to be selected — and on a denying door pops the denial modal — before
// the presenter has touched anything.
//
// "Get MCP Tools" is now the only control that discovers.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

let toolsListCalls = 0;

function mockState() {
  toolsListCalls = 0;
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "https://mcpgw.example.com/agent-gateway/mcp", clientId: "a6219652", scopes: "openid profile email" },
            gatewayMode: "privilege",
            gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
            oauth: { authenticated: true, scope: "openid profile email" },
            mainAppAuthenticated: true,
            user: { email: "cmuir+demo-user@pingone.com" },
            tools: [],
            presets: [],
          }),
      });
    }
    if (u.endsWith("/api/privilege-mcp/tools/list") && opts?.method === "POST") {
      toolsListCalls += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tools: [{ name: "get_weather" }] }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, text: async () => "{}" });
  });
}

/** The page reads ?auth=success from the URL to detect the OAuth return trip. */
function renderAfterSignIn() {
  return render(
    <MemoryRouter initialEntries={["/privilege-mcp-client?auth=success"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

function NavigateToA2ADemoStep() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/privilege-mcp-client?view=demo&tab=a2a")}>
      Open A2A Demo Step
    </button>
  );
}

describe("PrivilegeMcpClientPage — no auto-discovery on sign-in return", () => {
  test("returning from OAuth does NOT call tools/list", async () => {
    mockState();
    renderAfterSignIn();

    // /state must have landed, so this is not just "nothing happened yet".
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(global.fetch.mock.calls.some((c) => String(c[0]).endsWith("/api/privilege-mcp/state"))).toBe(true),
    );

    // Give any stray .then() chain a chance to fire before asserting absence.
    await new Promise((r) => setTimeout(r, 50));
    expect(toolsListCalls).toBe(0);
  });

  test("the sign-in message tells the presenter which button to press", async () => {
    mockState();
    renderAfterSignIn();
    // A silent no-op would read as broken; the page has to say what to do next.
    // Matched on the message, not on /Get MCP Tools/ alone — the button carries
    // that text too, so the looser pattern matches two nodes and throws.
    await waitFor(() => expect(screen.getByText(/OAuth completed\. Press/i)).toBeTruthy());
  });

  test("pressing Get MCP Tools still discovers", async () => {
    mockState();
    renderAfterSignIn();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const btn = await screen.findByRole("button", { name: /Get MCP Tools/i });
    fireEvent.click(btn);

    // The button is the ONE path that discovers — removing auto-discovery must
    // not have removed discovery.
    await waitFor(() => expect(toolsListCalls).toBe(1));
  });

  test("A2A is available in Demo while the existing MCP Inspect tabs remain available", async () => {
    mockState();
    localStorage.setItem("cur_priv_view", "demo");
    renderAfterSignIn();

    const a2aTab = await screen.findByRole("tab", { name: "A2A" });
    fireEvent.click(a2aTab);
    await screen.findByRole("heading", { name: "A2A access review" });

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(await screen.findByRole("tab", { name: "MCP Explorer" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Raw RPC" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Policies" })).toBeTruthy();
    localStorage.removeItem("cur_priv_view");
  });

  test("the A2A Demo Step deep link overrides the saved view and selects its tab", async () => {
    mockState();
    localStorage.setItem("cur_priv_view", "inspect");
    render(
      <MemoryRouter initialEntries={["/privilege-mcp-client?view=demo&tab=a2a"]}>
        <PrivilegeMcpClientPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "A2A access review" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "A2A" })).toHaveClass("cur-tab--active");
    expect(screen.getByLabelText("Your question")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    expect(global.fetch.mock.calls.some(([url]) => String(url) === "/api/privilege-a2a/chat")).toBe(false);
    localStorage.removeItem("cur_priv_view");
  });

  test("navigating to the A2A Demo Step updates an already-mounted client page", async () => {
    mockState();
    localStorage.setItem("cur_priv_view", "inspect");
    render(
      <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
        <NavigateToA2ADemoStep />
        <PrivilegeMcpClientPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("tab", { name: "MCP Explorer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open A2A Demo Step" }));

    expect(await screen.findByRole("heading", { name: "A2A access review" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "A2A" })).toHaveClass("cur-tab--active");
    localStorage.removeItem("cur_priv_view");
  });
});
