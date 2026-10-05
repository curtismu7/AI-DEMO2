import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FootprintLiveShellPage from "../FootprintLiveShellPage";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

it("keeps the transcript and lands a pending reply after a skin switch", async () => {
  apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: true, scope: "openid" }, tools: [{ name: "t" }] } });
  let resolveChat;
  apiClient.post.mockImplementation(() => new Promise((r) => { resolveChat = r; }));
  localStorage.clear();

  render(
    <MemoryRouter initialEntries={["/demo/coding-agent?v=claude-code"]}>
      <Routes>
        <Route path="/demo/:shellSlug" element={<FootprintLiveShellPage />} />
      </Routes>
    </MemoryRouter>,
  );

  const box = await screen.findByRole("textbox", { name: "Prompt" });
  fireEvent.change(box, { target: { value: "list safes" } });
  fireEvent.submit(box.closest("form"));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/chat", { prompt: "list safes" }));

  // Switch to VS Code while the reply is still pending.
  fireEvent.change(screen.getByRole("combobox", { name: "Skin" }), { target: { value: "vscode:classic-dark" } });
  expect(await screen.findByTestId("pvs-vscode")).toBeInTheDocument();
  expect(screen.getByRole("log", { name: "Chat" })).toHaveTextContent("list safes");

  await act(async () => resolveChat({ data: { reply: "Found 1 tool", steps: [] } }));
  expect(screen.getByRole("log", { name: "Chat" })).toHaveTextContent("Found 1 tool");
});

it("keeps the chosen connection path after a skin switch without posting /config", async () => {
  const preset = (id, url) => ({ id, label: id, mode: "privilege", url });
  const state = {
    oauth: { authenticated: true, scope: "openid" },
    tools: [{ name: "t", inputSchema: { properties: {} } }],
    gatewayMode: "privilege",
    config: { mcpUrl: "https://gw.example/privilege-gateway/banking/mcp", clientId: "" },
    presets: [
      preset("banking", "https://gw.example/privilege-gateway/banking/mcp"),
      preset("other", "https://gw.example/privilege-gateway/other/mcp"),
    ],
    gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
  };
  apiClient.post.mockReset();
  apiClient.get.mockImplementation(async (url) => {
    if (String(url).endsWith("/llm/config")) return { data: { gatewayUrl: "https://llm.example" } };
    return { data: state };
  });
  localStorage.clear();

  render(
    <MemoryRouter initialEntries={["/demo/coding-agent?v=claude-code"]}>
      <Routes>
        <Route path="/demo/:shellSlug" element={<FootprintLiveShellPage />} />
      </Routes>
    </MemoryRouter>,
  );

  const path = await screen.findByRole("combobox", { name: "Connection path" });
  fireEvent.change(path, { target: { value: "llm:anthropic" } });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Connection path" })).toHaveValue("llm:anthropic"));
  expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/config", expect.anything());

  fireEvent.change(screen.getByRole("combobox", { name: "Skin" }), { target: { value: "vscode:classic-dark" } });
  expect(await screen.findByTestId("pvs-vscode")).toBeInTheDocument();
  // In VS Code the route controls live in the Explorer side panel, not the chat pane.
  expect(screen.getByRole("button", { name: "Anthropic", pressed: true })).toBeInTheDocument();
  expect(screen.getByText("Tools apply to MCP paths.")).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/config", expect.anything());
});

describe("VS Code side panel routing", () => {
  const BANKING = "https://gw.example/privilege-gateway/banking/mcp";
  const OTHER = "https://gw.example/privilege-gateway/other/mcp";
  const routedState = () => ({
    oauth: { authenticated: true, scope: "openid" },
    tools: [{ name: "t", inputSchema: { properties: {} } }],
    gatewayMode: "privilege",
    config: { mcpUrl: BANKING, clientId: "" },
    presets: [
      { id: "banking", label: "banking", mode: "privilege", url: BANKING },
      { id: "other", label: "other", mode: "privilege", url: OTHER },
    ],
    gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
  });
  const renderAt = (path) => {
    apiClient.post.mockReset();
    apiClient.post.mockImplementation(async (url) =>
      String(url).endsWith("/config") ? { data: { oauth: { destinationAuthenticated: true } } } : { data: { tools: [] } });
    apiClient.get.mockImplementation(async (url) =>
      String(url).endsWith("/llm/config") ? { data: { gatewayUrl: "https://llm.example" } } : { data: routedState() });
    localStorage.clear();
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/demo/:shellSlug" element={<FootprintLiveShellPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("shows Path and Door in the Explorer side panel and a door click posts /config", async () => {
    renderAt("/demo/vscode-copilot?v=classic-dark");
    const path = await screen.findByRole("group", { name: "Connection path" });
    const side = path.closest(".afm-vcs-side");
    expect(side).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Connection path" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "other" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/privilege-mcp/config",
        expect.objectContaining({ mcpUrl: OTHER }),
      ));
  });

  it("keeps the side panel usable while signed out", async () => {
    renderAt("/demo/vscode-copilot?v=classic-dark");
    await screen.findByRole("group", { name: "Connection path" });
    apiClient.post.mockImplementation(async (url) =>
      String(url).endsWith("/config") ? { data: { oauth: { destinationAuthenticated: false } } } : { data: { tools: [] } });
    fireEvent.click(await screen.findByRole("button", { name: "other" }));
    expect(await screen.findByRole("button", { name: "Sign in with Privilege" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "MCP backend (door)" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "MCP backend (door)" })).toBeNull();
  });

  it("does not add the side tree to other skins", async () => {
    renderAt("/demo/coding-agent?v=claude-code");
    await screen.findByRole("combobox", { name: "Connection path" });
    expect(screen.queryByRole("group", { name: "Connection path" })).toBeNull();
  });
});

describe("costume variant survives the sign-in round trip", () => {
  it("remembers a ?v= deep-link variant when the user signs in", async () => {
    apiClient.post.mockReset();
    apiClient.post.mockResolvedValue({ data: { authUrl: "https://auth.example/start" } });
    apiClient.get.mockImplementation(async (url) =>
      String(url).endsWith("/llm/config")
        ? { data: { gatewayUrl: "https://llm.example" } }
        : { data: { oauth: { authenticated: false } } });
    localStorage.clear();
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    try {
      render(
        <MemoryRouter initialEntries={["/demo/vscode-copilot?v=light"]}>
          <Routes>
            <Route path="/demo/:shellSlug" element={<FootprintLiveShellPage />} />
          </Routes>
        </MemoryRouter>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Sign in with Privilege" }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith("https://auth.example/start"));
      expect(JSON.parse(localStorage.getItem("ai-footprint-mock-selection-v1")).vscode).toBe("light");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
