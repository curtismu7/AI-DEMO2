// demo_api_ui/src/components/aiFootprintMocks/__tests__/PrivilegeShellPanel.test.jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PrivilegeShellPanel } from "../PrivilegeShellPanel";
import apiClient from "../../../services/apiClient";

vi.mock("../../../services/apiClient", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

function renderPanel(path = "/demo/coding-agent", skin = "coding") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PrivilegeShellPanel skin={skin} />
    </MemoryRouter>,
  );
}

describe("PrivilegeShellPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers Privilege sign-in when the session is unauthenticated", async () => {
    apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: false } } });
    renderPanel();
    const btn = await screen.findByRole("button", { name: "Sign in with Privilege" });
    apiClient.post.mockResolvedValue({ data: { authUrl: "https://auth.example/authorize" } });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign },
    });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/auth/start", {
        returnTo: "/demo/coding-agent",
      }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://auth.example/authorize"));
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("lists discovered tools and calls one", async () => {
    apiClient.get.mockResolvedValue({
      data: {
        oauth: { authenticated: true, scope: "openid mcp:tools" },
        tools: [{ name: "list_safes", description: "List privilege safes" }],
      },
    });
    apiClient.post.mockResolvedValue({ data: { ok: true, safes: [] } });
    renderPanel();
    const tool = await screen.findByText("list_safes");
    expect(screen.getByText("mcp:tools")).toBeInTheDocument();
    fireEvent.click(tool);
    fireEvent.click(screen.getByRole("button", { name: "Call tool" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/tools/call", {
        name: "list_safes",
        arguments: {},
      }),
    );
    expect(await screen.findByText(/"ok": true/)).toBeInTheDocument();
  });

  it("shows the OAuth error carried back on the redirect query", async () => {
    apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: false } } });
    renderPanel("/demo/coding-agent?auth=error&reason=denied");
    expect(await screen.findByText("OAuth failed: denied")).toBeInTheDocument();
  });
});
