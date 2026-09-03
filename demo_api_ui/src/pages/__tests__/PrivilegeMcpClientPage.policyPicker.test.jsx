// The Policies tab is a VIEWER: Privilege resolves which policy applies from
// (user, door, tool) server-side, so the picker must never read as a control
// that changes anything. It exists so a presenter can answer "which policy is
// doing this?" without opening every accordion on stage.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const GATEWAY = "https://mcpgw.example.com/opensearch22/mcp";

const INVENTORY = {
  envId: "env-1",
  applications: [
    { name: "opensearch22", mcpUrl: GATEWAY, backends: [], status: "" },
    { name: "banking", mcpUrl: "https://mcpgw.example.com/banking/mcp", backends: [], status: "" },
  ],
  policies: [
    { name: "read-only-everyone", spec: { Tools: ["ListIndexTool"] } },
    { name: "opensearch22-grant", spec: { Apps: ["opensearch22"], Users: ["someone-else@pingone.com"] } },
    { name: "demo-user-grant", spec: { Users: ["demo-user@pingone.com"] } },
    { name: "banking-grant", spec: { Apps: ["banking"], Users: ["demo-user@pingone.com"] } },
  ],
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const baseState = {
  config: { mcpUrl: GATEWAY, clientId: "c1", scopes: "openid profile email" },
  gatewayMode: "privilege",
  gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
  oauth: { authenticated: true },
  user: { email: "demo-user@pingone.com" },
  mainAppAuthenticated: true,
  tools: [],
  presets: [],
};

beforeEach(() => {
  sessionStorage.clear();
  global.EventSource = class { addEventListener() {} close() {} };
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) return Promise.resolve(jsonResponse(baseState));
    if (u.endsWith("/api/privilege-mcp/console/connect")) return Promise.resolve(jsonResponse(INVENTORY));
    if (u.endsWith("/api/privilege-mcp/tools/list")) return Promise.resolve(jsonResponse({ tools: [] }));
    return new Promise(() => {});
  });
});

async function openPoliciesTabConnected() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Policies" }));
  const token = await screen.findByLabelText(/auth_token|console token/i);
  fireEvent.change(token, { target: { value: "console-cookie" } });
  fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
  return screen.findByLabelText("Inspect a policy");
}

describe("policy picker", () => {
  it("lists every policy and flags the ones mentioning this door or this user", async () => {
    const picker = await openPoliciesTabConnected();

    const labels = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining([
      expect.stringContaining("read-only-everyone"),
      expect.stringContaining("opensearch22-grant — mentions this door"),
      expect.stringContaining("demo-user-grant — mentions you"),
    ]));
  });

  it("opens on the policy that mentions the current door", async () => {
    const picker = await openPoliciesTabConnected();

    // During a denial this is the policy the room is asking about; making the
    // presenter find it in a list is the failure mode.
    await waitFor(() => expect(picker).toHaveValue("opensearch22-grant"));
  });

  it("shows the selected policy's raw spec, since the schema is undocumented", async () => {
    const picker = await openPoliciesTabConnected();
    fireEvent.change(picker, { target: { value: "demo-user-grant" } });

    // Scoped to the detail pane: the signed-in identity also appears in the auth
    // panel, so an unscoped query matches twice.
    await waitFor(() => {
      const detail = screen.getByText("demo-user-grant").closest(".cur-console-policy-detail");
      expect(within(detail).getByText(/demo-user@pingone.com/)).toBeInTheDocument();
    });
  });

  it("says plainly that picking a policy does not change the decision", async () => {
    await openPoliciesTabConnected();

    // The guard against the picker reading as a control: Privilege decides from
    // (user, door, tool), and more than one policy can cover a door.
    expect(screen.getByText(/does not change the decision/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bgrants you\b/i);
  });
  it("offers the door a policy covers, because each app has its own URL", async () => {
    const picker = await openPoliciesTabConnected();
    fireEvent.change(picker, { target: { value: "banking-grant" } });

    // The one genuinely actionable thing a policy tells us: where to exercise it.
    const detail = await screen.findByText("banking-grant");
    const pane = detail.closest(".cur-console-policy-detail");
    expect(within(pane).getByText("https://mcpgw.example.com/banking/mcp")).toBeInTheDocument();
    expect(within(pane).getByRole("button", { name: /Use this door/i })).toBeInTheDocument();
  });

  it("marks the covered door as current instead of offering a pointless switch", async () => {
    const picker = await openPoliciesTabConnected();
    fireEvent.change(picker, { target: { value: "opensearch22-grant" } });

    const pane = (await screen.findByText("opensearch22-grant")).closest(".cur-console-policy-detail");
    expect(within(pane).getByText("current")).toBeInTheDocument();
    expect(within(pane).queryByRole("button", { name: /Use this door/i })).toBeNull();
  });

  it("says so when a policy names no registered app", async () => {
    const picker = await openPoliciesTabConnected();
    fireEvent.change(picker, { target: { value: "read-only-everyone" } });

    // Better than rendering an empty area that looks like a loading failure.
    expect(await screen.findByText(/names no registered app/i)).toBeInTheDocument();
  });
});
