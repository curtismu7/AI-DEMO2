// demo_api_ui/src/components/aiFootprintMocks/__tests__/PrivilegeShellPanel.test.jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PrivilegeShellPanel } from "../PrivilegeShellPanel";
import { usePrivilegeShellSession } from "../usePrivilegeShellSession";
import apiClient from "../../../services/apiClient";

vi.mock("../../../services/apiClient", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

function Harness({ skin }) {
  const session = usePrivilegeShellSession();
  return <PrivilegeShellPanel skin={skin} session={session} />;
}

function renderPanel(path = "/demo/chatgpt-desktop", skin = "chatgpt") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness skin={skin} />
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
        returnTo: "/demo/chatgpt-desktop",
      }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://auth.example/authorize"));
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("shows tool schemas and the request and result from Run", async () => {
    apiClient.get.mockResolvedValue({
      data: {
        oauth: { authenticated: true, scope: "openid mcp:tools" },
        tools: [{
          name: "list_safes",
          description: "List privilege safes",
          inputSchema: { properties: { owner: { type: "string" } }, required: ["owner"] },
        }],
      },
    });
    apiClient.post.mockResolvedValue({ data: { ok: true, safes: [] } });
    renderPanel();
    expect(await screen.findByText("list_safes")).toBeInTheDocument();
    expect(screen.getByText("owner*")).toBeInTheDocument();
    expect(screen.getByText("mcp:tools")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/tools/call", {
        name: "list_safes",
        arguments: { owner: "" },
      }),
    );
    const exchange = await screen.findByRole("region", { name: "Latest tool request and result" });
    expect(exchange).toHaveTextContent('"owner": ""');
    expect(exchange).toHaveTextContent('"ok": true');
    expect(exchange).toHaveTextContent("Success");
  });

  it("shows the OAuth error carried back on the redirect query", async () => {
    apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: false } } });
    renderPanel("/demo/chatgpt-desktop?auth=error&reason=denied");
    expect(await screen.findByText("OAuth failed: denied")).toBeInTheDocument();
  });
});
